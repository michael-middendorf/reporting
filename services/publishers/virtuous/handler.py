"""Virtuous raw publisher → sources/virtuous/{contact_notes,gifts,recurring_gifts,events,contacts}/."""

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
NOTE_TYPE_EXACT = ["Letter", "In Person", "Text Message", "Obituary", "General", "MA Text Returned"]
EVENT_MATCH_KEYWORDS = ["Near You", "Market"]
RETRYABLE = {429, 500, 502, 503, 504}
REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"


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
            except (TimeoutError, urllib.error.URLError) as exc:
                # Virtuous read timeouts (RecurringGift/Query ~03:30Z, ~10:30Z)
                # are transient; retry them like a 5xx.
                if attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                raise RuntimeError(f"Virtuous {path} timed out after retries: {exc}") from exc
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


def _passthrough_gift_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    """DAF / foundation gifts that Virtuous soft-credits to a household."""
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Gift Date", "operator": "OnOrAfter", "value": start.isoformat()},
                    {"parameter": "Gift Date", "operator": "OnOrBefore", "value": end.isoformat()},
                    {"parameter": "Passthrough Contact", "operator": "IsSet"},
                ]
            }
        ]
    }


def merge_passthrough_gifts(gifts: list[dict], passthrough_full: list[dict]) -> list[dict]:
    """Replace slim Gift/Query rows with FullGift rows that carry passthrough contacts."""
    by_id: dict[Any, dict] = {}
    for row in gifts:
        rid = row.get("id")
        if rid is None:
            continue
        by_id[rid] = row
    for row in passthrough_full:
        rid = row.get("id")
        if rid is None:
            continue
        by_id[rid] = row
    return list(by_id.values())


def _recurring_gift_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    """New monthly commitments in the same window as posted gifts."""
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Start Date", "operator": "OnOrAfter", "value": start.isoformat()},
                    {"parameter": "Start Date", "operator": "OnOrBefore", "value": end.isoformat()},
                    {"parameter": "Frequency", "operator": "Is", "value": "Monthly"},
                ]
            }
        ]
    }


def _cancelled_recurring_gift_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    """Monthly gifts cancelled in the window, including ones that started earlier.

    A $25 Mission Fund gift cancelled a few days before a new $50 Annunciation
    Circle gift is the prior amount. Its start date is outside this window, so
    the start-date query never returns it.
    """
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Cancel Date", "operator": "OnOrAfter", "value": start.isoformat()},
                    {"parameter": "Cancel Date", "operator": "OnOrBefore", "value": end.isoformat()},
                    {"parameter": "Frequency", "operator": "Is", "value": "Monthly"},
                ]
            }
        ]
    }


def merge_recurring_gifts(started: list[dict], cancelled: list[dict]) -> list[dict]:
    """Start-date rows stay gifts. Cancel-only rows are prior evidence."""
    by_id: dict[Any, dict] = {}
    for row in started:
        rid = row.get("id")
        if rid is None:
            continue
        by_id[rid] = row
    for row in cancelled:
        rid = row.get("id")
        if rid is None or rid in by_id:
            continue
        tagged = dict(row)
        tagged["priorOnly"] = True
        by_id[rid] = tagged
    return list(by_id.values())


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


def _add_contact_id(ids: set[int], cid: Any) -> None:
    try:
        if cid is not None:
            ids.add(int(cid))
    except (TypeError, ValueError):
        return


def _contact_ids(*row_sets: list[dict]) -> list[int]:
    ids: set[int] = set()
    for rows in row_sets:
        for row in rows:
            cid = row.get("contactId") or row.get("contact_id")
            if cid is None and isinstance(row.get("contact"), dict):
                cid = row["contact"].get("id")
            _add_contact_id(ids, cid)
            _add_contact_id(ids, row.get("contactPassthroughId"))
            for passthrough in row.get("giftPassthroughs") or []:
                if isinstance(passthrough, dict):
                    _add_contact_id(ids, passthrough.get("contactId"))
    return sorted(ids)


def contact_ids_for_refresh(
    notes: list[dict],
    gifts: list[dict],
    recurring: list[dict],
    max_contacts: int,
) -> list[int]:
    """Gift and recurring contacts come first.

    Gift Query has no donor name. A sorted cap kept the oldest contact ids and
    left newer donors as Unknown donor. Every gift contact is fetched. The cap
    only drops note-only contacts.
    """
    gift_ids = _contact_ids(gifts, recurring)
    gift_set = set(gift_ids)
    note_ids = [cid for cid in _contact_ids(notes) if cid not in gift_set]
    if max_contacts <= 0 or len(gift_ids) >= max_contacts:
        return gift_ids
    return gift_ids + note_ids[: max_contacts - len(gift_ids)]


def contact_display_name(contact: dict | None) -> str:
    """Household name from a FullContact row. Gift Query does not carry one."""
    if not isinstance(contact, dict):
        return ""
    for key in ("name", "formalContactName", "informalName", "contactName"):
        value = " ".join(str(contact.get(key) or "").split())
        if value:
            return value
    people = contact.get("contactIndividuals") or contact.get("individuals") or []
    parts: list[str] = []
    for person in people:
        if not isinstance(person, dict):
            continue
        full = " ".join(
            part
            for part in (
                str(person.get("firstName") or "").strip(),
                str(person.get("lastName") or "").strip(),
            )
            if part
        )
        if full:
            parts.append(full)
    if len(parts) >= 2:
        return f"{parts[0]} and {parts[1]}"
    return parts[0] if parts else ""


