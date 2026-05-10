from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SoSoValue
    sosovalue_api_key: str | None = None
    sosovalue_api_base: str = "https://openapi.sosovalue.com"

    # SoDEX
    sodex_api_key: str | None = None
    sodex_api_base: str = "https://api.sodex.com"

    # Supabase + DB
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    database_url: str | None = None

    # AI providers
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None

    # CORS — comma-separated list of origins allowed to call the API
    cors_origins: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
