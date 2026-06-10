from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..deps.auth import require_admin
from ..pipeline.ingest import ingest_hitl_answer
from ..services.supabase_client import get_supabase

router = APIRouter(prefix="/api/hitl", tags=["hitl"])


class ResolveRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=8000)


@router.post("/{request_id}/resolve")
def resolve(request_id: str, body: ResolveRequest, admin: dict = Depends(require_admin)) -> dict:
    """Phase 1 Steps 3-4 — store the admin answer and re-ingest it as a
    knowledge chunk so future queries are answered automatically."""
    sb = get_supabase()
    row = sb.table("chat_requests").select("*").eq("id", request_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Chat request not found")

    answer = body.answer.strip()
    sb.table("chat_requests").update(
        {
            "status": "answered",
            "admin_response": answer,
            "responded_by": admin["id"],
            "answer_ingested": True,
        }
    ).eq("id", request_id).execute()

    ingest_hitl_answer(request_id, row.data["question"], answer)
    return {"status": "answered", "ingested": True}


@router.post("/{request_id}/reject")
def reject(request_id: str, admin: dict = Depends(require_admin)) -> dict:
    """Dismiss a query (spam/out-of-scope) without answering or ingesting."""
    sb = get_supabase()
    row = sb.table("chat_requests").select("id").eq("id", request_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Chat request not found")
    sb.table("chat_requests").update(
        {"status": "rejected", "responded_by": admin["id"]}
    ).eq("id", request_id).execute()
    return {"status": "rejected"}


@router.delete("/{request_id}")
def delete_request(request_id: str, _admin: dict = Depends(require_admin)) -> dict:
    sb = get_supabase()
    row = sb.table("chat_requests").select("id").eq("id", request_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(404, "Chat request not found")
    sb.table("chat_requests").delete().eq("id", request_id).execute()
    return {"status": "deleted"}
