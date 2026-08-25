from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.routers import documents


def _supabase_with_document(status: str | None, queued: bool = True):
    supabase = MagicMock()
    table = supabase.table.return_value

    table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
        SimpleNamespace(
            data={"id": "doc-1", "status": status} if status is not None else None
        )
    )

    update = table.update.return_value
    update.eq.return_value = update
    update.execute.return_value = SimpleNamespace(
        data=[{"id": "doc-1"}] if queued else []
    )
    return supabase


def test_queue_ingest_keeps_queued_document_idempotent(monkeypatch):
    supabase = _supabase_with_document("queued")
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)

    result = documents.queue_ingest("doc-1")

    assert result == {"status": "queued"}
    supabase.table.return_value.update.assert_not_called()


def test_queue_ingest_retries_failed_document(monkeypatch):
    supabase = _supabase_with_document("failed")
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)

    result = documents.queue_ingest("doc-1")

    assert result == {"status": "queued"}
    supabase.table.return_value.update.assert_called_once_with(
        {
            "status": "queued",
            "error": None,
            "processing_started_at": None,
            "attempt_count": 0,
        }
    )


def test_queue_ingest_rejects_document_already_processing(monkeypatch):
    supabase = _supabase_with_document("processing")
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc_info:
        documents.queue_ingest("doc-1")

    assert exc_info.value.status_code == 409
    assert "already being processed" in exc_info.value.detail


def test_queue_ingest_rejects_concurrent_retry(monkeypatch):
    supabase = _supabase_with_document("failed", queued=False)
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc_info:
        documents.queue_ingest("doc-1")

    assert exc_info.value.status_code == 409
    assert "already queued" in exc_info.value.detail


def test_queue_ingest_returns_not_found(monkeypatch):
    supabase = _supabase_with_document(None)
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc_info:
        documents.queue_ingest("missing")

    assert exc_info.value.status_code == 404
