"""Thin S3 writer for the raw cache. Only used when publishing.

Uses boto3 with the configured named profile (AWS SSO friendly). Import of
boto3 is deferred so local-only runs don't require it.
"""
from __future__ import annotations

import json
from typing import Any


def _client(profile: str | None, region: str):
    import boto3  # deferred

    session = boto3.Session(profile_name=profile) if profile else boto3.Session()
    return session.client("s3", region_name=region)


def put_json(
    *,
    bucket: str,
    key: str,
    payload: Any,
    profile: str | None = None,
    region: str = "us-east-2",
) -> str:
    client = _client(profile, region)
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="no-cache",
    )
    return f"s3://{bucket}/{key}"
