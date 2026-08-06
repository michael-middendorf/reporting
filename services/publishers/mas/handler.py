"""MAS on-read processor: derive UI artifacts from sources/virtuous raw (no S3 derived writes)."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from common.raw_load import load_jsonl_dataset
from mas_follow_up_report.config import AppConfig
from mas_follow_up_report.pipeline import MAFollowUpPipeline
from mas_follow_up_report.virtuous import VirtuousClient

# In-memory warm cache keyed by raw pulled_at stamps.
_CACHE: dict[str, Any] = {"key": None, "files": None}


def _cache_key(metas: list[dict]) -> str:
    return "|".join(f"{m.get('source')}/{m.get('dataset')}@{m.get('pulled_at')}" for m in metas)


def _build_files() -> dict[str, Any]:
    notes, notes_meta = load_jsonl_dataset("virtuous", "contact_notes")
    gifts, gifts_meta = load_jsonl_dataset("virtuous", "gifts")
    contacts, contacts_meta = load_jsonl_dataset("virtuous", "contacts")
    key = _cache_key([notes_meta, gifts_meta, contacts_meta])
    if _CACHE["key"] == key and isinstance(_CACHE["files"], dict):
        return _CACHE["files"]

    api_key = os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "unused"
    with tempfile.TemporaryDirectory(prefix="mas-onread-") as tmp:
        workspace = Path(tmp)
        data_dir = workspace / "data"
        publish_dir = workspace / "publish" / "data"
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
            contact_chunk_size=int(os.environ.get("CONTACT_CHUNK_SIZE", "150")),
            gift_window_days=int(os.environ.get("GIFT_WINDOW_DAYS", "365")),
            note_window_days=int(os.environ.get("NOTE_WINDOW_DAYS", "365")),
            activity_default_days=int(os.environ.get("ACTIVITY_DEFAULT_DAYS", "90")),
            recent_gift_window_days=int(os.environ.get("RECENT_GIFT_WINDOW_DAYS", "30")),
            timeout_seconds=int(os.environ.get("TIMEOUT_SECONDS", "120")),
        )
        client = VirtuousClient(
            base_url=config.base_url,
            api_key=config.api_key,
            timeout_seconds=config.timeout_seconds,
        )
        pipeline = MAFollowUpPipeline(config, client)

        contacts_by_id = {}
        for c in contacts:
            cid = c.get("id") or c.get("contactId")
            if cid is not None:
                contacts_by_id[int(cid)] = c

        pipeline._fetch_notes = lambda _start: notes  # type: ignore[method-assign]
        pipeline._fetch_gifts = lambda _start: gifts  # type: ignore[method-assign]
        pipeline._fetch_contacts = lambda ids: [  # type: ignore[method-assign]
            contacts_by_id[i] for i in ids if int(i) in contacts_by_id
        ]
        # Smoke checks hit Virtuous; skip if no real key usable.
        pipeline._smoke_check_query_options = lambda: []  # type: ignore[method-assign]

        pipeline.run("sync")
        files: dict[str, Any] = {}
        for path in publish_dir.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(publish_dir).as_posix()
            if path.suffix == ".json":
                files[rel] = json.loads(path.read_text(encoding="utf-8"))
            else:
                files[rel] = path.read_text(encoding="utf-8-sig")
        _CACHE["key"] = key
        _CACHE["files"] = files
        return files


def handler(event, context):  # noqa: ANN001, ARG001
    """Return one artifact or the full file map.

    event.artifact: e.g. "scorecards.json" or "exports/engagement_ledger.csv"
    If omitted, returns {"artifacts": [names...]} listing only (not bodies).
    """
    artifact = (event or {}).get("artifact")
    files = _build_files()
    if not artifact:
        return {"ok": True, "artifacts": sorted(files.keys())}
    if artifact not in files:
        return {"ok": False, "error": f"unknown artifact: {artifact}", "artifacts": sorted(files.keys())}
    return {"ok": True, "artifact": artifact, "body": files[artifact]}
