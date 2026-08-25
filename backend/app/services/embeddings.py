"""Phase 2 Step 4 — Embedding Generation (Cohere Embed v3)."""

from functools import lru_cache

import cohere

from ..config import get_settings


@lru_cache
def _client() -> cohere.Client:
    # Explicit timeout — the SDK default is 300s; retrieval must fail fast
    # instead of pinning a worker when Cohere is degraded.
    return cohere.Client(api_key=get_settings().cohere_api_key, timeout=60)


def embed_documents(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    s = get_settings()
    out: list[list[float]] = []
    # Cohere caps batch size at 96 texts per request
    for i in range(0, len(texts), 96):
        resp = _client().embed(
            texts=texts[i : i + 96],
            model=s.embed_model,
            input_type="search_document",
        )
        out.extend(resp.embeddings)
    return out


def embed_query(text: str) -> list[float]:
    resp = _client().embed(
        texts=[text],
        model=get_settings().embed_model,
        input_type="search_query",
    )
    return resp.embeddings[0]
