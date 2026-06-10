"""Phase 3 — Hybrid Retrieval and Ranking.

Step 1: simultaneous semantic (Qdrant) + keyword (BM25) search
Step 2: Reciprocal Rank Fusion — score(c) = Σ 1 / (k + rank_stream(c))
Step 3: top-K context selection
"""

from concurrent.futures import ThreadPoolExecutor

from ..config import get_settings
from . import bm25, embeddings, vectorstore


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

    def run_semantic(q: str) -> list[dict]:
        return vectorstore.semantic_search(embeddings.embed_query(q), s.search_top_n)

    def run_keyword(q: str) -> list[dict]:
        return bm25.keyword_search(q, s.search_top_n)

    with ThreadPoolExecutor(max_workers=max(2, 2 * len(queries))) as pool:
        semantic_futs = [pool.submit(run_semantic, q) for q in queries]
        keyword_futs = [pool.submit(run_keyword, q) for q in queries]
        streams = [f.result() for f in semantic_futs + keyword_futs]

    fused = _rrf_merge(streams, s.rrf_k)
    ranked = sorted(fused.values(), key=lambda c: c["rrf_score"], reverse=True)
    return ranked[: s.final_top_k]
