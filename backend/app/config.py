from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./coldtrace.db"
    node_key: str = "dev-node-key"
    # Gemini names places along the route (Google Maps grounding).
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    # Grok writes the plain-language report for the health worker.
    xai_api_key: str = ""
    grok_model: str = "grok-4.6"
    # Seconds to wait on either model before falling back to templates.
    ai_timeout_s: float = 12.0
    cors_origins: str = "http://localhost:5173"
    # Directory holding the built web app. When set, FastAPI serves it.
    static_dir: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
