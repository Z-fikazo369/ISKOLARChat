import logging

from fastapi import APIRouter, Depends, HTTPException

from ..deps.auth import require_admin
from ..pipeline.ingest import BUCKET
from ..services import bm25, vectorstore
from ..services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/{document_id}/ingest")
def queue_ingest(
    document_id: str,
    _admin: dict = Depends(require_admin),
) -> dict:
    """Ensure a document is queued for the durable ingestion worker."""
    sb = get_supabase()
    row = sb.table("documents").select("id, status").eq("id", document_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Document not found")
    current_status = row.data.get("status")
    if current_status == "queued":
        return {"status": "queued"}
    if current_status != "failed":
        detail = (
            "Document is already being processed."
            if current_status == "processing"
            else f"Document cannot be queued from status '{current_status}'."
        )
        raise HTTPException(409, detail)
    # A failed document can be retried. Compare-and-set makes simultaneous
    # retry requests idempotent and resets its bounded-attempt counter.
    queued = (
        sb.table("documents")
        .update(
            {
                "status": "queued",
                "error": None,
                "processing_started_at": None,
                "attempt_count": 0,
            }
        )
        .eq("id", document_id)
        .eq("status", "failed")
        .execute()
    )
    if not queued.data:
        raise HTTPException(409, "Document was already queued by another request.")
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
        raise HTTPException(
            503, "The document service is temporarily unavailable. Please try again."
        ) from exc

    try:
        bm25.rebuild_and_publish()
    except Exception:
        logger.exception("BM25 rebuild failed after deleting document %s", document_id)

    return {"status": "deleted"}
