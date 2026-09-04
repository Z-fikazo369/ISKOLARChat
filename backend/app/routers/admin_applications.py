import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..deps.auth import require_superadmin
from ..services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin-applications", tags=["admin-applications"])


class ReviewRequest(BaseModel):
    decision: Literal["approved", "rejected"]


@router.post("/{application_id}/review")
def review_application(
    application_id: UUID,
    body: ReviewRequest,
    superadmin: dict = Depends(require_superadmin),
) -> dict:
    """Review through an RPC that is executable only by the service role."""
    try:
        result = get_supabase().rpc(
            "review_admin_application",
            {
                "p_application_id": str(application_id),
                "p_decision": body.decision,
                "p_actor_id": superadmin["id"],
            },
        ).execute()
    except Exception as exc:
        # Map the RPC's own error codes to honest status codes instead of
        # blanket-mapping every failure to 409 — a network blip is NOT a
        # conflict, and telling the client "refresh and retry" on a real
        # outage just drives a retry loop against a broken dependency.
        code = getattr(exc, "code", None)
        if code == "23514":  # already reviewed — a genuine conflict
            logger.info(
                "Admin application %s was already reviewed (attempt by %s)",
                application_id,
                superadmin["id"],
            )
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This application was already reviewed. Refresh the list.",
            ) from exc
        if code == "P0002":  # raise ... 'Admin application not found'
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "This application no longer exists. Refresh the list.",
            ) from exc
        logger.exception(
            "Admin application review failed for application %s by %s",
            application_id,
            superadmin["id"],
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The application service is temporarily unavailable — please try again.",
        ) from exc

    if not isinstance(result.data, dict):
        logger.error("Admin review RPC returned an invalid payload")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "The application review service returned an invalid response.",
        )
    return result.data
