"""Lazy Supabase client. Use for application-level reads/writes (RLS-aware).

For migrations / direct SQL, use Alembic + the DATABASE_URL connection string.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from ..core.config import get_settings


@lru_cache
def supabase() -> Client:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use the supabase client."
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
