import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
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

    # LLM — any OpenAI-compatible endpoint (OpenRouter, Groq, ...)
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "deepseek/deepseek-v4-pro")
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

    cors_origins: list = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")


@lru_cache
def get_settings() -> Settings:
    return Settings()
