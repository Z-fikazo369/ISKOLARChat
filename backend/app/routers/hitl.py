import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..deps.auth import require_admin
from ..pipeline.ingest import ingest_hitl_answer
from ..services import bm25, vectorstore
from ..services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hitl", tags=["hitl"])


class ResolveRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=8000)


@router.post("/{request_id}/resolve")
def resolve(request_id: str, body: ResolveRequest, admin: dict = Depends(require_admin)) -> dict:
    """Phase 1 Steps 3-4 — store the admin answer and re-ingest it as a
    knowledge chunk so future queries are answered automatically.

    Re-resolving an ANSWERED request is allowed on purpose (fixing a typo in
    the answer replaces the old chunk — ingest_hitl_answer is idempotent).
    A REJECTED request must stay rejected: resurrecting dismissed spam would
    silently re-ingest it into the knowledge base."""
    sb = get_supabase()
    row = sb.table("chat_requests").select("*").eq("id", request_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Chat request not found")
    if row.data.get("status") == "rejected":
        raise HTTPException(409, "This query was rejected and cannot be answered.")

    answer = body.answer.strip()

    # Ingest FIRST, then mark the row answered — the reverse order would let a
    # failed ingest leave a row claiming answer_ingested=True while the chunk
    # never reached the knowledge base (and nothing would flag it for retry).
    try:
        ingest_hitl_answer(request_id, row.data["question"], answer)
    except Exception:
        logger.exception("Knowledge-base ingest failed for HITL query %s", request_id)
        raise HTTPException(
            502,
            "Couldn't save the answer to the knowledge base — please try again.",
        )

    try:
        updated = (
            sb.table("chat_requests")
            .update(
                {
                    "status": "answered",
                    "admin_response": answer,
                    "responded_by": admin["id"],
                    "answer_ingested": True,
                }
            )
            .eq("id", request_id)
            .in_("status", ["pending", "answered"])  # CAS: a concurrent
            # reject/delete between our read and this write must win instead.
            .execute()
        )
    except Exception as exc:
        # The chunk is already in the knowledge base, but the row still says
        # pending — loud log + retry is safe because the ingest above is
        # idempotent.
        logger.exception(
            "Answer ingested for HITL query %s but the row update failed", request_id
        )
        raise HTTPException(
            503, "The request service is temporarily unavailable. Please retry."
        ) from exc
    if not updated.data:
        raise HTTPException(409, "This query was rejected or deleted in the meantime.")
    return {"status": "answered", "ingested": True}


@router.post("/{request_id}/reject")
def reject(request_id: str, admin: dict = Depends(require_admin)) -> dict:
    """Dismiss a query (spam/out-of-scope) without answering or ingesting.

    Only PENDING requests can be rejected: rejecting an answered one would
    hide it from the student while its answer chunk keeps living in the
    knowledge base (delete_request exists for that cleanup)."""
    sb = get_supabase()
    row = sb.table("chat_requests").select("id, status").eq("id", request_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Chat request not found")
    if row.data.get("status") != "pending":
        raise HTTPException(409, "Only pending queries can be rejected.")
    try:
        sb.table("chat_requests").update(
            {"status": "rejected", "responded_by": admin["id"]}
        ).eq("id", request_id).eq("status", "pending").execute()
    except Exception as exc:
        logger.exception("Reject failed for HITL query %s", request_id)
        raise HTTPException(
            503, "The request service is temporarily unavailable. Please retry."
        ) from exc
    return {"status": "rejected"}


@router.delete("/pending")
def clear_pending_requests(_admin: dict = Depends(require_admin)) -> dict:
    """Delete all unanswered HITL requests in one database operation.

    Pending requests have never been ingested into the knowledge base, so no
    vector or BM25 cleanup is needed here.
    """
    sb = get_supabase()
    result = sb.table("chat_requests").delete().eq("status", "pending").execute()
    return {"status": "deleted", "deleted": len(result.data or [])}


@router.delete("/{request_id}")
def delete_request(request_id: str, _admin: dict = Depends(require_admin)) -> dict:
    """Deletes the query row AND any answer that was ingested into the
    knowledge base, so the system stops 'remembering' a deleted query.

    When an admin answered this query, resolve() pushed a chunk into Qdrant
    tagged document_id="hitl_<request_id>". Deleting only the chat_requests
    row would leave that chunk behind and keep surfacing the old answer.
    """
    sb = get_supabase()
    row = sb.table("chat_requests").select("id").eq("id", request_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Chat request not found")

    # Forget the ingested answer (no-op if the query was never answered).
    try:
        vectorstore.delete_document_chunks(f"hitl_{request_id}")
        bm25.rebuild_and_publish()
    except Exception:
        logger.exception("Knowledge-base cleanup failed for HITL query %s", request_id)

    try:
        sb.table("chat_requests").delete().eq("id", request_id).execute()
    except Exception as exc:
        logger.exception("Row delete failed for HITL query %s", request_id)
        raise HTTPException(
            503, "The request service is temporarily unavailable. Please retry."
        ) from exc
    return {"status": "deleted"}
