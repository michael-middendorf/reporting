"""Build dashboard API payload with S3 presigned report URLs (inline: false)."""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, Optional

BUCKET = os.getenv("CACHE_BUCKET", "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2")
REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
MANIFEST_KEY = os.getenv("CACHE_KEY", "dashboard/slate-report-cache.json")
PRESIGN_SECONDS = int(os.getenv("PRESIGN_EXPIRATION_SECONDS", "3600"))

# Hub logical name → S3 report object basename
REPORT_FILES = {
    "admissions": "admissions",
    "decisions": "app_decisions",
    "psw": "psw",
    "slc": "slc",
    "withdrawn": "withdrawn",
    "campus": "campus_visits",
}


def build_dashboard_payload(s3_client: Any) -> Dict[str, Any]:
    bucket = os.getenv("CACHE_BUCKET", BUCKET)
    manifest_key = os.getenv("CACHE_KEY", MANIFEST_KEY)
    presign_seconds = int(os.getenv("PRESIGN_EXPIRATION_SECONDS", str(PRESIGN_SECONDS)))

    manifest_obj = s3_client.get_object(Bucket=bucket, Key=manifest_key)
    manifest = json.loads(manifest_obj["Body"].read().decode("utf-8"))

    report_presigned: Dict[str, Dict[str, str]] = {}
    reports_meta = manifest.get("reports") or {}

    for _hub_key, s3_name in REPORT_FILES.items():
        entry = reports_meta.get(s3_name) or {}
        json_key = entry.get("json_key") or f"dashboard/reports/{s3_name}.json"
        gzip_key = entry.get("gzip_key") or f"{json_key}.gz"
        report_presigned[s3_name] = {
            "json": s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": json_key},
                ExpiresIn=presign_seconds,
            ),
            "json_gzip": s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": gzip_key},
                ExpiresIn=presign_seconds,
            ),
        }

    for hub_key, s3_name in REPORT_FILES.items():
        if hub_key != s3_name and s3_name in report_presigned:
            report_presigned[hub_key] = report_presigned[s3_name]

    return {
        "success": True,
        "mode": "dashboard",
        "source": "s3-cache",
        "inline": False,
        "bucket": bucket,
        "key": manifest_key,
        "gzip_key": f"{manifest_key}.gz",
        "generated_at": manifest.get("generated_at"),
        "presigned_urls": {
            "json": s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": manifest_key},
                ExpiresIn=presign_seconds,
            ),
            "json_gzip": s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": f"{manifest_key}.gz"},
                ExpiresIn=presign_seconds,
            ),
        },
        "report_presigned_urls": report_presigned,
        "manifest": {
            "success": manifest.get("success"),
            "generated_at": manifest.get("generated_at"),
            "refresh_duration_ms": manifest.get("refresh_duration_ms"),
            "report_order": manifest.get("report_order"),
            "reports": {
                name: {
                    "success": meta.get("success"),
                    "row_count": meta.get("row_count"),
                    "bytes": meta.get("bytes"),
                    "gzip_bytes": meta.get("gzip_bytes"),
                    "json_key": meta.get("json_key"),
                    "gzip_key": meta.get("gzip_key"),
                    "error": meta.get("error"),
                }
                for name, meta in (manifest.get("reports") or {}).items()
            },
        },
    }


def default_s3_client_factory() -> Callable[[], Any]:
    """Lazy boto3 S3 client using env region / default credentials."""

    def _factory() -> Any:
        import boto3

        region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or REGION
        return boto3.client("s3", region_name=region)

    return _factory
