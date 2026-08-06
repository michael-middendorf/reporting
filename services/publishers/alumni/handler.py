"""Alumni publisher: Virtuous pipeline → ReportData/alumni/."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from common.s3util import data_bucket, upload_tree
from virt_reporting.config import AppConfig
from virt_reporting.pipeline import AlumniEngagementPipeline
from virt_reporting.virtuous import VirtuousClient


def handler(event, context):  # noqa: ANN001, ARG001
    api_key = os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        raise RuntimeError("VIRTUOUS_API_KEY required")
    mode = str((event or {}).get("mode") or "incremental").strip().lower()
    if mode not in {"bootstrap", "incremental"}:
        mode = "incremental"
    bucket = data_bucket()

    with tempfile.TemporaryDirectory(prefix="alumni-publish-") as tmp:
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
        metadata = AlumniEngagementPipeline(config, client).run(mode)
        keys = upload_tree(publish_dir, "alumni", bucket=bucket)

    return {
        "ok": True,
        "bucket": bucket,
        "mode": mode,
        "uploaded": len(keys),
        "generated_at": metadata.get("generated_at"),
        "counts": metadata.get("counts"),
    }
