"""Rate limiting for endpoints that trigger paid model requests.

Supabase is the default counter store so multiple backend instances share the
same limits. A bounded in-memory implementation remains as an availability
fallback and for local development.
"""

import hashlib
import logging
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status

from ..config import get_settings
from ..services.supabase_client import get_supabase
from .auth import get_current_user

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_hits: dict[tuple, deque] = defaultdict(deque)
# Each key remembers its OWN scope's window — the eviction sweep must not
# evaluate a 60s-scope key against the current request's window, or a short
# window would evict still-active keys from longer scopes (silently raising
# their effective limits).
_windows: dict[tuple, int] = {}
_MAX_KEYS = 4096  # sweep threshold so the dict can't grow without bound


def _too_many_requests() -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "You're sending messages too quickly — please wait a moment and try again.",
    )


def _check_memory(scope: str, key_id: str, max_requests: int, window_seconds: int) -> None:
    now = time.time()
    key = (scope, key_id)
    with _lock:
        if len(_hits) > _MAX_KEYS:
            # Evict keys whose own window has fully expired (long-lived
            # process, many distinct users — the dict would otherwise leak).
            stale = [
                k for k, q in _hits.items() if not q or now - q[-1] > _windows.get(k, 0)
            ]
            for k in stale:
                del _hits[k]
                _windows.pop(k, None)
        q = _hits[key]
        _windows[key] = window_seconds
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= max_requests:
            raise _too_many_requests()
        q.append(now)


def _check_supabase(scope: str, key_id: str, max_requests: int, window_seconds: int) -> None:
    # Store a digest instead of raw user IDs or client IP addresses.
    key_hash = hashlib.sha256(f"{scope}:{key_id}".encode("utf-8")).hexdigest()
    result = get_supabase().rpc(
        "consume_api_rate_limit",
        {
            "p_scope": scope,
            "p_key_hash": key_hash,
            "p_max_requests": max_requests,
            "p_window_seconds": window_seconds,
        },
    ).execute()
    allowed = result.data
    if isinstance(allowed, list):
        allowed = allowed[0] if allowed else None
    if allowed is False:
        raise _too_many_requests()
    if allowed is not True:
        raise RuntimeError("Rate-limit database function returned an invalid result")


def _check(scope: str, key_id: str, max_requests: int, window_seconds: int) -> None:
    if get_settings().rate_limit_backend == "supabase":
        try:
            _check_supabase(scope, key_id, max_requests, window_seconds)
            return
        except HTTPException:
            raise
        except Exception:
            # Availability fallback: an RPC/network outage should not take the
            # whole chat endpoint down. The local process still enforces a cap.
            logger.exception("Shared rate limiter unavailable; using local fallback")
    _check_memory(scope, key_id, max_requests, window_seconds)


def rate_limit(scope: str, max_requests: int, window_seconds: int = 60):
    """Dependency factory: at most `max_requests` per `window_seconds`,
    tracked per user per scope."""

    def dependency(user: dict = Depends(get_current_user)) -> dict:
        _check(scope, user["id"], max_requests, window_seconds)
        return user

    return dependency


def rate_limit_ip(scope: str, max_requests: int, window_seconds: int = 60):
    """Like rate_limit but keyed by client IP — for endpoints that are public
    by design (no login) yet still trigger paid LLM/embedding calls."""

    def dependency(request: Request) -> None:
        if get_settings().trust_proxy_headers:
            # Behind a reverse proxy, request.client.host is the PROXY's
            # address — every visitor would share one bucket. Only trust the
            # forwarded chain when explicitly configured, because the header
            # is client-spoofable otherwise.
            ip = (
                request.headers.get("x-forwarded-for", "").split(",")[0].strip()
                or "unknown"
            )
        else:
            ip = request.client.host if request.client else "unknown"
        _check(scope, ip, max_requests, window_seconds)

    return dependency
