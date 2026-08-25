from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import retrieval


@pytest.fixture(autouse=True)
def reset_executor():
    retrieval._executor.cache_clear()
    yield
    if retrieval._executor.cache_info().currsize:
        retrieval._executor().shutdown(wait=True)
    retrieval._executor.cache_clear()


def _settings(max_workers=4, max_queries=2):
    return SimpleNamespace(
        retrieval_max_workers=max_workers,
        max_sub_queries=max_queries,
        search_top_n=5,
        rrf_k=60,
        final_top_k=8,
    )


def test_executor_is_shared_and_bounded(monkeypatch):
    monkeypatch.setattr(retrieval, "get_settings", lambda: _settings(max_workers=4))

    first = retrieval._executor()
    second = retrieval._executor()

    assert first is second
    assert first._max_workers == 4


def test_executor_is_released_on_shutdown(monkeypatch):
    monkeypatch.setattr(retrieval, "get_settings", lambda: _settings())
    executor = retrieval._executor()

    retrieval.shutdown_executor()

    assert retrieval._executor.cache_info().currsize == 0
    assert executor._shutdown is True


def test_hybrid_search_deduplicates_and_caps_subqueries(monkeypatch):
    monkeypatch.setattr(retrieval, "get_settings", lambda: _settings(max_queries=2))
    monkeypatch.setattr(retrieval.bm25, "sync_if_needed", lambda: False)
    embed_query = MagicMock(side_effect=lambda query: [float(len(query))])
    semantic_search = MagicMock(
        side_effect=lambda vector, _limit: [
            {"id": f"semantic-{vector[0]}", "text": "semantic"}
        ]
    )
    keyword_search = MagicMock(
        side_effect=lambda query, _limit: [
            {"id": f"keyword-{query}", "text": "keyword"}
        ]
    )
    monkeypatch.setattr(retrieval.embeddings, "embed_query", embed_query)
    monkeypatch.setattr(retrieval.vectorstore, "semantic_search", semantic_search)
    monkeypatch.setattr(retrieval.bm25, "keyword_search", keyword_search)

    results = retrieval.hybrid_search([" Enrollment ", "enrollment", "Tuition", "Calendar"])

    assert embed_query.call_count == 2
    assert {call.args[0] for call in embed_query.call_args_list} == {"Enrollment", "Tuition"}
    assert keyword_search.call_count == 2
    assert len(results) == 4


def test_hybrid_search_returns_empty_for_empty_queries(monkeypatch):
    monkeypatch.setattr(retrieval, "get_settings", lambda: _settings())
    sync = MagicMock()
    monkeypatch.setattr(retrieval.bm25, "sync_if_needed", sync)

    assert retrieval.hybrid_search([" ", ""]) == []
    sync.assert_not_called()
