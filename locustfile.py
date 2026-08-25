"""Realistic Locust load test for the ISKOLARChat API.

The backend rate-limits ``/api/chat`` to 15 requests per minute *per account*.
For a true simultaneous-user test, provide one Supabase access token for each
virtual user. Reusing one token is useful for testing the rate limiter, but it
does not represent multiple students.

Quick start (PowerShell):

    python -m pip install locust
    $env:ISKOLAR_TOKEN_FILE = ".\\locust-tokens.txt"
    locust -f locustfile.py --host http://localhost:8000

``locust-tokens.txt`` must contain one access token per line. Keep that file
outside version control. A comma- or newline-separated ``ISKOLAR_ACCESS_TOKENS``
value and the legacy single ``ISKOLAR_ACCESS_TOKEN`` value are also supported.

Useful settings:

    ISKOLAR_QUESTIONS_FILE       One question per line; blank/# lines ignored
    ISKOLAR_WAIT_MIN_SECONDS     Minimum think time (default: 4)
    ISKOLAR_WAIT_MAX_SECONDS     Maximum think time (default: 8)
    ISKOLAR_NEW_TOPIC_PROBABILITY Chance of starting a new topic (default: .70)
    ISKOLAR_REQUEST_TIMEOUT      Request timeout in seconds (default: 180)
    ISKOLAR_REQUESTS_PER_USER    Stop each user after N requests; 0 = unlimited
    ISKOLAR_ALLOW_TOKEN_REUSE    Reuse accounts across users (default: false)
    ISKOLAR_MODEL_VARIANT        flash, pro, or r1 (default: flash)
    ISKOLAR_REASONING_EFFORT     low, medium, or high (default: low)
    ISKOLAR_MAX_FAILURE_RATIO    Optional pass/fail threshold, e.g. 0.01
    ISKOLAR_MAX_P95_MS           Optional p95 threshold in milliseconds
    ISKOLAR_MIN_REQUESTS         Minimum completed requests (default: 1)

Example reproducible run (10 users, gradual ramp-up, 5 minutes):

    locust -f locustfile.py --host http://localhost:8000 `
      --headless --users 10 --spawn-rate 1 --run-time 5m `
      --csv load-results --html load-report.html

Warning: this endpoint uses paid AI services and unanswered questions can
create HITL escalation records. Use test accounts and a curated question file.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
import threading
import time
from pathlib import Path

from locust import HttpUser, between, events, task
from locust.exception import StopUser


LOGGER = logging.getLogger(__name__)

CHAT_ENDPOINT = os.getenv("ISKOLAR_CHAT_ENDPOINT", "/api/chat").strip() or "/api/chat"
MODEL_VARIANT = os.getenv("ISKOLAR_MODEL_VARIANT", "flash").strip().lower()
REASONING_EFFORT = os.getenv("ISKOLAR_REASONING_EFFORT", "low").strip().lower()

DEFAULT_QUESTIONS = [
    "Ano ang requirements para sa enrollment?",
    "Kailan ang deadline ng scholarship application?",
    "Paano mag-request ng Certificate of Registration?",
    "Ano ang office hours ng registrar?",
    "Paano mag-reset ng password sa Sacarias?",
    "Ano ang schedule ng finals week?",
    "Saan ako puwedeng mag-apply ng LOA?",
    "Ano ang requirements para sa graduation?",
    "Paano makipag-ugnayan sa adviser ko?",
    "May extension ba sa payment ng tuition?",
]

FOLLOW_UP_QUESTIONS = [
    "Can you summarize that in three bullet points?",
    "Ano ang pinakaimportanteng requirement doon?",
    "May deadline ba na kailangan kong tandaan?",
    "Saan ako puwedeng humingi ng karagdagang tulong?",
    "Can you explain that more simply?",
]


def _env_float(name: str, default: float, minimum: float | None = None) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _read_lines(path_value: str, label: str) -> list[str]:
    if not path_value.strip():
        return []
    path = Path(path_value).expanduser()
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise RuntimeError(f"Could not read {label} file {path}: {exc}") from exc
    return [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]


def _load_tokens() -> list[str]:
    values: list[str] = []
    values.extend(_read_lines(os.getenv("ISKOLAR_TOKEN_FILE", ""), "token"))

    many = os.getenv("ISKOLAR_ACCESS_TOKENS", "")
    if many.strip():
        values.extend(part.strip() for part in re.split(r"[,\r\n]+", many) if part.strip())

    single = os.getenv("ISKOLAR_ACCESS_TOKEN", "").strip()
    if single:
        values.append(single)

    # Preserve order while ensuring that duplicate tokens do not look like
    # separate test accounts in startup diagnostics.
    return list(dict.fromkeys(values))


def _load_questions() -> list[str]:
    custom = _read_lines(os.getenv("ISKOLAR_QUESTIONS_FILE", ""), "question")
    questions = custom or DEFAULT_QUESTIONS
    too_long = [question for question in questions if len(question) > 4000]
    if too_long:
        raise ValueError("Every load-test question must be at most 4,000 characters")
    return questions


WAIT_MIN_SECONDS = _env_float("ISKOLAR_WAIT_MIN_SECONDS", 4.0, minimum=0.0)
WAIT_MAX_SECONDS = _env_float("ISKOLAR_WAIT_MAX_SECONDS", 8.0, minimum=WAIT_MIN_SECONDS)
NEW_TOPIC_PROBABILITY = _env_float(
    "ISKOLAR_NEW_TOPIC_PROBABILITY", 0.70, minimum=0.0
)
if NEW_TOPIC_PROBABILITY > 1:
    raise ValueError("ISKOLAR_NEW_TOPIC_PROBABILITY must be between 0 and 1")

REQUEST_TIMEOUT_SECONDS = _env_float("ISKOLAR_REQUEST_TIMEOUT", 180.0, minimum=1.0)
REQUESTS_PER_USER = _env_int("ISKOLAR_REQUESTS_PER_USER", 0, minimum=0)
ALLOW_TOKEN_REUSE = _env_bool("ISKOLAR_ALLOW_TOKEN_REUSE")
MAX_FAILURE_RATIO = _env_float("ISKOLAR_MAX_FAILURE_RATIO", -1.0)
MAX_P95_MS = _env_float("ISKOLAR_MAX_P95_MS", -1.0)
MIN_REQUESTS = _env_int("ISKOLAR_MIN_REQUESTS", 1, minimum=0)
ALLOW_UNAUTHENTICATED = _env_bool("ISKOLAR_ALLOW_UNAUTHENTICATED")

if MAX_FAILURE_RATIO > 1:
    raise ValueError("ISKOLAR_MAX_FAILURE_RATIO must be between 0 and 1, or unset")
if MODEL_VARIANT not in {"flash", "pro", "r1"}:
    raise ValueError("ISKOLAR_MODEL_VARIANT must be flash, pro, or r1")
if REASONING_EFFORT not in {"low", "medium", "high"}:
    raise ValueError("ISKOLAR_REASONING_EFFORT must be low, medium, or high")

TOKENS = _load_tokens()
QUESTIONS = _load_questions()
_token_lock = threading.Lock()
_next_token_index = 0


def _claim_token() -> str | None:
    """Assign one token per user, unless reuse was explicitly enabled."""
    global _next_token_index
    if not TOKENS:
        return None
    with _token_lock:
        if _next_token_index >= len(TOKENS) and not ALLOW_TOKEN_REUSE:
            return None
        token = TOKENS[_next_token_index % len(TOKENS)]
        _next_token_index += 1
    return token


def _token_expiry(token: str) -> float | None:
    """Read a JWT expiry for startup validation without logging the token."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return float(claims["exp"])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _response_detail(response) -> str:
    """Return a short, single-line error without flooding Locust's error table."""
    try:
        body = response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
        text = str(detail if detail is not None else body)
    except (ValueError, TypeError):
        text = response.text or "empty response"
    return " ".join(text.split())[:300]


