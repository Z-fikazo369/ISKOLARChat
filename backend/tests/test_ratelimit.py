from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.deps import ratelimit


@pytest.fixture(autouse=True)
def clear_local_counters():
    with ratelimit._lock:
        ratelimit._hits.clear()
    yield
    with ratelimit._lock:
        ratelimit._hits.clear()


def _use_backend(monkeypatch: pytest.MonkeyPatch, backend: str) -> None:
    monkeypatch.setattr(
        ratelimit,
        "get_settings",
        lambda: SimpleNamespace(rate_limit_backend=backend),
    )


def test_supabase_counter_allows_request_and_hashes_identity(monkeypatch):
    _use_backend(monkeypatch, "supabase")
    supabase = MagicMock()
    supabase.rpc.return_value.execute.return_value = SimpleNamespace(data=True)
    monkeypatch.setattr(ratelimit, "get_supabase", lambda: supabase)

    ratelimit._check("chat", "student-1", 15, 60)

    function_name, params = supabase.rpc.call_args.args
    assert function_name == "consume_api_rate_limit"
    assert params["p_scope"] == "chat"
    assert params["p_key_hash"] != "student-1"
    assert len(params["p_key_hash"]) == 64
    assert params["p_max_requests"] == 15
    assert params["p_window_seconds"] == 60


def test_supabase_counter_returns_429_when_limit_is_reached(monkeypatch):
    _use_backend(monkeypatch, "supabase")
    supabase = MagicMock()
    supabase.rpc.return_value.execute.return_value = SimpleNamespace(data=False)
    monkeypatch.setattr(ratelimit, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc_info:
        ratelimit._check("chat", "student-1", 15, 60)

    assert exc_info.value.status_code == 429


def test_rpc_outage_uses_bounded_local_fallback(monkeypatch):
    _use_backend(monkeypatch, "supabase")
    supabase = MagicMock()
    supabase.rpc.return_value.execute.side_effect = RuntimeError("network down")
    monkeypatch.setattr(ratelimit, "get_supabase", lambda: supabase)

    ratelimit._check("chat", "student-1", 1, 60)
    with pytest.raises(HTTPException) as exc_info:
        ratelimit._check("chat", "student-1", 1, 60)

    assert exc_info.value.status_code == 429


def test_memory_backend_does_not_contact_supabase(monkeypatch):
    _use_backend(monkeypatch, "memory")
    get_supabase = MagicMock()
    monkeypatch.setattr(ratelimit, "get_supabase", get_supabase)

    ratelimit._check("chat", "student-1", 1, 60)

    get_supabase.assert_not_called()
