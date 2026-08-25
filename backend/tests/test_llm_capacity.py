from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import llm


@pytest.fixture(autouse=True)
def reset_llm_caches():
    llm._client.cache_clear()
    llm._capacity_gate.cache_clear()
    yield
    llm._client.cache_clear()
    llm._capacity_gate.cache_clear()


def _settings(**overrides):
    values = {
        "llm_base_url": "https://example.test/v1",
        "llm_api_key": "test-key",
        "llm_model": "test-model",
        "vision_model": "test-vision",
        "llm_max_concurrent_requests": 2,
        "llm_queue_timeout_seconds": 0,
        "llm_request_timeout_seconds": 10,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_capacity_gate_uses_configured_limit(monkeypatch):
    monkeypatch.setattr(llm, "get_settings", lambda: _settings(llm_max_concurrent_requests=3))

    gate = llm._capacity_gate()

    assert gate._initial_value == 3


def test_chat_fails_cleanly_when_capacity_is_saturated(monkeypatch):
    gate = MagicMock()
    gate.acquire.return_value = False
    monkeypatch.setattr(llm, "get_settings", lambda: _settings())
    monkeypatch.setattr(llm, "_capacity_gate", lambda: gate)
    client = MagicMock()
    monkeypatch.setattr(llm, "_client", lambda: client)

    with pytest.raises(llm.LLMCapacityError, match="capacity is busy"):
        llm.chat([{"role": "user", "content": "Hello"}])

    client.chat.completions.create.assert_not_called()
    gate.release.assert_not_called()


def test_provider_slot_is_released_after_upstream_error(monkeypatch):
    gate = MagicMock()
    gate.acquire.return_value = True
    monkeypatch.setattr(llm, "get_settings", lambda: _settings())
    monkeypatch.setattr(llm, "_capacity_gate", lambda: gate)
    client = MagicMock()
    client.chat.completions.create.side_effect = RuntimeError("upstream failed")
    monkeypatch.setattr(llm, "_client", lambda: client)

    with pytest.raises(RuntimeError, match="upstream failed"):
        llm.chat([{"role": "user", "content": "Hello"}])

    gate.release.assert_called_once_with()


def test_gemini_reasoning_effort_uses_openai_compatible_field(monkeypatch):
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: _settings(
            llm_base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
        ),
    )

    assert llm._extra_body("high") == {"reasoning_effort": "high"}


def test_openrouter_routing_and_reasoning_are_preserved(monkeypatch):
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: _settings(llm_base_url="https://openrouter.ai/api/v1"),
    )

    assert llm._extra_body("medium") == {
        "provider": {"sort": "throughput"},
        "reasoning": {"effort": "medium"},
    }
