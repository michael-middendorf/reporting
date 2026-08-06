"""Points publisher: raw Virtuous notes/events → ReportData/points/data/."""

from __future__ import annotations

import datetime as dt
import json
import os
import urllib.error
import urllib.request
from typing import Any

from common.s3util import data_bucket, put_json

MA_ROSTER = [
    "Sean Kelly",
    "Joseph Blaso",
    "Alanna McCann",
    "Caleb Metzen",
    "Elena Barnes",
    "Betsy Scaletty",
    "Natalia Abrams",
]
NOTE_TYPE_PREFIXES = ["Mission Advancement"]
NOTE_TYPE_EXACT = ["Letter", "In Person", "Text Message"]
EVENT_MATCH_KEYWORDS = ["Near You", "Market"]
EVENT_FIELDS = ("id", "name", "startDateTime", "endDateTime", "locationName", "createdByUser")


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = 1000) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        while True:
            payload = {**body, "skip": skip, "take": page_size}
            data = self._post(path, payload)
            batch = data.get("list") or data.get("records") or []
            if not isinstance(batch, list):
                batch = []
            rows.extend(batch)
            total = int(data.get("total") or 0)
            skip += len(batch)
            if not batch or (total and skip >= total) or len(batch) < page_size:
                break
        return rows

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Virtuous {path} → {exc.code}: {detail}") from exc


def _note_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    date_conditions = [
        {"parameter": "Note Date", "operator": "OnOrAfter", "value": start.isoformat()},
        {"parameter": "Note Date", "operator": "OnOrBefore", "value": end.isoformat()},
    ]
    groups = []
    for prefix in NOTE_TYPE_PREFIXES:
        groups.append(
            {
                "conditions": [
                    {"parameter": "Note Type", "operator": "StartsWith", "value": prefix},
                    *date_conditions,
                ]
            }
        )
    for exact in NOTE_TYPE_EXACT:
        groups.append(
            {
                "conditions": [
                    {"parameter": "Note Type", "operator": "Is", "value": exact},
                    *date_conditions,
                ]
            }
        )
    return {"groups": groups}


def _event_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    date_conditions = [
        {"parameter": "Start Date", "operator": "OnOrAfter", "value": start.isoformat()},
        {"parameter": "Start Date", "operator": "OnOrBefore", "value": end.isoformat()},
    ]
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Event Name", "operator": "Contains", "value": kw},
                    *date_conditions,
                ]
            }
            for kw in EVENT_MATCH_KEYWORDS
        ]
    }


def handler(event, context):  # noqa: ANN001, ARG001
    api_key = os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        raise RuntimeError("VIRTUOUS_API_KEY required")
    base = os.environ.get("VIRTUOUS_BASE_URL", "https://api.virtuoussoftware.com")
    window = int(os.environ.get("NOTE_WINDOW_DAYS", "365"))
    page_size = int(os.environ.get("PAGE_SIZE", "1000"))

    client = VirtuousClient(api_key, base)
    today = dt.date.today()
    start = today - dt.timedelta(days=window)

    print(f"Fetching notes {start} → {today}", flush=True)
    raw_notes = client.paged_query("/api/ContactNote/Query", _note_query(start, today), page_size)
    roster = set(MA_ROSTER)
    notes_by_id: dict[int, dict] = {}
    for row in raw_notes:
        rid = row.get("id")
        if rid is None:
            continue
        if (row.get("createdByUser") or "").strip() not in roster:
            continue
        notes_by_id[rid] = row
    notes = list(notes_by_id.values())

    print(f"Fetching events {start} → {today}", flush=True)
    raw_events = client.paged_query("/api/Event/Query", _event_query(start, today), page_size)
    events_by_id: dict[int, dict] = {}
    for row in raw_events:
        rid = row.get("id")
        if rid is None:
            continue
        events_by_id[rid] = {k: row.get(k) for k in EVENT_FIELDS}
    events = list(events_by_id.values())

    dates = sorted(d for d in (n.get("noteDate") for n in notes) if d)
    meta = {
        "sample": False,
        "provenance": "Raw Virtuous ContactNote + Events for MA points (client-side scoring).",
        "generated_at": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "note_window_days": window,
        "note_date_range": [dates[0], dates[-1]] if dates else None,
        "record_counts": {"notes": len(notes), "events": len(events)},
        "roster": MA_ROSTER,
    }

    bucket = data_bucket()
    prefix = "points/data"
    put_json(f"{prefix}/notes.json", notes, bucket=bucket)
    put_json(f"{prefix}/events.json", events, bucket=bucket)
    put_json(f"{prefix}/meta.json", meta, bucket=bucket)
    print(f"published {len(notes)} notes, {len(events)} events → s3://{bucket}/{prefix}/", flush=True)
    return {"ok": True, "record_counts": meta["record_counts"], "generated_at": meta["generated_at"]}
