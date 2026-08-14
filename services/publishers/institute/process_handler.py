"""Institute on-read processor: build dashboard payload from sources/institute/* raw."""

from __future__ import annotations

import json
from typing import Any

import build
from common.raw_load import load_jsonl_dataset

# Query names expected by build.payload (raw JSON text or None).
QUERY_NAMES = ("q1", "q2", "q3", "q4", "q5", "q6", "q7")


def handler(event, context):  # noqa: ANN001, ARG001
    raws: dict[str, str | None] = {}
    errors: dict[str, str] = {}
    for name in QUERY_NAMES:
        try:
            rows, _meta = load_jsonl_dataset("institute", name)
            # build.payload expects original Slate JSON text with row array.
            raws[name] = json.dumps({"row": rows})
        except Exception as exc:  # noqa: BLE001
            raws[name] = None
            errors[name] = str(exc)

    if raws.get("q4") is None:
        return {
            "ok": False,
            "error": f"q4 missing from sources/institute: {errors.get('q4', 'not found')}",
            "errors": errors,
        }

    data = build.payload(raws)
    artifact = (event or {}).get("artifact") or "latest.json"
    if artifact in {"latest.json", "payload.json", ""}:
        return {"ok": True, "artifact": "latest.json", "body": data}
    return {
        "ok": False,
        "error": f"unknown artifact: {artifact}",
        "artifacts": ["latest.json"],
    }
