"""Housing publisher → sources/qlik/housing_occupancy/."""

from __future__ import annotations

import os

from common.sources import publish_dataset
from housing_data import get_housing_data


def handler(event, context):  # noqa: ANN001, ARG001
    raw = get_housing_data(force_refresh=True)
    records = raw.get("records") or []
    if not isinstance(records, list):
        records = []
    latest = publish_dataset(
        source="qlik",
        dataset="housing_occupancy",
        rows=records,
        provenance={
            "system": "qlik",
            "session": raw.get("session"),
            "total": raw.get("total"),
            "cached_at": raw.get("cached_at"),
            "qlik_configured": bool(os.getenv("QLIK_API_KEY") and os.getenv("QLIK_TENANT")),
        },
    )
    return {
        "ok": True,
        "source": "qlik",
        "dataset": latest,
        "session": raw.get("session"),
        "total": raw.get("total"),
    }
