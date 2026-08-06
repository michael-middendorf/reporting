"""Shared S3 helpers for ReportData publishers."""

from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
from typing import Any

import boto3

REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"


def data_bucket() -> str:
    bucket = (os.environ.get("DATA_BUCKET") or "").strip()
    if not bucket:
        raise RuntimeError("DATA_BUCKET is required")
    return bucket


def s3():
    return boto3.client("s3", region_name=REGION)


def put_json(key: str, payload: Any, *, bucket: str | None = None) -> str:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    dest = bucket or data_bucket()
    s3().put_object(
        Bucket=dest,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="no-cache",
    )
    return f"s3://{dest}/{key}"


def put_bytes(
    key: str,
    body: bytes,
    *,
    content_type: str,
    bucket: str | None = None,
    content_encoding: str | None = None,
) -> str:
    dest = bucket or data_bucket()
    args: dict[str, Any] = {
        "Bucket": dest,
        "Key": key,
        "Body": body,
        "ContentType": content_type,
        "CacheControl": "no-cache",
    }
    if content_encoding:
        args["ContentEncoding"] = content_encoding
    s3().put_object(**args)
    return f"s3://{dest}/{key}"


def upload_tree(local_dir: Path, prefix: str, *, bucket: str | None = None) -> list[str]:
    dest = bucket or data_bucket()
    prefix = prefix.strip("/")
    uploaded: list[str] = []
    client = s3()
    for path in sorted(p for p in local_dir.rglob("*") if p.is_file()):
        rel = path.relative_to(local_dir).as_posix()
        key = f"{prefix}/{rel}" if prefix else rel
        ctype, _ = mimetypes.guess_type(str(path))
        if path.suffix == ".json":
            ctype = "application/json"
        elif path.suffix == ".csv":
            ctype = "text/csv"
        extra = {"ContentType": ctype or "application/octet-stream", "CacheControl": "no-cache"}
        client.upload_file(str(path), dest, key, ExtraArgs=extra)
        uploaded.append(key)
    return uploaded