def contact_id_query(ids: list[int]) -> dict[str, Any]:
    """OR groups of Contact Id Is. Virtuous has no IsAnyOf for that field."""
    return {
        "groups": [
            {"conditions": [{"parameter": "Contact Id", "operator": "Is", "value": cid}]}
            for cid in ids
        ]
    }


def fetch_rows_by_contact_id(client: VirtuousClient, path: str, ids: list[int], chunk_size: int) -> list[dict]:
    """Query contacts by id. A failed chunk is split so one bad id does not drop the rest."""
    rows: list[dict] = []
    pending: list[list[int]] = [ids[i : i + chunk_size] for i in range(0, len(ids), chunk_size)]
    while pending:
        current = pending.pop(0)
        if not current:
            continue
        try:
            payload = client._post(
                path,
                contact_id_query(current),
                params={"skip": 0, "take": max(len(current), 1)},
            )
            rows.extend(payload.get("list") or [])
        except Exception as exc:  # noqa: BLE001
            if len(current) <= 1:
                print(f"contact query failed for {current}: {exc}", flush=True)
                continue
            mid = len(current) // 2
            pending.insert(0, current[mid:])
            pending.insert(0, current[:mid])
    return rows


def stamp_contact_names(rows: list[dict], contacts: list[dict]) -> int:
    """Copy the Virtuous contact name onto rows whose query omitted it."""
    names: dict[int, str] = {}
    for contact in contacts:
        raw_id = contact.get("id", contact.get("contactId"))
        try:
            key = int(raw_id)
        except (TypeError, ValueError):
            continue
        name = contact_display_name(contact)
        if name:
            names[key] = name
    stamped = 0
    for row in rows:
        if " ".join(str(row.get("contactName") or "").split()):
            continue
        try:
            key = int(row.get("contactId"))
        except (TypeError, ValueError):
            continue
        name = names.get(key)
        if not name:
            continue
        row["contactName"] = name
        stamped += 1
    return stamped


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
    print(f"Fetching passthrough gifts {start} → {today}", flush=True)
    passthrough_gifts = client.paged_query(
        "/api/Gift/Query/FullGift", _passthrough_gift_query(start, today), page_size
    )
    gifts = _dedupe(merge_passthrough_gifts(gifts, passthrough_gifts))

    print(f"Fetching monthly recurring gifts {start} → {today}", flush=True)
    started_recurring = client.paged_query(
        "/api/RecurringGift/Query", _recurring_gift_query(start, today), page_size
    )
    cancelled_recurring = client.paged_query(
        "/api/RecurringGift/Query", _cancelled_recurring_gift_query(start, today), page_size
    )
    recurring_gifts = merge_recurring_gifts(started_recurring, cancelled_recurring)

    print(f"Fetching events {start} → {today}", flush=True)
    events = _dedupe(client.paged_query("/api/Event/Query", _event_query(start, today), page_size))

    contact_chunk = int(os.environ.get("CONTACT_CHUNK_SIZE", "100"))
    name_ids = _contact_ids(gifts, recurring_gifts)
    print(f"Fetching names for {len(name_ids)} gift contacts", flush=True)
    name_rows = fetch_rows_by_contact_id(client, "/api/Contact/Query", name_ids, contact_chunk)
    gift_names = stamp_contact_names(gifts, name_rows)
    recurring_names = stamp_contact_names(recurring_gifts, name_rows)
    print(f"Stamped donor names on {gift_names} gifts and {recurring_names} recurring gifts", flush=True)
    published.append(
        publish_dataset(
            source="virtuous",
            dataset="gifts",
            rows=gifts,
            provenance={
                "system": "virtuous",
                "path": "/api/Gift/Query",
                "passthrough_path": "/api/Gift/Query/FullGift",
                "window_days": window,
                "contact_names_stamped": gift_names,
            },
        )
    )
    published.append(
        publish_dataset(
            source="virtuous",
            dataset="recurring_gifts",
            rows=recurring_gifts,
            provenance={
                "system": "virtuous",
                "path": "/api/RecurringGift/Query",
                "window_days": window,
                "frequency": "Monthly",
                "includes_cancelled": True,
                "contact_names_stamped": recurring_names,
            },
        )
    )
    published.append(
        publish_dataset(
            source="virtuous",
            dataset="events",
            rows=events,
            provenance={"system": "virtuous", "path": "/api/Event/Query", "window_days": window},
        )
    )

    ids = contact_ids_for_refresh(notes, gifts, recurring_gifts, max_contacts)
    print(f"Fetching {len(ids)} full contacts", flush=True)
    contacts = _dedupe(
        fetch_rows_by_contact_id(client, "/api/Contact/Query/FullContact", ids, contact_chunk)
    )
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

    _warm_mas()

    return {
        "ok": True,
        "source": "virtuous",
        "datasets": published,
        "counts": {
            "contact_notes": len(notes),
            "gifts": len(gifts),
            "recurring_gifts": len(recurring_gifts),
            "events": len(events),
            "contacts": len(contacts),
        },
    }


def _warm_mas() -> None:
    fn = (os.environ.get("MAS_PROCESS_FUNCTION") or "").strip()
    if not fn:
        return
    try:
        import boto3

        boto3.client("lambda", region_name=REGION).invoke(
            FunctionName=fn,
            InvocationType="Event",
            Payload=json.dumps({"warm_only": True}).encode("utf-8"),
        )
        print(f"Warmed MasProcess ({fn})", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"MasProcess warm failed (non-fatal): {exc}", flush=True)