@events.test_start.add_listener
def validate_test_configuration(environment, **_kwargs) -> None:
    """Stop early when a protected endpoint would only produce 401 responses."""
    if not TOKENS and not ALLOW_UNAUTHENTICATED:
        LOGGER.error(
            "No access token configured. Set ISKOLAR_TOKEN_FILE, "
            "ISKOLAR_ACCESS_TOKENS, or ISKOLAR_ACCESS_TOKEN."
        )
        environment.process_exit_code = 2
        if environment.runner is not None:
            environment.runner.quit()
        return

    if len(TOKENS) == 1:
        LOGGER.warning(
            "Only one unique token is configured. A realistic run is limited to "
            "one virtual user unless token reuse is explicitly enabled."
        )

    expired = [
        index + 1
        for index, token in enumerate(TOKENS)
        if (expiry := _token_expiry(token)) is not None and expiry <= time.time()
    ]
    if expired:
        LOGGER.error(
            "Expired access token(s) at line(s): %s. Sign in again and replace "
            "them before testing.",
            ", ".join(map(str, expired)),
        )
        environment.process_exit_code = 2
        if environment.runner is not None:
            environment.runner.quit()
        return

    requested_users = getattr(environment.parsed_options, "num_users", 0) or getattr(
        environment.runner, "target_user_count", 0
    )
    if TOKENS and requested_users > len(TOKENS):
        if ALLOW_TOKEN_REUSE:
            LOGGER.warning(
                "%d virtual users requested but only %d unique tokens are configured; "
                "some users will share an account and its rate limit.",
                requested_users,
                len(TOKENS),
            )
        else:
            LOGGER.error(
                "%d users requested but only %d unique tokens are configured. "
                "Add tokens or explicitly set ISKOLAR_ALLOW_TOKEN_REUSE=true.",
                requested_users,
                len(TOKENS),
            )
            environment.process_exit_code = 2
            if environment.runner is not None:
                environment.runner.quit()
            return

    LOGGER.info(
        "ISKOLARChat load test: endpoint=%s, accounts=%d, questions=%d, "
        "think_time=%.1f-%.1fs, requests_per_user=%s",
        CHAT_ENDPOINT,
        len(TOKENS),
        len(QUESTIONS),
        WAIT_MIN_SECONDS,
        WAIT_MAX_SECONDS,
        REQUESTS_PER_USER or "unlimited",
    )


