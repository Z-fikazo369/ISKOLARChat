"""Phase 2 Step 5 — Vector Indexing (Qdrant Cloud)."""

import uuid
from functools import lru_cache

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PointStruct,
    VectorParams,
)

from ..config import get_settings


@lru_cache
def _client() -> QdrantClient:
    s = get_settings()
    return QdrantClient(url=s.qdrant_url, api_key=s.qdrant_api_key)


def ensure_collection() -> None:
    s = get_settings()
    if not _client().collection_exists(s.qdrant_collection):
        _client().create_collection(
            collection_name=s.qdrant_collection,
            vectors_config=VectorParams(size=s.embed_dim, distance=Distance.COSINE),
        )


def upsert_chunks(chunks: list[dict], vectors: list[list[float]]) -> None:
    """chunks: [{text, document_id, source, page, chunk_index}]"""
    s = get_settings()
    points = [
        PointStruct(id=str(uuid.uuid4()), vector=vec, payload=chunk)
        for chunk, vec in zip(chunks, vectors)
    ]
    _client().upsert(collection_name=s.qdrant_collection, points=points)


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
    _client().delete(
        collection_name=s.qdrant_collection,
        points_selector=FilterSelector(
            filter=Filter(
                must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
            )
        ),
    )
