"""Phase 3 — Keyword stream (BM25) of the hybrid retrieval engine.

The index lives in memory and is rebuilt from Qdrant payloads at startup
and after every ingestion. Fine for a university-scale corpus; swap for
a persistent index if the chunk count grows past ~100k.
"""

import re
import threading

from rank_bm25 import BM25Okapi

from . import vectorstore

_lock = threading.Lock()
_bm25: BM25Okapi | None = None
_chunks: list[dict] = []

_token_re = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _token_re.findall(text.lower())


def rebuild_index() -> int:
    """Reload all chunks from Qdrant and rebuild BM25. Returns chunk count."""
    global _bm25, _chunks
    chunks = vectorstore.scroll_all_chunks()
    corpus = [_tokenize(c.get("text", "")) for c in chunks]
    with _lock:
        _chunks = chunks
        _bm25 = BM25Okapi(corpus) if corpus else None
    return len(chunks)


def keyword_search(query: str, limit: int) -> list[dict]:
    """Returns [{id, score, text, ...payload}] ordered by BM25 score."""
    with _lock:
        bm25, chunks = _bm25, _chunks
    if bm25 is None:
        return []
    scores = bm25.get_scores(_tokenize(query))
    ranked = sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)[:limit]
    return [{**chunk, "score": float(score)} for chunk, score in ranked if score > 0]
