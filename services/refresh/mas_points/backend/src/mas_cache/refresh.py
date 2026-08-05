"""Raw-only cache refresh.

Fetches raw Virtuous ContactNote records for the scoped MA activity and writes
them, UNPROCESSED, to the local data dir and/or the S3 cache bucket. No points
logic lives here — scoring happens entirely in the frontend.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from .config import Config, MA_ROSTER, NOTE_TYPE_PREFIXES, NOTE_TYPE_EXACT, EVENT_MATCH_KEYWORDS
from .virtuous import VirtuousClient

# Lean projection of the fields the frontend needs from an Event. Event
# `description` fields are large HTML blobs, so we keep only display fields
# (this is scoping, not scoring — no points logic lives here).
EVENT_FIELDS = ("id", "name", "startDateTime", "endDateTime", "locationName", "createdByUser")


def _note_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    """OR groups: one per note-type prefix (StartsWith) and exact type (Is),
    each AND-ed with the date window on Note Date."""
    groups: list[dict[str, Any]] = []
    date_conditions = [
        {"parameter": "Note Date", "operator": "OnOrAfter", "value": start.isoformat()},
        {"parameter": "Note Date", "operator": "OnOrBefore", "value": end.isoformat()},
    ]
    for prefix in NOTE_TYPE_PREFIXES:
        groups.append({"conditions": [{"parameter": "Note Type", "operator": "StartsWith", "value": prefix}, *date_conditions]})
    for exact in NOTE_TYPE_EXACT:
        groups.append({"conditions": [{"parameter": "Note Type", "operator": "Is", "value": exact}, *date_conditions]})
    return {"groups": groups}


def fetch_raw_notes(client: VirtuousClient, cfg: Config) -> list[dict[str, Any]]:
    today = dt.date.today()
    start = today - dt.timedelta(days=cfg.note_window_days)
    body = _note_query(start, today)
    print(f"Fetching raw MA notes {start} → {today} ...", flush=True)
    rows = client.paged_query("/api/ContactNote/Query", body, page_size=cfg.page_size)
    # Dedupe by id (groups can overlap) — dedup is not processing, just hygiene.
    deduped: dict[int, dict[str, Any]] = {}
    roster = set(MA_ROSTER)
    kept = 0
    for r in rows:
        rid = r.get("id")
        if rid is None:
            continue
        # Scope to roster authors so the cache stays lean; records are untouched.
        if (r.get("createdByUser") or "").strip() not in roster:
            continue
        deduped[rid] = r
        kept += 1
    print(f"  raw notes fetched: {len(rows)}  kept (roster authors): {len(deduped)}", flush=True)
    return list(deduped.values())


def _event_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    """OR groups: one per event-name keyword (Contains), each AND-ed with the
    date window on Start Date."""
    date_conditions = [
        {"parameter": "Start Date", "operator": "OnOrAfter", "value": start.isoformat()},
        {"parameter": "Start Date", "operator": "OnOrBefore", "value": end.isoformat()},
    ]
    groups = [
        {"conditions": [{"parameter": "Event Name", "operator": "Contains", "value": kw}, *date_conditions]}
        for kw in EVENT_MATCH_KEYWORDS
    ]
    return {"groups": groups}


def fetch_raw_events(client: VirtuousClient, cfg: Config) -> list[dict[str, Any]]:
    """Fetch name-matched Events in the window. Display-only: events carry no MA
    owner in Virtuous, so the frontend shows them for reference and never scores
    them to an MA."""
    today = dt.date.today()
    start = today - dt.timedelta(days=cfg.note_window_days)
    body = _event_query(start, today)
    print(f"Fetching matched events {start} → {today} ...", flush=True)
    rows = client.paged_query("/api/Event/Query", body, page_size=cfg.page_size)
    deduped: dict[int, dict[str, Any]] = {}
    for r in rows:
        rid = r.get("id")
        if rid is None:
            continue
        deduped[rid] = {k: r.get(k) for k in EVENT_FIELDS}
    print(f"  events fetched: {len(rows)}  kept (deduped): {len(deduped)}", flush=True)
    return list(deduped.values())


def build_payloads(cfg: Config, notes: list[dict[str, Any]], events: list[dict[str, Any]]) -> dict[str, Any]:
    dates = sorted(d for d in (n.get("noteDate") for n in notes) if d)
    meta = {
        "sample": False,
        "provenance": "Raw Virtuous ContactNote records (roster authors, scoped note types) plus name-matched Events (display-only). Unprocessed.",
        "generated_at": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "note_window_days": cfg.note_window_days,
        "note_date_range": [dates[0], dates[-1]] if dates else None,
        "record_counts": {"notes": len(notes), "events": len(events)},
        "roster": MA_ROSTER,
    }
    return {
        "notes.json": notes,
        "events.json": events,
        "meta.json": meta,
    }


def write_local(cfg: Config, payloads: dict[str, Any]) -> None:
    out = cfg.local_out_dir
    out.mkdir(parents=True, exist_ok=True)
    for name, payload in payloads.items():
        (out / name).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote raw JSON locally → {out}", flush=True)


def write_s3(cfg: Config, payloads: dict[str, Any]) -> None:
    from .s3 import put_json

    if not cfg.s3_bucket:
        raise RuntimeError("MAS_CACHE_BUCKET not set")
    for name, payload in payloads.items():
        key = f"{cfg.s3_prefix.rstrip('/')}/{name}"
        uri = put_json(
            bucket=cfg.s3_bucket, key=key, payload=payload,
            profile=cfg.aws_profile, region=cfg.aws_region,
        )
        print(f"  put {uri}", flush=True)


def refresh(cfg: Config, *, publish: bool = False, local: bool = True) -> dict[str, Any]:
    client = VirtuousClient(cfg.base_url, cfg.api_key, timeout_seconds=cfg.timeout_seconds)
    notes = fetch_raw_notes(client, cfg)
    events = fetch_raw_events(client, cfg)
    payloads = build_payloads(cfg, notes, events)
    if local:
        write_local(cfg, payloads)
    if publish:
        write_s3(cfg, payloads)
    return payloads["meta.json"]
