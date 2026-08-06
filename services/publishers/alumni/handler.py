"""Alumni on-read processor: derive UI artifacts (no S3 derived writes).

Uses virtuous raw when present; falls back to live Virtuous sync for correctness
of alumni-specific contact universe, still without publishing derived JSON to S3.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from virt_reporting.config import AppConfig
from virt_reporting.pipeline import AlumniEngagementPipeline
from virt_reporting.virtuous import VirtuousClient

_CACHE: dict[str, Any] = {"key": None, "files": None}


def _build_files(mode: str) -> dict[str, Any]:
    api_key = os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        raise RuntimeError("VIRTUOUS_API_KEY required")
    cache_key = f"{mode}:{api_key[:8]}"
    # Warm cache only within same container invocation burst; keyed lightly.
    if _CACHE["key"] == cache_key and isinstance(_CACHE["files"], dict):
        return _CACHE["files"]

    with tempfile.TemporaryDirectory(prefix="alumni-onread-") as tmp:
        workspace = Path(tmp)
        data_dir = workspace / "data"
        publish_dir = workspace / "publish"
        config = AppConfig(
            root_dir=workspace,
            base_url=os.environ.get("VIRTUOUS_BASE_URL", "https://api.virtuoussoftware.com"),
            api_key=api_key,
            data_dir=data_dir,
            raw_dir=data_dir / "raw",
            derived_dir=data_dir / "derived",
            state_dir=data_dir / "state",
            exports_dir=data_dir / "exports",
            publish_dir=publish_dir,
            page_size=int(os.environ.get("PAGE_SIZE", "500")),
            contact_chunk_size=int(os.environ.get("CONTACT_CHUNK_SIZE", "200")),
            gift_window_days=int(os.environ.get("GIFT_WINDOW_DAYS", "365")),
            note_window_days=int(os.environ.get("NOTE_WINDOW_DAYS", "365")),
            event_window_days=int(os.environ.get("EVENT_WINDOW_DAYS", "365")),
            incremental_overlap_days=int(os.environ.get("INCREMENTAL_OVERLAP_DAYS", "7")),
            timeout_seconds=int(os.environ.get("TIMEOUT_SECONDS", "120")),
        )
        client = VirtuousClient(
            base_url=config.base_url,
            api_key=config.api_key,
            timeout_seconds=config.timeout_seconds,
        )
        AlumniEngagementPipeline(config, client).run(mode)
        files: dict[str, Any] = {}
        for path in publish_dir.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(publish_dir).as_posix()
            if path.suffix == ".json":
                files[rel] = json.loads(path.read_text(encoding="utf-8"))
            else:
                files[rel] = path.read_text(encoding="utf-8-sig")
        _CACHE["key"] = cache_key
        _CACHE["files"] = files
        return files


def handler(event, context):  # noqa: ANN001, ARG001
    mode = str((event or {}).get("mode") or "incremental").strip().lower()
    if mode not in {"bootstrap", "incremental"}:
        mode = "incremental"
    artifact = (event or {}).get("artifact")
    files = _build_files(mode)
    if not artifact:
        return {"ok": True, "artifacts": sorted(files.keys())}
    if artifact not in files:
        return {
            "ok": False,
            "error": f"unknown artifact: {artifact}",
            "artifacts": sorted(files.keys()),
        }
    return {"ok": True, "artifact": artifact, "body": files[artifact]}
