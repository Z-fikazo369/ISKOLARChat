from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from ..deps.auth import require_admin
from ..pipeline.ingest import BUCKET, ingest_document
from ..services import bm25, vectorstore
from ..services.supabase_client import get_supabase

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
    """Deletes storage file, vectors, and the DB row together."""
    sb = get_supabase()
    row = sb.table("documents").select("*").eq("id", document_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Document not found")

    sb.storage.from_(BUCKET).remove([row.data["file_path"]])
    vectorstore.delete_document_chunks(document_id)
    sb.table("documents").delete().eq("id", document_id).execute()
    bm25.rebuild_index()
    return {"status": "deleted"}
