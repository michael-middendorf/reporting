"""Virtuous raw publisher → sources/virtuous/{contact_notes,gifts,events,contacts}/."""

from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from common.sources import publish_dataset

NOTE_TYPE_PREFIXES = ["Mission Advancement"]
NOTE_TYPE_EXACT = ["Letter", "In Person", "Text Message"]
EVENT_MATCH_KEYWORDS = ["Near You", "Market"]
RETRYABLE = {429, 500, 502, 503, 504}


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = 1000) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        while True:
            payload = self._post(path, body, params={"skip": skip, "take": page_size})
            batch = payload.get("list") or []
            total = int(payload.get("total") or 0)
            rows.extend(batch)
            skip += page_size
            if not batch or skip >= total:
                break
        return rows

    def get(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _post(self, path: str, body: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}?{urllib.parse.urlencode(params)}"
        data = json.dumps(body).encode("utf-8")
        for attempt in range(6):
            req = urllib.request.Request(
                url,
                data=data,
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
                if exc.code in RETRYABLE and attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                detail = exc.read().decode("utf-8", errors="replace")[:500]
                raise RuntimeError(f"Virtuous {path} → {exc.code}: {detail}") from exc
        raise RuntimeError(f"Virtuous {path} failed after retries")


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


def _gift_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Gift Date", "operator": "OnOrAfter", "value": start.isoformat()},
                    {"parameter": "Gift Date", "operator": "OnOrBefore", "value": end.isoformat()},
                ]
            }
        ]
    }


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


def _dedupe(rows: list[dict], key: str = "id") -> list[dict]:
    out: dict[Any, dict] = {}
    for row in rows:
        rid = row.get(key)
        if rid is None:
            continue
        out[rid] = row
    return list(out.values())


def _contact_ids(*row_sets: list[dict]) -> list[int]:
    ids: set[int] = set()
    for rows in row_sets:
        for row in rows:
            cid = row.get("contactId") or row.get("contact_id")
            if cid is None and isinstance(row.get("contact"), dict):
                cid = row["contact"].get("id")
            try:
                if cid is not None:
                    ids.add(int(cid))
            except (TypeError, ValueError):
                continue
    return sorted(ids)


def handler(event, context):  # noqa: ANN001, ARG001
    api_key = os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        raise RuntimeError("VIRTUOUS_API_KEY required")
    base = os.environ.get("VIRTUOUS_BASE_URL", "https://api.virtuoussoftware.com")
    window = int(os.environ.get("NOTE_WINDOW_DAYS", "365"))
    page_size = int(os.environ.get("PAGE_SIZE", "1000"))
    max_contacts = int(os.environ.get("MAX_CONTACTS", "5000"))

    client = VirtuousClient(api_key, base)
    today = dt.date.today()
    start = today - dt.timedelta(days=window)
    published = []

    print(f"Fetching contact notes {start} → {today}", flush=True)
    notes = _dedupe(client.paged_query("/api/ContactNote/Query", _note_query(start, today), page_size))
    published.append(
        publish_dataset(
            source="virtuous",
            dataset="contact_notes",
            rows=notes,
            provenance={
                "system": "virtuous",
                "path": "/api/ContactNote/Query",
                "window_days": window,
            },
        )
    )

    print(f"Fetching gifts {start} → {today}", flush=True)
    gifts = _dedupe(client.paged_query("/api/Gift/Query", _gift_query(start, today), page_size))
    published.append(
        publish_dataset(
            source="virtuous",
            dataset="gifts",
            rows=gifts,
            provenance={"system": "virtuous", "path": "/api/Gift/Query", "window_days": window},
        )
    )

    print(f"Fetching events {start} → {today}", flush=True)
    events = _dedupe(client.paged_query("/api/Event/Query", _event_query(start, today), page_size))
    published.append(
        publish_dataset(
            source="virtuous",
            dataset="events",
            rows=events,
            provenance={"system": "virtuous", "path": "/api/Event/Query", "window_days": window},
        )
    )

    ids = _contact_ids(notes, gifts)[:max_contacts]
    print(f"Fetching {len(ids)} contacts", flush=True)
    contacts: list[dict] = []
    # Prefer bulk query when possible; fall back to per-id get.
    chunk = 100
    for i in range(0, len(ids), chunk):
        batch_ids = ids[i : i + chunk]
        try:
            body = {
                "groups": [
                    {
                        "conditions": [
                            {
                                "parameter": "Contact Id",
                                "operator": "IsAnyOf",
                                "values": [str(x) for x in batch_ids],
                            }
                        ]
                    }
                ]
            }
            contacts.extend(client.paged_query("/api/Contact/Query/FullContact", body, page_size))
        except Exception as exc:  # noqa: BLE001
            print(f"bulk contact query failed ({exc}); falling back", flush=True)
            for cid in batch_ids:
                try:
                    contacts.append(client.get(f"/api/Contact/{cid}"))
                except Exception as get_exc:  # noqa: BLE001
                    print(f"contact {cid}: {get_exc}", flush=True)

    contacts = _dedupe(contacts)
    published.append(
        publish_dataset(
            source="virtuous",
            dataset="contacts",
            rows=contacts,
            provenance={
                "system": "virtuous",
                "path": "/api/Contact/Query/FullContact",
                "contact_ids": len(ids),
            },
        )
    )

    return {
        "ok": True,
        "source": "virtuous",
        "datasets": published,
        "counts": {
            "contact_notes": len(notes),
            "gifts": len(gifts),
            "events": len(events),
            "contacts": len(contacts),
        },
    }
