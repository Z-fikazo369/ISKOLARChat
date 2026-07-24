import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from ..deps.auth import require_admin
from ..pipeline.ingest import BUCKET, ingest_document
from ..services import bm25, vectorstore
from ..services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/{document_id}/ingest")
def queue_ingest(
    document_id: str,
    background: BackgroundTasks,
    _admin: dict = Depends(require_admin),
) -> dict:
    """Phase 1 Step 2 — queue the uploaded document for the ingestion pipeline."""
    sb = get_supabase()
    row = sb.table("documents").select("id").eq("id", document_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Document not found")
    sb.table("documents").update({"status": "processing", "error": None}).eq(
        "id", document_id
    ).execute()
    background.add_task(ingest_document, document_id)
    return {"status": "queued"}


@router.delete("/{document_id}")
def delete_document(document_id: str, _admin: dict = Depends(require_admin)) -> dict:
    """Deletes storage file, vectors, and the DB row together.

    The DB row is the source of truth for the admin UI, so removing it must
    not be blocked by a flaky external service. Storage + Qdrant cleanup are
    best-effort: failures are logged but never stop the row from being deleted
    (otherwise a single Qdrant hiccup would make documents un-deletable).
    """
    sb = get_supabase()
    row = sb.table("documents").select("*").eq("id", document_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Document not found")

    file_path = row.data.get("file_path")
    if file_path:
        try:
            sb.storage.from_(BUCKET).remove([file_path])
        except Exception:
            logger.exception("Storage cleanup failed for document %s", document_id)

    try:
        vectorstore.delete_document_chunks(document_id)
    except Exception:
        logger.exception("Vector cleanup failed for document %s", document_id)

    # The one step that must succeed — surface a real error if it doesn't.
    try:
        sb.table("documents").delete().eq("id", document_id).execute()
    except Exception as exc:
        logger.exception("DB row delete failed for document %s", document_id)
        raise HTTPException(500, f"Could not delete document: {exc}") from exc

    try:
        bm25.rebuild_index()
    except Exception:
        logger.exception("BM25 rebuild failed after deleting document %s", document_id)

    return {"status": "deleted"}
