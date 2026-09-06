from __future__ import annotations

import multiprocessing
import os

import uvicorn

from app.main import create_app


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


def main() -> None:
    multiprocessing.freeze_support()

    host = os.getenv("SMARTASK_HOST", os.getenv("APP_HOST", "0.0.0.0"))
    port = _env_int("SMARTASK_PORT", _env_int("APP_PORT", 8000))
    log_level = os.getenv("SMARTASK_LOG_LEVEL", "info")

    uvicorn.run(
        create_app(),
        host=host,
        port=port,
        log_level=log_level,
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("SMARTASK_FORWARDED_ALLOW_IPS", "*"),
    )


if __name__ == "__main__":
    main()
