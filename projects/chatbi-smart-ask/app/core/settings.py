from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_list(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_name: str = "智能问数"
    app_version: str = "0.1.0"
    debug: bool = True

    session_secret: str = os.getenv("SMARTASK_SESSION_SECRET", "dev-secret-change-me")
    session_https_only: bool = _env_bool("SMARTASK_SESSION_HTTPS_ONLY", False)
    session_same_site: str = os.getenv("SMARTASK_SESSION_SAMESITE", "lax")

    cors_allow_origins: list[str] = None  # type: ignore[assignment]

    llm_provider: str = os.getenv("SMARTASK_LLM_PROVIDER", "mock")
    openai_base_url: str = os.getenv("SMARTASK_OPENAI_BASE_URL", "")
    openai_api_key: str = os.getenv("SMARTASK_OPENAI_API_KEY", "")
    openai_model: str = os.getenv("SMARTASK_OPENAI_MODEL", "gpt-4o-mini")
    # SQL 生成可单独指定代码模型（如 qwen3-coder-plus）；留空则复用 openai_model。
    openai_sql_model: str = os.getenv("SMARTASK_OPENAI_SQL_MODEL", "")
    openai_wire_api: str = os.getenv("SMARTASK_OPENAI_WIRE_API", "chat_completions")
    agent_endpoint: str = os.getenv("SMARTASK_AGENT_ENDPOINT", "")
    agent_api_key: str = os.getenv("SMARTASK_AGENT_API_KEY", "")
    agent_auth_scheme: str = os.getenv("SMARTASK_AGENT_AUTH_SCHEME", "Bearer")
    agent_timeout_s: int = _env_int("SMARTASK_AGENT_TIMEOUT_S", 40)

    sql_max_rows: int = _env_int("SMARTASK_SQL_MAX_ROWS", 800)
    sql_timeout_ms: int = _env_int("SMARTASK_SQL_TIMEOUT_MS", 6000)
    stream_char_delay_ms: int = _env_int("SMARTASK_STREAM_CHAR_DELAY_MS", 8)
    stream_stage_delay_ms: int = _env_int("SMARTASK_STREAM_STAGE_DELAY_MS", 250)
    federated_max_rows_per_table: int = _env_int("SMARTASK_FEDERATED_MAX_ROWS", 20000)
    federated_batch_size: int = _env_int("SMARTASK_FEDERATED_BATCH_SIZE", 2000)

    demo_db_path: str = os.getenv(
        "SMARTASK_DEMO_DB_PATH",
        str(Path(__file__).resolve().parents[2] / "storage" / "demo.db"),
    )

    def __post_init__(self) -> None:
        object.__setattr__(self, "cors_allow_origins", _env_list("SMARTASK_CORS_ORIGINS", ["*"]))
        object.__setattr__(self, "sql_max_rows", max(1, self.sql_max_rows))
        object.__setattr__(self, "sql_timeout_ms", max(0, self.sql_timeout_ms))
        object.__setattr__(self, "stream_char_delay_ms", max(0, self.stream_char_delay_ms))
        object.__setattr__(self, "stream_stage_delay_ms", max(0, self.stream_stage_delay_ms))
        object.__setattr__(self, "federated_max_rows_per_table", max(1, self.federated_max_rows_per_table))
        object.__setattr__(self, "federated_batch_size", max(1, self.federated_batch_size))
        object.__setattr__(self, "agent_timeout_s", max(1, self.agent_timeout_s))


_SETTINGS: Settings | None = None


def get_settings() -> Settings:
    global _SETTINGS
    if _SETTINGS is None:
        _SETTINGS = Settings(debug=_env_bool("SMARTASK_DEBUG", True))
    return _SETTINGS


def llm_runtime_status(settings: Settings) -> dict[str, Any]:
    provider = (settings.llm_provider or "mock").strip().lower() or "mock"
    wire_api = (settings.openai_wire_api or "chat_completions").strip().lower() or "chat_completions"
    if provider == "agent":
        provider = "agent_http"

    openai_configured = bool(
        (settings.openai_base_url or "").strip()
        and (settings.openai_api_key or "").strip()
        and (settings.openai_model or "").strip()
    )
    agent_configured = bool((settings.agent_endpoint or "").strip())

    if provider == "openai_compatible":
        configured = openai_configured
        ready = configured
    elif provider == "agent_http":
        configured = agent_configured
        ready = configured
    else:
        configured = False
        ready = False

    mode = "real_llm" if ready else "mock_rule"
    return {
        "provider": provider,
        "wire_api": wire_api,
        "configured": configured,
        "ready": ready,
        "mode": mode,
        "openai_configured": openai_configured,
        "agent_configured": agent_configured,
    }
