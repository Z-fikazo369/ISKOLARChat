"""LLM access via any OpenAI-compatible endpoint (OpenRouter, Gemini, Groq, ...).

DeepSeek R1 emits chain-of-thought either in a `reasoning` field or inside
<think>...</think> tags; helpers below separate reasoning from the answer.
"""

import json
import re
import threading
from contextlib import contextmanager
from functools import lru_cache

from openai import OpenAI

from ..config import get_settings

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


class LLMCapacityError(RuntimeError):
    """Raised when the local provider-call queue remains saturated."""


@lru_cache
def _capacity_gate() -> threading.BoundedSemaphore:
    limit = min(64, max(1, get_settings().llm_max_concurrent_requests))
    return threading.BoundedSemaphore(limit)


@contextmanager
def _provider_slot():
    timeout = max(0.0, get_settings().llm_queue_timeout_seconds)
    gate = _capacity_gate()
    if not gate.acquire(timeout=timeout):
        raise LLMCapacityError(
            "AI provider capacity is busy; please retry shortly."
        )
    try:
        yield
    finally:
        gate.release()


@lru_cache
def _client() -> OpenAI:
    s = get_settings()
    # Explicit timeout — the SDK default is 600s, which would let one hanging
    # upstream request pin a threadpool worker for 10 minutes.
    timeout = max(1.0, s.llm_request_timeout_seconds)
    return OpenAI(base_url=s.llm_base_url, api_key=s.llm_api_key, timeout=timeout)


def _extra_body(effort: str | None = None) -> dict:
    base_url = get_settings().llm_base_url.lower()
    extra: dict = {}
    # OpenRouter routes each request to one of several upstream providers,
    # whose speed varies wildly; prefer the highest-throughput one.
    # (Param is OpenRouter-specific — Groq etc. would reject it.)
    if "openrouter" in base_url:
        extra["provider"] = {"sort": "throughput"}
        if effort:
            extra["reasoning"] = {"effort": effort}
    elif "generativelanguage.googleapis.com" in base_url and effort:
        # Gemini's OpenAI-compatible endpoint accepts reasoning_effort as a
        # top-level request field. extra_body is merged into that request by
        # the OpenAI SDK, preserving the existing provider-neutral client.
        extra["reasoning_effort"] = effort
    return extra


def chat(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.2,
    effort: str | None = None,
) -> tuple[str, str]:
    """Returns (answer, reasoning). `effort` ('low'/'medium'/'high') controls
    how much the model thinks before answering when the provider supports it."""
    s = get_settings()
    extra = _extra_body(effort)
    with _provider_slot():
        resp = _client().chat.completions.create(
            model=model or s.llm_model,
            messages=messages,
            temperature=temperature,
            extra_body=extra,
        )
    msg = resp.choices[0].message
    content = msg.content or ""
    reasoning = getattr(msg, "reasoning", None) or ""
    thinks = _THINK_RE.findall(content)
    if thinks:
        reasoning = reasoning or "\n".join(t[7:-8].strip() for t in thinks)
        content = _THINK_RE.sub("", content).strip()
    return content.strip(), reasoning.strip()


def ask_about_image(question: str, image_data_url: str, system: str | None = None) -> tuple[str, str]:
    """Ask the configured vision model about an image. Returns (answer, reasoning)."""
    s = get_settings()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": question},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    )
    with _provider_slot():
        resp = _client().chat.completions.create(
            model=s.vision_model,
            messages=messages,
            temperature=0.2,
            extra_body=_extra_body(),
        )
    msg = resp.choices[0].message
    content = _THINK_RE.sub("", msg.content or "").strip()
    return content, (getattr(msg, "reasoning", None) or "").strip()


def _first_json_span(text: str) -> str | None:
    """Outermost JSON value embedded in prose: from the first [ or { to the
    last matching closer of that bracket type."""
    starts = [i for i in (text.find("["), text.find("{")) if i != -1]
    if not starts:
        return None
    start = min(starts)
    closer = "]" if text[start] == "[" else "}"
    end = text.rfind(closer)
    if end > start:
        return text[start : end + 1]
    return None


def chat_json(messages: list[dict], model: str | None = None, retries: int = 1) -> dict | list | None:
    """Chat call whose reply is expected to be JSON; tolerates code fences
    and R1 thinking tags. Retries once on a malformed reply (a single grader
    hiccup must not cascade into a wrong routing decision). Returns None if
    parsing still fails."""
    for _ in range(retries + 1):
        content, _ = chat(messages, model=model, temperature=0.0)
        text = content.strip()
        # Strip ONE fence pair anchored to the WHOLE reply. Per-line stripping
        # (re.MULTILINE) corrupted valid JSON whose string values contained
        # ``` lines — e.g. document chunks being graded.
        fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, flags=re.DOTALL)
        if fenced:
            text = fenced.group(1)
        # Direct parse first; fall back to the embedded span for prose-wrapped
        # replies.
        for candidate in (text, _first_json_span(text)):
            if candidate is None:
                continue
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue
    return None
