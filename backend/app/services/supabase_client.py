from functools import lru_cache

from supabase import Client, create_client

from ..config import get_settings


@lru_cache
def get_supabase() -> Client:
    """Service-role client — bypasses RLS. Backend use only, never expose."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)