@events.quitting.add_listener
def enforce_optional_thresholds(environment, **_kwargs) -> None:
    """Give headless/CI runs a non-zero exit code when an SLA is missed."""
    stats = environment.stats.total
    failures: list[str] = []

    if stats.num_requests < MIN_REQUESTS:
        failures.append(
            f"only {stats.num_requests} requests completed; minimum is {MIN_REQUESTS}"
        )

    if MAX_FAILURE_RATIO >= 0 and stats.fail_ratio > MAX_FAILURE_RATIO:
        failures.append(
            f"failure ratio {stats.fail_ratio:.2%} exceeded {MAX_FAILURE_RATIO:.2%}"
        )

    if MAX_P95_MS >= 0 and stats.num_requests:
        p95_ms = stats.get_response_time_percentile(0.95)
        if p95_ms > MAX_P95_MS:
            failures.append(f"p95 {p95_ms:.0f} ms exceeded {MAX_P95_MS:.0f} ms")

    if failures:
        LOGGER.error("Load-test thresholds failed: %s", "; ".join(failures))
        if not environment.process_exit_code:
            environment.process_exit_code = 1


class IskolarChatUser(HttpUser):
    """A student who alternates between new topics and contextual follow-ups."""

    wait_time = between(WAIT_MIN_SECONDS, WAIT_MAX_SECONDS)

    def on_start(self) -> None:
        token = _claim_token()
        if token is None and not ALLOW_UNAUTHENTICATED:
            raise StopUser()

        self.headers = {"Accept": "application/json"}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        self.history: list[dict[str, str]] = []
        self.requests_sent = 0

    @task
    def chat(self) -> None:
        try:
            self._chat_once()
        finally:
            self.requests_sent += 1
            if REQUESTS_PER_USER and self.requests_sent >= REQUESTS_PER_USER:
                raise StopUser()

    def _chat_once(self) -> None:
        starts_new_topic = not self.history or random.random() < NEW_TOPIC_PROBABILITY
        if starts_new_topic:
            self.history.clear()
            question = random.choice(QUESTIONS)
        else:
            question = random.choice(FOLLOW_UP_QUESTIONS)

        payload = {
            "question": question,
            "history": self.history,
            "model_variant": MODEL_VARIANT,
            "reasoning_effort": REASONING_EFFORT,
        }

        with self.client.post(
            CHAT_ENDPOINT,
            name="/api/chat",
            json=payload,
            headers=self.headers,
            timeout=REQUEST_TIMEOUT_SECONDS,
            catch_response=True,
        ) as response:
            if response.status_code == 401:
                response.failure("401 Unauthorized: token is missing, invalid, or expired")
                return
            if response.status_code == 429:
                response.failure(
                    "429 Rate limited: use distinct tokens or increase per-user think time"
                )
                return
            if response.status_code != 200:
                response.failure(
                    f"HTTP {response.status_code}: {_response_detail(response)}"
                )
                return

            try:
                data = response.json()
            except ValueError:
                response.failure("HTTP 200 response was not valid JSON")
                return

            if not isinstance(data, dict):
                response.failure("HTTP 200 response must be a JSON object")
                return

            answer = data.get("answer")
            if not isinstance(answer, str) or not answer.strip():
                response.failure("HTTP 200 response has an empty or invalid answer")
                return

            response.success()
            # Preserve realistic context while staying below the backend's
            # 20-message/8,000-character-per-message validation limits.
            self.history.extend(
                [
                    {"role": "user", "content": question},
                    {"role": "assistant", "content": answer.strip()[:8000]},
                ]
            )
            self.history = self.history[-8:]
