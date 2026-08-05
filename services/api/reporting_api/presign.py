"""Presign helpers for report data objects in the shared data bucket."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
DATA_BUCKET = os.getenv(
    "DATA_BUCKET",
    os.getenv("CACHE_BUCKET", "amu-reporting-data-us-east-2"),
)
PRESIGN_SECONDS = int(os.getenv("PRESIGN_EXPIRATION_SECONDS", "3600"))

# Logical report → S3 prefix under the data bucket
REPORT_PREFIXES = {
    "enrollment": os.getenv("ENROLLMENT_DATA_PREFIX", "enrollment"),
    "mas": os.getenv("MAS_DATA_PREFIX", "mas"),
    "points": os.getenv("POINTS_DATA_PREFIX", "points"),
    "alumni": os.getenv("ALUMNI_DATA_PREFIX", "alumni"),
}


def _presign(s3: Any, bucket: str, key: str, seconds: int) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=seconds,
    )


def list_and_presign_prefix(
    s3: Any,
    report: str,
    *,
    bucket: Optional[str] = None,
    max_keys: int = 200,
) -> Dict[str, Any]:
    """Return presigned URLs for objects under data/{report}/ (or configured prefix)."""
    if report not in REPORT_PREFIXES:
        raise ValueError(f"Unknown report: {report}")
    bucket = bucket or os.getenv("DATA_BUCKET", DATA_BUCKET)
    prefix = REPORT_PREFIXES[report].rstrip("/") + "/"
    seconds = int(os.getenv("PRESIGN_EXPIRATION_SECONDS", str(PRESIGN_SECONDS)))

    paginator = s3.get_paginator("list_objects_v2")
    files: List[Dict[str, str]] = {}
    file_list: List[Dict[str, Any]] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix, PaginationConfig={"MaxItems": max_keys}):
        for obj in page.get("Contents") or []:
            key = obj["Key"]
            if key.endswith("/"):
                continue
            rel = key[len(prefix) :]
            entry = {
                "key": key,
                "path": rel,
                "url": _presign(s3, bucket, key, seconds),
                "size": obj.get("Size"),
                "last_modified": obj["LastModified"].isoformat() if obj.get("LastModified") else None,
            }
            file_list.append(entry)
            files[rel] = entry["url"]

    return {
        "success": True,
        "report": report,
        "bucket": bucket,
        "prefix": prefix,
        "files": files,
        "objects": file_list,
    }


def enrollment_dashboard_payload(s3: Any) -> Dict[str, Any]:
    """Prefer legacy enrollment-pipeline cache bucket; fall back to unified data bucket."""
    from reporting_api.dashboard import REPORT_FILES, build_dashboard_payload

    # Temporarily point CACHE_BUCKET at legacy or unified enrollment cache
    legacy = os.getenv(
        "ENROLLMENT_CACHE_BUCKET",
        "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
    )
    os.environ.setdefault("CACHE_BUCKET", legacy)
    os.environ.setdefault("CACHE_KEY", "dashboard/slate-report-cache.json")
    return build_dashboard_payload(s3)
