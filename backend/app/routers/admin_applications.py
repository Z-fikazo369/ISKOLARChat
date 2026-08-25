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
        logger.exception(
            "Admin application review failed for application %s by %s",
            application_id,
            superadmin["id"],
        )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The application could not be reviewed. Refresh and try again.",
        ) from exc

    if not isinstance(result.data, dict):
        logger.error("Admin review RPC returned an invalid payload")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "The application review service returned an invalid response.",
        )
    return result.data
