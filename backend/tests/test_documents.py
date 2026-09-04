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


def _supabase_with_deletable_document():
    supabase = MagicMock()
    table = supabase.table.return_value

    table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
        SimpleNamespace(
            data={"id": "doc-1", "status": "ready", "file_path": "uploads/doc-1.pdf"}
        )
    )

    update = table.update.return_value
    update.eq.return_value = update
    update.execute.return_value = SimpleNamespace(data=[{"id": "doc-1"}])

    delete = table.delete.return_value
    delete.eq.return_value = delete
    delete.execute.return_value = SimpleNamespace(data=[{"id": "doc-1"}])
    return supabase


def test_delete_document_marks_deleting_before_cleanup(monkeypatch):
    """The 'deleting' tombstone must be set BEFORE vectors are removed, so
    the ingestion worker can see it and never re-upserts deleted chunks."""
    supabase = _supabase_with_deletable_document()
    order = []
    supabase.table.return_value.update.return_value.eq.return_value.execute.side_effect = (
        lambda: (order.append("mark_deleting"), SimpleNamespace(data=[{"id": "doc-1"}]))[1]
    )
    supabase.table.return_value.delete.return_value.eq.return_value.execute.side_effect = (
        lambda: (order.append("row_delete"), SimpleNamespace(data=[{"id": "doc-1"}]))[1]
    )
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)
    monkeypatch.setattr(
        documents.vectorstore,
        "delete_document_chunks",
        lambda doc_id: order.append("qdrant_delete"),
    )
    monkeypatch.setattr(
        documents.bm25, "rebuild_and_publish", lambda: order.append("bm25")
    )

    result = documents.delete_document("doc-1")

    assert result == {"status": "deleted"}
    supabase.table.return_value.update.assert_called_once_with({"status": "deleting"})
    assert order == ["mark_deleting", "qdrant_delete", "row_delete", "bm25"]


def test_delete_document_returns_503_when_tombstone_fails(monkeypatch):
    supabase = _supabase_with_deletable_document()
    supabase.table.return_value.update.return_value.eq.return_value.execute.side_effect = (
        RuntimeError("db down")
    )
    vector_cleanup = MagicMock()
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)
    monkeypatch.setattr(
        documents.vectorstore, "delete_document_chunks", vector_cleanup
    )

    with pytest.raises(HTTPException) as exc_info:
        documents.delete_document("doc-1")

    assert exc_info.value.status_code == 503
    # Nothing may be cleaned up when the tombstone could not be set.
    vector_cleanup.assert_not_called()


def test_delete_document_returns_not_found(monkeypatch):
    supabase = _supabase_with_document(None)
    monkeypatch.setattr(documents, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc_info:
        documents.delete_document("missing")

    assert exc_info.value.status_code == 404
