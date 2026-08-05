from __future__ import annotations

from dataclasses import replace
from typing import Any

from .runtime import RuntimeConfig, load_runtime_config
from .service import ReportRefreshService


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    payload = event or {}
    mode = str(payload.get("mode") or "refresh").strip().lower()
    runtime = load_runtime_config()
    service = ReportRefreshService(replace(runtime, mode="sync"))
    if mode == "health":
        return service.health()
    if mode != "refresh":
        raise ValueError(f"Unsupported mode: {mode}")
    return service.refresh().as_dict()
