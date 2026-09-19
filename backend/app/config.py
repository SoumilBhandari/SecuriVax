from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEV_NODE_KEY = "dev-node-key"  # public: fine on a laptop, never on a deploy


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./vialtality.db"
    node_key: str = DEV_NODE_KEY
    # When set, custody changes, VVM checks and dispatch decisions need an
    # operator: an account created with this code, or a script sending it in
    # X-Operator-Token. Empty: open, for dev.
    operator_token: str = ""
    # Signs the sign-in cookie. Empty: derived from OPERATOR_TOKEN and NODE_KEY
    # (so a deploy needs nothing new), or random per process in dev.
    session_secret: str = ""
    # Dev only: save each VVM photo and what the reader made of it here, and a
    # stage-labelled copy once confirmed (input for evals.calibrate_vvm --photos).
    vvm_save_dir: str = ""
    # The deployed commit: VERSION if set, else the one Render provides on every deploy.
    version: str = Field("dev", validation_alias=AliasChoices("VERSION", "RENDER_GIT_COMMIT"))
    max_body_bytes: int = 8 * 1024 * 1024
    # Gemini names places along the route (Google Maps grounding).
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    # Grok writes the plain-language report for the health worker.
    xai_api_key: str = ""
    grok_model: str = "grok-4.6"
    # Seconds to wait on either model before falling back to templates.
    ai_timeout_s: float = 12.0
    # Grok's written report takes 15-30 s; it's only asked for when someone
    # opens it (and then cached), so it gets longer before the template stands in.
    report_timeout_s: float = 45.0
    cors_origins: str = "http://localhost:5173"
    # Weather from Open-Meteo (free, no key). Offline, a climate model stands in.
    weather_offline: bool = False
    # Fill a fresh database with a few days of demo trips.
    demo_history: bool = True
    # "lanes": eight shipments across Africa and an outreach day; "kisumu": one district (tests, backtest).
    demo_dataset: str = "lanes"
    # Keep the simulated lane carriers reporting while the server runs, so the
    # demo doesn't go stale an hour after it was seeded.
    demo_live: bool = True
    # Wipe and re-seed on every start, so a deployed demo is always current.
    demo_reset: bool = False
    # Directory holding the built web app. When set, FastAPI serves it.
    static_dir: str = ""
    # The interactive API docs (/docs, /openapi.json): on a laptop, off on a deploy
    # (one serving the built app) unless API_DOCS says otherwise.
    api_docs: bool | None = None

    @property
    def show_api_docs(self) -> bool:
        return self.api_docs if self.api_docs is not None else not self.static_dir

    @field_validator("gemini_api_key", "xai_api_key", "node_key", "operator_token", "session_secret", mode="before")
    @classmethod
    def _tidy_pasted_secret(cls, value: object, info) -> object:
        """Secrets get pasted into dashboards with extras: spaces, a line break,
        quotes, or the whole .env line ("XAI_API_KEY=xai-..."). Any of those
        makes the provider reject the key, so keep only the key itself."""
        if not isinstance(value, str):
            return value
        value = value.strip().strip("'\"").strip()
        name = f"{info.field_name.upper()}="
        if value.upper().startswith(name):
            value = value[len(name):].strip().strip("'\"").strip()
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
