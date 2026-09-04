from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.routers import admin_applications


SUPERADMIN = {"id": "11111111-1111-1111-1111-111111111111", "role": "superadmin"}
APPLICATION_ID = UUID("22222222-2222-2222-2222-222222222222")


def test_review_uses_service_rpc_with_actor(monkeypatch):
    supabase = MagicMock()
    supabase.rpc.return_value.execute.return_value = SimpleNamespace(
        data={"id": str(APPLICATION_ID), "status": "approved"}
    )
    monkeypatch.setattr(admin_applications, "get_supabase", lambda: supabase)

    result = admin_applications.review_application(
        APPLICATION_ID,
        admin_applications.ReviewRequest(decision="approved"),
        SUPERADMIN,
    )

    assert result["status"] == "approved"
    supabase.rpc.assert_called_once_with(
        "review_admin_application",
        {
            "p_application_id": str(APPLICATION_ID),
            "p_decision": "approved",
            "p_actor_id": SUPERADMIN["id"],
        },
    )


def test_review_maps_outage_to_503(monkeypatch):
    """A plain network/runtime failure is an outage, not a conflict — the old
    blanket 409 told clients to retry against a broken dependency."""
    supabase = MagicMock()
    supabase.rpc.return_value.execute.side_effect = RuntimeError("sensitive DB detail")
    monkeypatch.setattr(admin_applications, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc:
        admin_applications.review_application(
            APPLICATION_ID,
            admin_applications.ReviewRequest(decision="rejected"),
            SUPERADMIN,
        )

    assert exc.value.status_code == 503
    assert "sensitive" not in exc.value.detail


def test_review_maps_already_reviewed_to_409(monkeypatch):
    supabase = MagicMock()
    supabase.rpc.return_value.execute.side_effect = APIError(
        {"message": "Admin application has already been reviewed", "code": "23514"}
    )
    monkeypatch.setattr(admin_applications, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc:
        admin_applications.review_application(
            APPLICATION_ID,
            admin_applications.ReviewRequest(decision="approved"),
            SUPERADMIN,
        )

    assert exc.value.status_code == 409
    assert "already reviewed" in exc.value.detail


def test_review_maps_missing_application_to_404(monkeypatch):
    supabase = MagicMock()
    supabase.rpc.return_value.execute.side_effect = APIError(
        {"message": "Admin application not found", "code": "P0002"}
    )
    monkeypatch.setattr(admin_applications, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc:
        admin_applications.review_application(
            APPLICATION_ID,
            admin_applications.ReviewRequest(decision="rejected"),
            SUPERADMIN,
        )

    assert exc.value.status_code == 404
