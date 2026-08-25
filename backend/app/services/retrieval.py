"""Phase 3 — Hybrid Retrieval and Ranking.

Step 1: simultaneous semantic (Qdrant) + keyword (BM25) search
Step 2: Reciprocal Rank Fusion — score(c) = Σ 1 / (k + rank_stream(c))
Step 3: top-K context selection
"""

from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from ..config import get_settings
from . import bm25, embeddings, vectorstore


@lru_cache
def _executor() -> ThreadPoolExecutor:
    """One bounded pool per backend process, shared by every chat request."""
    workers = min(32, max(2, get_settings().retrieval_max_workers))
    return ThreadPoolExecutor(max_workers=workers, thread_name_prefix="retrieval")


def shutdown_executor() -> None:
    """Release retrieval threads during a graceful backend shutdown."""
    if _executor.cache_info().currsize:
        _executor().shutdown(wait=False, cancel_futures=True)
        _executor.cache_clear()


def _normalize_queries(queries: list[str], limit: int) -> list[str]:
    """Trim, de-duplicate, and cap untrusted LLM-generated sub-queries."""
    normalized: list[str] = []
    seen: set[str] = set()
    for query in queries:
        if not isinstance(query, str):
            continue
        clean = query.strip()
        key = clean.casefold()
        if not clean or key in seen:
            continue
        seen.add(key)
        normalized.append(clean)
        if len(normalized) >= limit:
            break
    return normalized


def _rrf_merge(streams: list[list[dict]], k: int) -> dict[str, dict]:
    """Accumulate RRF scores across result streams, keyed by chunk id."""
    fused: dict[str, dict] = {}
    for stream in streams:
        for rank, chunk in enumerate(stream, start=1):
            entry = fused.setdefault(chunk["id"], {**chunk, "rrf_score": 0.0})
            entry["rrf_score"] += 1.0 / (k + rank)
    return fused


def hybrid_search(queries: list[str]) -> list[dict]:
    """Run both streams for every (sub-)query concurrently, fuse with RRF,
    and return the global top-K chunks."""
    s = get_settings()
    normalized_queries = _normalize_queries(
        queries, min(5, max(1, s.max_sub_queries))
    )
    if not normalized_queries:
        return []
    bm25.sync_if_needed()

    def run_semantic(q: str) -> list[dict]:
        return vectorstore.semantic_search(embeddings.embed_query(q), s.search_top_n)

    def run_keyword(q: str) -> list[dict]:
        return bm25.keyword_search(q, s.search_top_n)

    pool = _executor()
    semantic_futs = [pool.submit(run_semantic, q) for q in normalized_queries]
    keyword_futs = [pool.submit(run_keyword, q) for q in normalized_queries]
    streams = [future.result() for future in semantic_futs + keyword_futs]

    fused = _rrf_merge(streams, s.rrf_k)
    ranked = sorted(fused.values(), key=lambda c: c["rrf_score"], reverse=True)
    return ranked[: s.final_top_k]
