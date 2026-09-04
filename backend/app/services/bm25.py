"""In-memory BM25 keyword stream with cross-instance synchronization.

Qdrant is the chunk source of truth. Supabase stores only a shared version
number so each backend instance can lazily rebuild after another instance
changes the knowledge base.
"""

import logging
import re
import threading
import time

from rank_bm25 import BM25Okapi

from ..config import get_settings
from . import vectorstore
from .supabase_client import get_supabase

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_refresh_lock = threading.Lock()
_bm25: BM25Okapi | None = None
_chunks: list[dict] = []
_known_version: int | None = None
_last_version_check = 0.0
# Set whenever a rebuild happens; used for the periodic self-heal below.
_last_rebuild_ts = time.monotonic()

# Self-heal interval: if another instance crashes between its Qdrant upsert
# and the shared version bump, versions match but this index is stale, and
# nothing would ever trigger a rebuild. A periodic unconditional rebuild
# closes that window at the cost of one Qdrant scroll per interval.
_SELF_HEAL_SECONDS = 900.0

_token_re = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _token_re.findall(text.lower())


def rebuild_index(shared_version: int | None = None) -> int:
    """Reload all chunks from Qdrant and rebuild BM25. Returns chunk count."""
    global _bm25, _chunks, _known_version, _last_rebuild_ts
    chunks = vectorstore.scroll_all_chunks()
    corpus = [_tokenize(c.get("text", "")) for c in chunks]
    with _lock:
        _chunks = chunks
        _bm25 = BM25Okapi(corpus) if corpus else None
        if shared_version is not None:
            _known_version = shared_version
        _last_rebuild_ts = time.monotonic()
    return len(chunks)


def _read_shared_version() -> int:
    result = (
        get_supabase()
        .table("knowledge_base_state")
        .select("version")
        .eq("id", 1)
        .single()
        .execute()
    )
    return int(result.data["version"])


def _rpc_version(data) -> int:
    if isinstance(data, list):
        data = data[0] if data else None
    if isinstance(data, dict):
        data = data.get("version")
    if data is None:
        raise RuntimeError("Knowledge-version function returned no value")
    return int(data)


def rebuild_and_publish() -> int:
    """Rebuild locally, then notify every other backend instance."""
    global _known_version, _last_version_check
    count = rebuild_index()
    version = _rpc_version(
        get_supabase().rpc("bump_knowledge_base_version").execute().data
    )
    with _lock:
        _known_version = version
        _last_version_check = time.monotonic()
    return count


def sync_if_needed(force: bool = False) -> bool:
    """Refresh from Qdrant when the shared version changed.

    Returns True when a rebuild occurred. Failures keep the last usable local
    index; semantic retrieval remains available while synchronization recovers.
    """
    global _last_version_check
    now = time.monotonic()
    interval = max(0.25, get_settings().bm25_sync_interval_seconds)
    with _lock:
        if not force and now - _last_version_check < interval:
            return False

    # Only one request per process performs the version check/rebuild. Other
    # concurrent requests continue using the previous immutable index snapshot.
    if not _refresh_lock.acquire(blocking=False):
        return False
    try:
        now = time.monotonic()
        with _lock:
            if not force and now - _last_version_check < interval:
                return False
        try:
            shared_version = _read_shared_version()
            with _lock:
                needs_rebuild = (
                    force
                    or _known_version != shared_version
                    # Self-heal: another instance's crash between its Qdrant
                    # upsert and the version bump leaves matching versions
                    # with different content — rebuild periodically anyway.
                    or (time.monotonic() - _last_rebuild_ts > _SELF_HEAL_SECONDS)
                )
            if needs_rebuild:
                count = rebuild_index(shared_version=shared_version)
                logger.info(
                    "BM25 index synchronized at version %d (%d chunks)",
                    shared_version,
                    count,
                )
            with _lock:
                _last_version_check = time.monotonic()
            return needs_rebuild
        except Exception:
            with _lock:
                _last_version_check = time.monotonic()
            logger.exception("BM25 version synchronization failed; keeping current index")
            if force:
                # Startup remains backward-compatible if the coordination
                # migration has not been applied yet: build a usable local
                # index even though cross-instance sync is unavailable.
                try:
                    count = rebuild_index()
                    logger.info("BM25 local fallback ready (%d chunks)", count)
                    return True
                except Exception:
                    logger.exception("BM25 local fallback rebuild failed")
            return False
    finally:
        _refresh_lock.release()


def keyword_search(query: str, limit: int) -> list[dict]:
    """Returns [{id, score, text, ...payload}] ordered by BM25 score."""
    with _lock:
        bm25, chunks = _bm25, _chunks
    if bm25 is None:
        return []
    scores = bm25.get_scores(_tokenize(query))
    ranked = sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)[:limit]
    return [{**chunk, "score": float(score)} for chunk, score in ranked if score > 0]
