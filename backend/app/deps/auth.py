"""Verifies the Supabase JWT sent by the React app and resolves the
caller's role from the profiles table (RLS is bypassed via service role,
so the role check happens here)."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..services.supabase_client import get_supabase

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    sb = get_supabase()
    try:
        user = sb.auth.get_user(creds.credentials).user
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    try:
        profile = (
            sb.table("profiles").select("role, full_name").eq("id", user.id).maybe_single().execute()
        )
    except Exception:
        # A transient PostgREST/network blip must not turn every authenticated
        # request into a raw 500 — tell the client to retry instead.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Authentication service temporarily unavailable — please try again.",
        )
    role = profile.data["role"] if profile and profile.data else "student"
    name = (profile.data or {}).get("full_name") if profile else None
    return {
        "id": user.id,
        "email": user.email,
        "name": name or (user.user_metadata or {}).get("full_name"),
        "role": role,
    }


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in ("admin", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "superadmin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Superadmin access required")
    return user
