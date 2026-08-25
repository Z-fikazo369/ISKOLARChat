from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.workers import document_ingestion


def test_claim_next_document_returns_claimed_id(monkeypatch):
    supabase = MagicMock()
    supabase.rpc.return_value.execute.return_value = SimpleNamespace(
        data=[{"document_id": "doc-1"}]
    )
    monkeypatch.setattr(document_ingestion, "get_supabase", lambda: supabase)

    document_id = document_ingestion.claim_next_document(900, 3)

    assert document_id == "doc-1"
    supabase.rpc.assert_called_once_with(
        "claim_document_ingestion",
        {"p_stale_after_seconds": 900, "p_max_attempts": 3},
    )


def test_claim_next_document_returns_none_for_empty_queue(monkeypatch):
    supabase = MagicMock()
    supabase.rpc.return_value.execute.return_value = SimpleNamespace(data=[])
    monkeypatch.setattr(document_ingestion, "get_supabase", lambda: supabase)

    assert document_ingestion.claim_next_document(900, 3) is None


def test_claim_next_document_rejects_malformed_response(monkeypatch):
    supabase = MagicMock()
    supabase.rpc.return_value.execute.return_value = SimpleNamespace(data=[{}])
    monkeypatch.setattr(document_ingestion, "get_supabase", lambda: supabase)

    with pytest.raises(RuntimeError, match="invalid result"):
        document_ingestion.claim_next_document(900, 3)
