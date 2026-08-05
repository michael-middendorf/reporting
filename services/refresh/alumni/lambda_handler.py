#!/usr/bin/env python3
"""Thin Lambda entry for alumni Virtuous sync (publishes to DATA_BUCKET/alumni/)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Allow packaging virt_reporting beside this module
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def lambda_handler(event, context=None):
    os.environ.setdefault("PUBLISH_DIR", "/tmp/alumni_publish")
    from virt_reporting.cli import main as cli_main  # type: ignore

    mode = (event or {}).get("mode") or "incremental"
    # Run sync then upload if bucket configured
    argv = ["sync", mode]
    try:
        cli_main(argv)
    except SystemExit as exc:
        if exc.code not in (0, None):
            return {"ok": False, "error": f"cli exit {exc.code}"}

    bucket = os.getenv("DATA_BUCKET") or os.getenv("ALUMNI_DATA_BUCKET")
    prefix = (os.getenv("ALUMNI_DATA_PREFIX") or "alumni").rstrip("/")
    publish = Path(os.environ["PUBLISH_DIR"])
    site_data = HERE / "site_data"
    # Prefer package default publish under site/data if present after sync
    candidates = [publish, HERE / "data" / "derived", Path("/tmp/alumni_publish")]
    uploaded = []
    if bucket:
        import boto3

        s3 = boto3.client("s3")
        for root in candidates:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                key = f"{prefix}/{path.relative_to(root).as_posix()}"
                s3.upload_file(str(path), bucket, key)
                uploaded.append(key)
            break
    return {"ok": True, "mode": mode, "uploaded": uploaded[:50], "uploaded_count": len(uploaded)}
