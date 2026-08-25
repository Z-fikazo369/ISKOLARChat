from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import bm25


@pytest.fixture(autouse=True)
def reset_bm25_state():
    with bm25._lock:
        bm25._bm25 = None
        bm25._chunks = []
        bm25._known_version = None
        bm25._last_version_check = 0.0
    yield
    with bm25._lock:
        bm25._bm25 = None
        bm25._chunks = []
        bm25._known_version = None
        bm25._last_version_check = 0.0


def _settings():
    return SimpleNamespace(bm25_sync_interval_seconds=0.25)


def test_sync_rebuilds_when_shared_version_changes(monkeypatch):
    monkeypatch.setattr(bm25, "get_settings", _settings)
    monkeypatch.setattr(bm25, "_read_shared_version", lambda: 4)
    scroll = MagicMock(return_value=[{"id": "chunk-1", "text": "enrollment guide"}])
    monkeypatch.setattr(bm25.vectorstore, "scroll_all_chunks", scroll)

    rebuilt = bm25.sync_if_needed(force=True)

    assert rebuilt is True
    assert bm25._known_version == 4
    assert bm25._chunks == [{"id": "chunk-1", "text": "enrollment guide"}]
    scroll.assert_called_once_with()


def test_sync_skips_rebuild_when_version_is_current(monkeypatch):
    monkeypatch.setattr(bm25, "get_settings", _settings)
    monkeypatch.setattr(bm25, "_read_shared_version", lambda: 4)
    scroll = MagicMock()
    monkeypatch.setattr(bm25.vectorstore, "scroll_all_chunks", scroll)
    bm25._known_version = 4

    rebuilt = bm25.sync_if_needed()

    assert rebuilt is False
    scroll.assert_not_called()


def test_forced_sync_builds_local_fallback_when_version_check_fails(monkeypatch):
    monkeypatch.setattr(bm25, "get_settings", _settings)
    monkeypatch.setattr(
        bm25,
        "_read_shared_version",
        MagicMock(side_effect=RuntimeError("database unavailable")),
    )
    monkeypatch.setattr(bm25.vectorstore, "scroll_all_chunks", lambda: [])

    rebuilt = bm25.sync_if_needed(force=True)

    assert rebuilt is True
    assert bm25._chunks == []
    assert bm25._known_version is None


def test_rebuild_and_publish_records_new_shared_version(monkeypatch):
    monkeypatch.setattr(bm25.vectorstore, "scroll_all_chunks", lambda: [])
    supabase = MagicMock()
    supabase.rpc.return_value.execute.return_value = SimpleNamespace(data=8)
    monkeypatch.setattr(bm25, "get_supabase", lambda: supabase)

    count = bm25.rebuild_and_publish()

    assert count == 0
    assert bm25._known_version == 8
    supabase.rpc.assert_called_once_with("bump_knowledge_base_version")
