"""Housing publisher: Qlik occupancy → ReportData/housing/latest.json."""

from __future__ import annotations

import datetime
import os

from common.s3util import data_bucket, put_json
from housing_data import get_housing_data


def handler(event, context):  # noqa: ANN001, ARG001
    bucket = data_bucket()
    raw = get_housing_data(force_refresh=True)
    payload = {
        "records": raw.get("records") or [],
        "session": raw.get("session"),
        "total": raw.get("total"),
        "cached_at": raw.get("cached_at")
        or datetime.datetime.utcnow().isoformat() + "Z",
        "source": "qlik-publisher",
    }
    put_json("housing/latest.json", payload, bucket=bucket)
    return {
        "ok": True,
        "bucket": bucket,
        "total": payload.get("total"),
        "cached_at": payload["cached_at"],
        "qlik_configured": bool(os.getenv("QLIK_API_KEY") and os.getenv("QLIK_TENANT")),
    }
