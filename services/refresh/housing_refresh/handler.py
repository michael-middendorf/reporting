"""Refresh housing occupancy from Qlik Engine into DATA_BUCKET/housing/latest.json."""

from __future__ import annotations

import datetime
import json
import os

import boto3

from reporting_api.housing_data import get_housing_data

REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
CACHE_KEY = "housing/latest.json"


def handler(event, context):  # noqa: ANN001, ARG001
    bucket = os.environ["DATA_BUCKET"]
    raw = get_housing_data(force_refresh=True)
    payload = {
        "records": raw.get("records") or [],
        "session": raw.get("session"),
        "total": raw.get("total"),
        "cached_at": raw.get("cached_at")
        or datetime.datetime.utcnow().isoformat() + "Z",
        "source": "qlik-cron",
    }
    boto3.client("s3", region_name=REGION).put_object(
        Bucket=bucket,
        Key=CACHE_KEY,
        Body=json.dumps(payload).encode("utf-8"),
        ContentType="application/json",
    )
    return {
        "ok": True,
        "total": payload["total"],
        "bucket": bucket,
        "key": CACHE_KEY,
    }
