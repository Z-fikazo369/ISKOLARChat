import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import chat, documents, hitl
from .services import bm25, vectorstore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        vectorstore.ensure_collection()
        count = bm25.rebuild_index()
        logger.info("BM25 index ready (%d chunks)", count)
    except Exception:
        logger.exception("Startup index build failed — check Qdrant settings")
    yield


app = FastAPI(title="ISKOLARChat RAG API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(hitl.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
