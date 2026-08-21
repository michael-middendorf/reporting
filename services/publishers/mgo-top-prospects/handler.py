"""FY MGO Top Prospects publisher.

Mirrors the Qlik sheet "FY27 MGO Top Prospects": open Gift Asks whose
expected fulfillment date falls in the current fiscal year (July 1 – June 30),
grouped by the contact's MGO organization group (``Portfolio - {officer}``).

Unlike the collapsed Qlik pivot, this snapshot includes every donor name
under each portfolio so Advancement can see who the asks belong to.

Writes ``mgo-top-prospects/latest.json`` and returns the snapshot so the
reporting API can invoke this function on a cache miss.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from typing import Any

ASK_PATH = "/api/GiftAsk/Query"
GROUP_PATH = "/api/OrganizationGroup"
CONTACT_QUERY = "/api/Contact/Query"

CACHE_KEY = os.environ.get("MGO_TOP_PROSPECTS_CACHE_KEY") or "mgo-top-prospects/latest.json"
RETRYABLE = {429, 500, 502, 503, 504}

PIPELINE_EXCLUDE = {
    "Declined (MGO)",
    "Gift Received (Adv Svcs)",
    "Prospect Research Review (Adv Svcs)",
}
UNASSIGNED = "Unassigned"
CONTACT_VIEW = "https://app.virtuoussoftware.com/Generosity/Contact/View"


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = 1000) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        while True:
            payload = self._request("POST", path, body, {"skip": skip, "take": page_size})
            batch = payload.get("list") or []
            total = int(payload.get("total") or 0)
            rows.extend(batch)
            skip += page_size
            if not batch or skip >= total:
                break
        return rows

    def paged_get(self, path: str, page_size: int = 1000) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        while True:
            payload = self._request("GET", path, None, {"skip": skip, "take": page_size})
            batch = payload.get("list") or []
            total = int(payload.get("total") or 0)
            rows.extend(batch)
            skip += page_size
            if not batch or skip >= total:
                break
        return rows

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}?{urllib.parse.urlencode(params)}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        for attempt in range(6):
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method=method,
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


def fiscal_year_window(today: dt.date) -> tuple[int, dt.date, dt.date]:
    """AMU fiscal year ends June 30 and is named for the year it ends."""
    if today.month >= 7:
        start = dt.date(today.year, 7, 1)
        end = dt.date(today.year + 1, 6, 30)
        fy = today.year + 1
    else:
        start = dt.date(today.year - 1, 7, 1)
        end = dt.date(today.year, 6, 30)
        fy = today.year
    return fy, start, end


def _norm_group(name: str) -> str:
    return " ".join((name or "").replace("–", "-").replace("—", "-").split())


def is_mgo_portfolio(name: str) -> bool:
    n = _norm_group(name).lower()
    if n.startswith("ma portfolio"):
        return False
    return n.startswith("portfolio -")


def portfolio_label(name: str) -> str:
    n = _norm_group(name)
    prefix = "portfolio -"
    if n.lower().startswith(prefix):
        return n[len(prefix) :].strip()
    return n


def _num(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace("$", "").replace(",", "").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def _parse_date(value: Any) -> dt.date | None:
    if not value:
        return None
    text = str(value).strip()
    if "T" in text:
        text = text.split("T", 1)[0]
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _iso(d: dt.date | None) -> str | None:
    return d.isoformat() if d else None


def _contact_url(cid: Any) -> str | None:
    if cid is None or cid == "":
        return None
    return f"{CONTACT_VIEW}/{cid}"


def _status_key(value: Any) -> str:
    return " ".join(str(value or "").split())


def _fold_name(value: str) -> str:
    # Drop punctuation so "O'Connell" matches "OConnell" and "O’Connell".
    return "".join(ch if ch.isalnum() or ch.isspace() else "" for ch in (value or "").lower())


def pick_portfolio(assigned_user: str, labels: list[str]) -> str:
    if not labels:
        return UNASSIGNED
    if len(labels) == 1:
        return labels[0]
    assigned = " ".join(_fold_name(assigned_user).split())
    if assigned:
        for label in labels:
            folded = " ".join(_fold_name(label).split())
            if assigned in folded or folded in assigned:
                return label
        last = assigned.split()[-1]
        for label in labels:
            folded = " ".join(_fold_name(label).split())
            if last and last in folded.split():
                return label
    return sorted(labels)[0]


def build_snapshot(
    asks: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    members: list[dict[str, Any]],
    extra_names: dict[int, str],
    today: dt.date,
) -> dict[str, Any]:
    fy, fy_start, fy_end = fiscal_year_window(today)

    portfolios: dict[str, dict[str, Any]] = {}
    for g in groups:
        raw = g.get("name") or ""
        if not is_mgo_portfolio(raw):
            continue
        label = portfolio_label(raw)
        portfolios[label] = {
            "name": label,
            "groupId": g.get("id"),
            "groupName": raw,
            "askAmount": 0.0,
            "askCount": 0,
            "donorCount": 0,
            "donors": [],
        }

    cid_to_labels: dict[int, list[str]] = defaultdict(list)
    names: dict[int, str] = {
        int(cid): " ".join(str(name).split())
        for cid, name in extra_names.items()
        if name
    }
    for m in members:
        raw = m.get("organizationGroupName") or ""
        if not is_mgo_portfolio(raw):
            continue
        label = portfolio_label(raw)
        cid = m.get("contactId")
        if cid is None:
            continue
        cid_i = int(cid)
        if label not in cid_to_labels[cid_i]:
            cid_to_labels[cid_i].append(label)
        cname = " ".join((m.get("contactName") or "").split())
        if cname:
            names[cid_i] = cname

    open_asks = []
    skipped_status = 0
    skipped_date = 0
    for ask in asks:
        status = _status_key(ask.get("status"))
        if not status or status in PIPELINE_EXCLUDE:
            skipped_status += 1
            continue
        expected = _parse_date(ask.get("expectedFulfillmentDate") or ask.get("expectedFulfillmentDateFormatted"))
        if expected is None or expected < fy_start or expected > fy_end:
            skipped_date += 1
            continue
        open_asks.append(ask)

    by_port_donors: dict[str, dict[int, dict[str, Any]]] = defaultdict(dict)
    for ask in open_asks:
        cid_raw = ask.get("contactId")
        cid = int(cid_raw) if cid_raw is not None and str(cid_raw).strip() != "" else 0
        assigned = (ask.get("assignedUser") or "").strip()
        label = pick_portfolio(assigned, cid_to_labels.get(cid, []))
        if label != UNASSIGNED and label not in portfolios:
            portfolios[label] = {
                "name": label,
                "groupId": None,
                "groupName": None,
                "askAmount": 0.0,
                "askCount": 0,
                "donorCount": 0,
                "donors": [],
            }
        if label == UNASSIGNED and UNASSIGNED not in portfolios:
            portfolios[UNASSIGNED] = {
                "name": UNASSIGNED,
                "groupId": None,
                "groupName": None,
                "askAmount": 0.0,
                "askCount": 0,
                "donorCount": 0,
                "donors": [],
            }
        donor = by_port_donors[label].get(cid)
        if donor is None:
            donor = {
                "contactId": cid or None,
                "donorName": names.get(cid) or (f"Contact {cid}" if cid else "Unknown"),
                "contactUrl": _contact_url(cid) if cid else None,
                "askAmount": 0.0,
                "askCount": 0,
                "statuses": [],
                "asks": [],
            }
            by_port_donors[label][cid] = donor
        amount = round(_num(ask.get("askAmount")), 2)
        donor["askAmount"] = round(donor["askAmount"] + amount, 2)
        donor["askCount"] += 1
        if status := _status_key(ask.get("status")):
            if status not in donor["statuses"]:
                donor["statuses"].append(status)
        donor["asks"].append({
            "id": ask.get("id"),
            "amount": amount,
            "status": _status_key(ask.get("status")) or None,
            "askDate": _iso(_parse_date(ask.get("askDate") or ask.get("askDateFormatted"))),
            "expectedFulfillmentDate": _iso(
                _parse_date(ask.get("expectedFulfillmentDate") or ask.get("expectedFulfillmentDateFormatted"))
            ),
            "assignedUser": assigned or None,
            "project": ask.get("project") or None,
        })

    rows = []
    for label, port in portfolios.items():
        donors = list(by_port_donors.get(label, {}).values())
        for d in donors:
            d["asks"].sort(key=lambda a: (-(a["amount"] or 0), a.get("askDate") or ""))
        donors.sort(key=lambda d: (-d["askAmount"], (d["donorName"] or "").lower()))
        port["donors"] = donors
        port["askAmount"] = round(sum(d["askAmount"] for d in donors), 2)
        port["askCount"] = sum(d["askCount"] for d in donors)
        port["donorCount"] = len(donors)
        rows.append(port)

    named = [p for p in rows if p["name"] != UNASSIGNED]
    named.sort(key=lambda p: (p["name"] or "").lower())
    unassigned = [p for p in rows if p["name"] == UNASSIGNED and p["askCount"]]
    ordered = named + unassigned

    total_amount = round(sum(p["askAmount"] for p in ordered), 2)
    total_asks = sum(p["askCount"] for p in ordered)
    total_donors = sum(p["donorCount"] for p in ordered)
    portfolios_with_asks = sum(1 for p in named if p["askCount"])

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "virtuous",
        "fiscalYear": fy,
        "fiscalYearLabel": f"FY{fy}",
        "fyStart": fy_start.isoformat(),
        "fyEnd": fy_end.isoformat(),
        "asOf": today.isoformat(),
        "definition": (
            "Open Gift Asks (excluding Declined, Gift Received, and Prospect Research Review) "
            "with expected fulfillment in the current fiscal year, grouped by MGO portfolio."
        ),
        "summary": {
            "askAmount": total_amount,
            "askCount": total_asks,
            "donorCount": total_donors,
            "portfolioCount": len(named),
            "portfoliosWithAsks": portfolios_with_asks,
        },
        "portfolios": ordered,
        "skipped": {
            "status": skipped_status,
            "outsideFy": skipped_date,
        },
    }


def _fetch_names(client: VirtuousClient, contact_ids: list[int]) -> dict[int, str]:
    names: dict[int, str] = {}
    unique = sorted({int(c) for c in contact_ids if c})
    for i in range(0, len(unique), 40):
        batch = unique[i : i + 40]
        groups = [
            {"conditions": [{"parameter": "Contact Id", "operator": "Is", "value": str(cid)}]}
            for cid in batch
        ]
        recs = client.paged_query(CONTACT_QUERY, {"groups": groups}, 200)
        for rec in recs:
            cid = rec.get("id")
            name = " ".join((rec.get("name") or rec.get("contactName") or "").split())
            if cid is not None and name:
                names[int(cid)] = name
    return names


def fetch_snapshot(client: VirtuousClient, today: dt.date) -> dict[str, Any]:
    print("  fetching organization groups…", flush=True)
    groups = [g for g in client.paged_get(GROUP_PATH, 1000) if is_mgo_portfolio(g.get("name") or "")]
    print(f"  MGO portfolios: {len(groups)}", flush=True)

    members: list[dict[str, Any]] = []
    for g in groups:
        gid = g.get("id")
        if gid is None:
            continue
        rows = client.paged_get(f"{GROUP_PATH}/{gid}/contacts", 1000)
        members.extend(rows)
        print(f"    {g.get('name')}: {len(rows)} contacts", flush=True)

    print("  fetching gift asks…", flush=True)
    asks = client.paged_query(ASK_PATH, {"groups": []}, 1000)
    print(f"  gift asks: {len(asks)}", flush=True)

    _fy, fy_start, fy_end = fiscal_year_window(today)
    member_ids = {int(m["contactId"]) for m in members if m.get("contactId") is not None}
    need_names: list[int] = []
    for ask in asks:
        status = _status_key(ask.get("status"))
        if not status or status in PIPELINE_EXCLUDE:
            continue
        expected = _parse_date(ask.get("expectedFulfillmentDate") or ask.get("expectedFulfillmentDateFormatted"))
        if expected is None or expected < fy_start or expected > fy_end:
            continue
        cid = ask.get("contactId")
        if cid is None:
            continue
        cid_i = int(cid)
        if cid_i not in member_ids:
            need_names.append(cid_i)
    extra_names = _fetch_names(client, need_names) if need_names else {}
    print(f"  extra contact names: {len(extra_names)}", flush=True)

    snapshot = build_snapshot(asks, groups, members, extra_names, today)
    summary = snapshot["summary"]
    print(
        f"  FY{snapshot['fiscalYear']} asks={summary['askCount']} "
        f"donors={summary['donorCount']} amount={summary['askAmount']:.2f}",
        flush=True,
    )
    return snapshot


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
    if not key:
        raise RuntimeError("VIRTUOUS_API_KEY is required")
    client = VirtuousClient(
        key,
        os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com",
        timeout=180,
    )
    snapshot = fetch_snapshot(client, dt.datetime.now(dt.timezone.utc).date())
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
