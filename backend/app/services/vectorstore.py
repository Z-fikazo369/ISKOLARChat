"""Phase 2 Step 5 — Vector Indexing (Qdrant Cloud)."""

import logging
import uuid
from functools import lru_cache

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)

from ..config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def _client() -> QdrantClient:
    s = get_settings()
    return QdrantClient(url=s.qdrant_url, api_key=s.qdrant_api_key, timeout=30)


def ensure_collection() -> None:
    s = get_settings()
    if not _client().collection_exists(s.qdrant_collection):
        _client().create_collection(
            collection_name=s.qdrant_collection,
            vectors_config=VectorParams(size=s.embed_dim, distance=Distance.COSINE),
        )
    _ensure_document_id_index()


def _ensure_document_id_index() -> None:
    """delete_document_chunks() filters on the document_id payload key, which
    Qdrant only allows once that key has a payload index. Creating it is
    idempotent — a second call just no-ops."""
    s = get_settings()
    try:
        _client().create_payload_index(
            collection_name=s.qdrant_collection,
            field_name="document_id",
            field_schema=PayloadSchemaType.KEYWORD,
        )
    except Exception as exc:
        # Usually "already indexed" — but log it so an auth/quota/network
        # failure is diagnosable instead of silently missing.
        logger.debug("Payload index creation skipped: %s", exc)


# Deterministic point ids: the same (document_id, chunk_index) always maps to
# the same point, so re-ingesting a document is a true upsert (overwrite)
# instead of piling up duplicate chunks under fresh random ids.
def _point_id(chunk: dict) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"iskolarchat:{chunk['document_id']}:{chunk['chunk_index']}"))


def upsert_chunks(chunks: list[dict], vectors: list[list[float]]) -> None:
    """chunks: [{text, document_id, source, page, chunk_index}]"""
    s = get_settings()
    # strict=True: if the embedding provider ever returned fewer vectors than
    # texts, silently truncating here would drop chunks while the documents
    # table still reports the full chunk_count — make it a loud error instead.
    points = [
        PointStruct(id=_point_id(chunk), vector=vec, payload=chunk)
        for chunk, vec in zip(chunks, vectors, strict=True)
    ]
    # Batched — a large document in a single upsert can exceed Qdrant Cloud's
    # request payload limit and fail after the embeddings were already paid for.
    for i in range(0, len(points), 128):
        _client().upsert(collection_name=s.qdrant_collection, points=points[i : i + 128])


def semantic_search(query_vector: list[float], limit: int) -> list[dict]:
    """Returns [{id, score, text, ...payload}] ordered by similarity."""
    s = get_settings()
    res = _client().query_points(
        collection_name=s.qdrant_collection,
        query=query_vector,
        limit=limit,
        with_payload=True,
    )
    return [{"id": str(p.id), "score": p.score, **(p.payload or {})} for p in res.points]


def scroll_all_chunks() -> list[dict]:
    """Fetch every chunk payload (used to build the BM25 index)."""
    s = get_settings()
    out: list[dict] = []
    offset = None
    while True:
        points, offset = _client().scroll(
            collection_name=s.qdrant_collection,
            limit=256,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        out.extend({"id": str(p.id), **(p.payload or {})} for p in points)
        if offset is None:
            break
    return out


def delete_document_chunks(document_id: str) -> None:
    s = get_settings()
    _ensure_document_id_index()
    _client().delete(
        collection_name=s.qdrant_collection,
        points_selector=FilterSelector(
            filter=Filter(
                must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
            )
        ),
    )
