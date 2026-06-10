"""Simple in-memory per-user rate limiter.

Protects the LLM-backed endpoints from spam/abuse that would drain
OpenRouter/Cohere credits. In-memory is fine for a single uvicorn process;
swap for Redis if the backend is ever scaled out.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, status

from .auth import get_current_user

_lock = threading.Lock()
_hits: dict[tuple, deque] = defaultdict(deque)


def rate_limit(scope: str, max_requests: int, window_seconds: int = 60):
    """Dependency factory: at most `max_requests` per `window_seconds`,
    tracked per user per scope."""

    def dependency(user: dict = Depends(get_current_user)) -> dict:
        now = time.time()
        key = (scope, user["id"])
        with _lock:
            q = _hits[key]
            while q and now - q[0] > window_seconds:
                q.popleft()
            if len(q) >= max_requests:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "You're sending messages too quickly — please wait a moment and try again.",
                )
            q.append(now)
        return user

    return dependency
