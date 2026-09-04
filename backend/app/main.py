import asyncio
import logging
from contextlib import asynccontextmanager
from contextlib import suppress

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings, invalid_security_settings, missing_required_settings
from .routers import admin_applications, chat, compare, documents, hitl
from .services import bm25, retrieval, vectorstore
from .services.supabase_client import get_supabase
from .workers.document_ingestion import run_document_worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _warm_dependencies() -> None:
    """Synchronous dependency warm-up — run off the event loop (below)."""
    # Lightweight read verifies Supabase/PostgREST without changing data.
    get_supabase().table("profiles").select("id").limit(1).execute()
    vectorstore.ensure_collection()
    bm25.sync_if_needed(force=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    missing = missing_required_settings(settings)
    invalid = invalid_security_settings(settings)
    app.state.configuration_ready = not missing and not invalid
    app.state.dependencies_ready = False
    app.state.document_worker_task = None
    if missing:
        logger.error("Missing required configuration: %s", ", ".join(missing))
    if invalid:
        logger.error("Invalid security configuration: %s", ", ".join(invalid))
    try:
        # These are blocking network calls (plus a full BM25 scroll-rebuild) —
        # running them directly on the event loop would freeze every request
        # for the whole duration, so push them to a worker thread.
        await asyncio.to_thread(_warm_dependencies)
        app.state.dependencies_ready = True
        logger.info("BM25 index ready")
    except Exception:
        logger.exception("Startup index build failed — check Qdrant settings")

    worker_task = None
    if settings.document_worker_enabled:
        worker_task = asyncio.create_task(
            run_document_worker(), name="document-ingestion-worker"
        )
        app.state.document_worker_task = worker_task
    try:
        yield
    finally:
        app.state.dependencies_ready = False
        if worker_task:
            worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await worker_task
        retrieval.shutdown_executor()


_settings = get_settings()
app = FastAPI(
    title="ISKOLARChat RAG API",
    lifespan=lifespan,
    docs_url="/docs" if _settings.api_docs_enabled else None,
    redoc_url="/redoc" if _settings.api_docs_enabled else None,
    openapi_url="/openapi.json" if _settings.api_docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    # Fail closed if a wildcard slips into configuration. Readiness also reports
    # the invalid setting, but the middleware must not become permissive first.
    allow_origins=[] if "*" in _settings.cors_origins else _settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(chat.router)
if _settings.compare_endpoint_enabled:
    app.include_router(compare.router)
app.include_router(documents.router)
app.include_router(hitl.router)
app.include_router(admin_applications.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/health/ready")
def readiness(request: Request, response: Response) -> dict:
    """Deployment readiness without exposing keys or dependency error details."""
    settings = get_settings()
    worker_task = getattr(request.app.state, "document_worker_task", None)
    checks = {
        "configuration": bool(
            getattr(request.app.state, "configuration_ready", False)
        ),
        "dependencies": bool(
            getattr(request.app.state, "dependencies_ready", False)
        ),
        "document_worker": (
            not settings.document_worker_enabled
            or (worker_task is not None and not worker_task.done())
        ),
    }
    ready = all(checks.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if ready else "not_ready", "checks": checks}
