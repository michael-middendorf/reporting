"""Housing publisher → eRez occupancy + residents cache."""

from __future__ import annotations

import os

from common.s3util import put_json
from common.sources import publish_dataset
from housing_data import (
    HOUSING_CACHE_PREFIX,
    RESIDENTS_KEY,
    build_residents_payload,
    get_housing_data,
    study_abroad_from_records,
)


def handler(event, context):  # noqa: ANN001, ARG001
    occupancy = get_housing_data(force_refresh=True)
    records = occupancy.get("records") or []
    if not isinstance(records, list):
        records = []

    occupancy_latest = publish_dataset(
        source="erez",
        dataset="housing_occupancy",
        rows=records,
        provenance={
            "system": "erezlife",
            "session": occupancy.get("session"),
            "total": occupancy.get("total"),
            "cached_at": occupancy.get("cached_at"),
            "erez_configured": bool(os.getenv("EREZLIFE_API_KEY") or os.getenv("API_KEY")),
        },
    )

    residents = build_residents_payload(occupancy)
    put_json(RESIDENTS_KEY, residents)
    put_json(
        f"{HOUSING_CACHE_PREFIX}/study_abroad.json",
        study_abroad_from_records(records),
    )

    # Keep the previous key populated so anything still reading qlik/housing_occupancy
    # does not go empty during cutover. Provenance records the real source.
    qlik_latest = publish_dataset(
        source="qlik",
        dataset="housing_occupancy",
        rows=records,
        provenance={
            "system": "erezlife",
            "mirrored_from": "sources/erez/housing_occupancy",
            "session": occupancy.get("session"),
            "total": occupancy.get("total"),
            "cached_at": occupancy.get("cached_at"),
        },
    )

    return {
        "ok": True,
        "source": "erez",
        "occupancy": occupancy_latest,
        "qlik_mirror": qlik_latest,
        "residents_key": RESIDENTS_KEY,
        "session": occupancy.get("session"),
        "total": occupancy.get("total"),
        "resident_count": residents.get("count"),
        "generated": residents.get("generated"),
    }
