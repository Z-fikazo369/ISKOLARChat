import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    environment: str = os.getenv("APP_ENV", "development").strip().lower()

    # Supabase
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    # Qdrant Cloud
    qdrant_url: str = os.getenv("QDRANT_URL", "")
    qdrant_api_key: str = os.getenv("QDRANT_API_KEY", "")
    qdrant_collection: str = os.getenv("QDRANT_COLLECTION", "iskolarchat_chunks")

    # Cohere Embed v3 (1024-dim)
    cohere_api_key: str = os.getenv("COHERE_API_KEY", "")
    embed_model: str = os.getenv("EMBED_MODEL", "embed-english-v3.0")
    embed_dim: int = int(os.getenv("EMBED_DIM", "1024"))

    # LLM — any OpenAI-compatible endpoint (OpenRouter, Gemini, Groq, ...)
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "deepseek/deepseek-v4-pro")
    # UI model modes stay provider-agnostic. Deployments can swap providers or
    # model generations without changing the API contract used by the frontend.
    llm_flash_model: str = os.getenv("LLM_FLASH_MODEL", "") or llm_model
    llm_pro_model: str = os.getenv("LLM_PRO_MODEL", "") or llm_model
    llm_reasoning_model: str = os.getenv("LLM_REASONING_MODEL", "") or llm_pro_model
    llm_max_concurrent_requests: int = int(os.getenv("LLM_MAX_CONCURRENT_REQUESTS", "6"))
    llm_queue_timeout_seconds: float = float(os.getenv("LLM_QUEUE_TIMEOUT_SECONDS", "30"))
    llm_request_timeout_seconds: float = float(os.getenv("LLM_REQUEST_TIMEOUT_SECONDS", "120"))
    # cheaper/faster model for relevance grading & decomposition (defaults to llm_model)
    grader_model: str = os.getenv("GRADER_MODEL", "") or os.getenv("LLM_MODEL", "deepseek/deepseek-v4-pro")

    # Moondream (optional — image captioning). Empty key = captioning skipped.
    moondream_api_key: str = os.getenv("MOONDREAM_API_KEY", "")

    # Vision model for student-attached images (document photos, memos, etc.)
    # — needs stronger OCR than Moondream can offer. Empty = fall back to Moondream.
    vision_model: str = os.getenv("VISION_MODEL", "qwen/qwen3-vl-8b-instruct")

    # Retrieval parameters
    chunk_size_words: int = int(os.getenv("CHUNK_SIZE_WORDS", "350"))
    chunk_overlap_words: int = int(os.getenv("CHUNK_OVERLAP_WORDS", "80"))
    search_top_n: int = int(os.getenv("SEARCH_TOP_N", "10"))      # per stream, per sub-query
    rrf_k: int = int(os.getenv("RRF_K", "60"))                    # RRF smoothing constant
    final_top_k: int = int(os.getenv("FINAL_TOP_K", "8"))         # chunks passed to the agent
    relevance_threshold: float = float(os.getenv("RELEVANCE_THRESHOLD", "0.5"))
    min_relevant_chunks: int = int(os.getenv("MIN_RELEVANT_CHUNKS", "1"))
    max_sub_queries: int = int(os.getenv("MAX_SUB_QUERIES", "3"))
    retrieval_max_workers: int = int(os.getenv("RETRIEVAL_MAX_WORKERS", "8"))

    # Shared rate limiting is safe across multiple backend instances. If the
    # database RPC is temporarily unavailable, the backend falls back locally.
    rate_limit_backend: str = os.getenv("RATE_LIMIT_BACKEND", "supabase").strip().lower()

    # Durable document-ingestion worker. Each backend instance may run one;
    # Supabase atomically assigns a job to only one worker.
    document_worker_enabled: bool = os.getenv("DOCUMENT_WORKER_ENABLED", "true").strip().lower() in (
        "1", "true", "yes", "on"
    )
    document_worker_poll_seconds: float = float(os.getenv("DOCUMENT_WORKER_POLL_SECONDS", "2"))
    document_job_stale_seconds: int = int(os.getenv("DOCUMENT_JOB_STALE_SECONDS", "900"))
    document_job_max_attempts: int = int(os.getenv("DOCUMENT_JOB_MAX_ATTEMPTS", "3"))

    # How often an instance checks whether another instance changed Qdrant and
    # its local BM25 keyword index needs rebuilding.
    bm25_sync_interval_seconds: float = float(os.getenv("BM25_SYNC_INTERVAL_SECONDS", "5"))

    # The comparison route returns full retrieval traces and performs several
    # provider calls. Keep it off unless explicitly enabled for a controlled demo.
    compare_endpoint_enabled: bool = os.getenv(
        "COMPARE_ENDPOINT_ENABLED", "false"
    ).strip().lower() in ("1", "true", "yes", "on")

    # Public API docs are useful locally but unnecessary production surface.
    api_docs_enabled: bool = os.getenv(
        "API_DOCS_ENABLED",
        "false" if environment == "production" else "true",
    ).strip().lower() in ("1", "true", "yes", "on")

    # strip() so "https://a.com, https://b.com" doesn't yield a leading-space
    # origin that silently never matches the browser's Origin header
    cors_origins: list = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def missing_required_settings(settings: Settings | None = None) -> list[str]:
    """Return deployment-critical settings that are blank, without values."""
    settings = settings or get_settings()
    required = {
        "SUPABASE_URL": settings.supabase_url,
        "SUPABASE_SERVICE_ROLE_KEY": settings.supabase_service_role_key,
        "QDRANT_URL": settings.qdrant_url,
        "COHERE_API_KEY": settings.cohere_api_key,
        "LLM_API_KEY": settings.llm_api_key,
    }
    return [name for name, value in required.items() if not str(value).strip()]


def invalid_security_settings(settings: Settings | None = None) -> list[str]:
    """Return unsafe deployment configuration names without secret values."""
    settings = settings or get_settings()
    invalid: list[str] = []
    if not settings.cors_origins:
        invalid.append("CORS_ORIGINS")
    elif "*" in settings.cors_origins:
        invalid.append("CORS_ORIGINS (wildcard is incompatible with credentials)")
    if settings.environment == "production" and any(
        origin.startswith("http://") and "localhost" not in origin
        for origin in settings.cors_origins
    ):
        invalid.append("CORS_ORIGINS (production origins must use HTTPS)")
    if settings.rate_limit_backend not in ("supabase", "memory"):
        invalid.append("RATE_LIMIT_BACKEND")
    return invalid
