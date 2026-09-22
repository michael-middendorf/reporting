"""DST-627 aggregate-only Pursuit of Wisdom reporting refresh.

The POW service HMACs account emails before responding. This publisher never
writes account-level data to S3, only per-course and website aggregates.
"""
from __future__ import annotations

import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from common.s3util import put_json

OUTPUT_KEY = "marketing/pursuit-of-wisdom/latest.json"


def fetch_export(url: str, token: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def summarize(source: dict[str, Any]) -> dict[str, Any]:
    courses: dict[str, dict[str, Any]] = {}
    for person in source.get("people") or []:
        for item in person.get("courses") or []:
            row = courses.setdefault(item["slug"], {"title": item["title"], "starts": 0, "completions": 0, "watchSeconds": 0, "videosWatched": 0})
            row["starts"] += 1
            row["completions"] += int(bool(item.get("completed")))
            row["watchSeconds"] += float(item.get("engagedSeconds") or 0)
            row["videosWatched"] += int(item.get("videosWatched") or 0)
    course_rows = []
    for row in courses.values():
        starts = row.pop("starts")
        completions = row.pop("completions")
        seconds = row.pop("watchSeconds")
        course_rows.append({**row, "starts": starts, "completions": completions, "completionRate": completions / starts if starts else 0, "watchHours": round(seconds / 3600, 2)})
    course_rows.sort(key=lambda row: (-row["starts"], row["title"]))
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "website": source.get("website") or {},
        "courses": course_rows,
        "youtube": {"available": False},
        "notes": [
            "Course consumption is based on consented first-party events and logged-in course progress.",
            "Audience matching and donor conversion require the next institutional-source enrichment phase; no individual data is included in this snapshot.",
            "YouTube public basics require a restricted YouTube Data API key. Owner-only Analytics API metrics are unavailable by design.",
        ],
    }


def handler(_event: dict[str, Any], _context: Any) -> dict[str, Any]:
    url = os.environ["POW_REPORTING_EXPORT_URL"]
    token = os.environ["POW_REPORTING_EXPORT_TOKEN"]
    payload = summarize(fetch_export(url, token))
    put_json(OUTPUT_KEY, payload)
    return {"ok": True, "key": OUTPUT_KEY, "courses": len(payload["courses"])}
