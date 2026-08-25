from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.deps import auth


def _credentials() -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials="test-token")


def test_missing_credentials_returns_401() -> None:
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user(None)
    assert exc.value.status_code == 401


def test_invalid_token_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    supabase = MagicMock()
    supabase.auth.get_user.side_effect = RuntimeError("expired")
    monkeypatch.setattr(auth, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc:
        auth.get_current_user(_credentials())
    assert exc.value.status_code == 401


def test_authenticated_user_includes_profile_role(monkeypatch: pytest.MonkeyPatch) -> None:
    supabase = MagicMock()
    supabase.auth.get_user.return_value = SimpleNamespace(
        user=SimpleNamespace(
            id="student-1",
            email="student@example.com",
            user_metadata={"full_name": "Metadata Name"},
        )
    )
    execute = (
        supabase.table.return_value.select.return_value.eq.return_value
        .maybe_single.return_value.execute
    )
    execute.return_value = SimpleNamespace(
        data={"role": "admin", "full_name": "Profile Name"}
    )
    monkeypatch.setattr(auth, "get_supabase", lambda: supabase)

    user = auth.get_current_user(_credentials())

    assert user == {
        "id": "student-1",
        "email": "student@example.com",
        "name": "Profile Name",
        "role": "admin",
    }


def test_profile_outage_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    supabase = MagicMock()
    supabase.auth.get_user.return_value = SimpleNamespace(
        user=SimpleNamespace(
            id="student-1",
            email="student@example.com",
            user_metadata={},
        )
    )
    execute = (
        supabase.table.return_value.select.return_value.eq.return_value
        .maybe_single.return_value.execute
    )
    execute.side_effect = RuntimeError("network down")
    monkeypatch.setattr(auth, "get_supabase", lambda: supabase)

    with pytest.raises(HTTPException) as exc:
        auth.get_current_user(_credentials())
    assert exc.value.status_code == 503


def test_require_admin_rejects_student() -> None:
    with pytest.raises(HTTPException) as exc:
        auth.require_admin({"role": "student"})
    assert exc.value.status_code == 403


def test_require_superadmin_rejects_admin() -> None:
    with pytest.raises(HTTPException) as exc:
        auth.require_superadmin({"role": "admin"})
    assert exc.value.status_code == 403


def test_require_superadmin_accepts_superadmin() -> None:
    user = {"id": "root-1", "role": "superadmin"}
    assert auth.require_superadmin(user) is user
