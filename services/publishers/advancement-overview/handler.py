"""FY Advancement Overview publisher.

Mirrors the Qlik app "FY 25_26 Advancement Overview" Results sheet using live
Virtuous data. Writes ``advancement-overview/latest.json`` and returns the
snapshot so the reporting API can invoke this function on a cache miss.
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

from common.s3util import put_json

GIFT_PATH = "/api/Gift/Query"
FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
ASK_PATH = "/api/GiftAsk/Query"
PLEDGE_PATH = "/api/Pledge/Query"
PLEDGE_PATH_V2 = "/api/v2/Pledge/Query"
PLANNED_PATH = "/api/PlannedGift/Query"
DESIGNATION_PATH = "/api/GiftDesignation/Query"

CACHE_KEY = os.environ.get("ADVANCEMENT_OVERVIEW_CACHE_KEY") or "advancement-overview/latest.json"
RETRYABLE = {429, 500, 502, 503, 504}

FY_START = dt.date(2025, 7, 1)
PRIOR_FY_START = dt.date(2024, 7, 1)
TOTAL_GOAL = 16_000_000
UNRESTRICTED_GOAL = 10_000_000
PLEDGE_GOAL = 30
ESTATE_GOAL = 25

MGO_TEAM = [
    {"name": "Mark Middendorf", "solicitor": "Mark Middendorf", "goal": 5_000_000},
    {"name": "Patrick O'Connell", "solicitor": "Patrick O'Connell", "goal": 4_500_000},
    {"name": "Jim Thomas", "solicitor": "James Thomas", "goal": 3_000_000},
    {"name": "Marita Emond", "solicitor": "Marita Emond", "goal": 2_000_000},
    {"name": "Matthew Buzzanca", "solicitor": "Matthew Buzzanca", "goal": 1_000_000},
    {"name": "Colleen Dolnick", "solicitor": "Colleen Dolnick", "goal": 500_000},
]
SOLICITOR_NAMES = {m["solicitor"] for m in MGO_TEAM}

PIPELINE_EXCLUDE = {
    "Declined (MGO)",
    "Gift Received (Adv Svcs)",
    "Prospect Research Review (Adv Svcs)",
}
PIPELINE_ORDER = [
    "Cultivation / Gift Ask Strategy (MGO)",
    "Preparing Proposal / Agreement (MGO)",
    "Solicitation / Ask (MGO)",
    "Pending (MGO)",
    "Accepted (MGO)",
    "Pending Installment / Annual Gift (MGO)",
]


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


def _custom(gift: dict[str, Any], name: str) -> str | None:
    for field in gift.get("customFields") or []:
        if field.get("name") == name:
            value = field.get("value")
            return str(value) if value else None
    return None


def _gift_on_or_after(body_extra: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    conditions = [
        {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "7/1/2025"},
        *(body_extra or []),
    ]
    return {"groups": [{"conditions": conditions}]}


def build_snapshot(client: VirtuousClient, today: dt.date) -> dict[str, Any]:
    prior_end_inclusive = dt.date(today.year - 1, today.month, today.day)
    prior_end_exclusive = prior_end_inclusive

    print("  fetching gifts since 7/1/2025…", flush=True)
    current_gifts = client.paged_query(GIFT_PATH, _gift_on_or_after(), 1000)
    print(f"  current gifts: {len(current_gifts)}", flush=True)

    print("  fetching gifts since 7/1/2024 (prior-year window)…", flush=True)
    since_prior = client.paged_query(
        GIFT_PATH,
        {"groups": [{"conditions": [
            {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "7/1/2024"},
        ]}]},
        1000,
    )
    print(f"  gifts since 7/1/2024: {len(since_prior)}", flush=True)

    current_by_id: dict[Any, dict[str, Any]] = {}
    current_total = 0.0
    for g in current_gifts:
        amt = _num(g.get("amount"))
        current_total += amt
        current_by_id[g.get("id")] = g

    prior_overall = 0.0
    for g in since_prior:
        gd = _parse_date(g.get("giftDate") or g.get("giftDateFormatted"))
        if gd is None:
            continue
        if PRIOR_FY_START <= gd < prior_end_exclusive:
            prior_overall += _num(g.get("amount"))

    print("  fetching designations since 7/1/2025…", flush=True)
    designations = client.paged_query(
        DESIGNATION_PATH,
        {"groups": [{"conditions": [
            {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "7/1/2025"},
        ]}]},
        1000,
    )
    unrestricted_gift_ids = set()
    for d in designations:
        if (d.get("projectLocation") or "") != "Unrestricted":
            continue
        gid = d.get("giftId") or d.get("gift_id")
        if gid is not None:
            unrestricted_gift_ids.add(gid)
    unrestricted_total = 0.0
    for gid in unrestricted_gift_ids:
        g = current_by_id.get(gid)
        if g:
            unrestricted_total += _num(g.get("amount"))
    print(
        f"  designations={len(designations)} unrestricted gifts={len(unrestricted_gift_ids)} "
        f"amount={unrestricted_total:.2f}",
        flush=True,
    )

    print("  fetching MGO solicitor gifts…", flush=True)
    try:
        solicitor_gifts = client.paged_query(
            FULL_GIFT_PATH,
            {"groups": [{"conditions": [
                {"parameter": "GFT_Solicitor", "operator": "IsKnown"},
                {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "7/1/2024"},
            ]}]},
            200,
        )
    except RuntimeError as exc:
        print(f"  solicitor query by custom field failed ({exc}); using full-gift date window", flush=True)
        solicitor_gifts = client.paged_query(
            FULL_GIFT_PATH,
            {"groups": [{"conditions": [
                {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "7/1/2024"},
            ]}]},
            200,
        )
    print(f"  solicitor gifts: {len(solicitor_gifts)}", flush=True)

    mgo_current = 0.0
    mgo_prior = 0.0
    by_solicitor: dict[str, float] = defaultdict(float)
    for g in solicitor_gifts:
        name = (_custom(g, "GFT_Solicitor") or "").strip()
        if name not in SOLICITOR_NAMES:
            continue
        amt = _num(g.get("amount"))
        gd = _parse_date(g.get("giftDate") or g.get("giftDateFormatted"))
        if gd is None:
            continue
        if gd >= FY_START and gd <= today:
            mgo_current += amt
            by_solicitor[name] += amt
        if PRIOR_FY_START <= gd <= prior_end_inclusive:
            mgo_prior += amt

    officers = []
    for row in MGO_TEAM:
        received = round(by_solicitor.get(row["solicitor"], 0.0), 2)
        goal = row["goal"]
        officers.append({
            "name": row["name"],
            "solicitor": row["solicitor"],
            "goal": goal,
            "received": received,
            "pctToGoal": round(100.0 * received / goal, 0) if goal else None,
        })

    print("  fetching pledges / estate / asks…", flush=True)
    try:
        pledges = client.paged_query(
            PLEDGE_PATH,
            {"groups": [{"conditions": [{"parameter": "Frequency", "operator": "Is", "value": "Annually"}]}]},
            500,
        )
    except RuntimeError:
        pledges = client.paged_query(
            PLEDGE_PATH_V2,
            {"groups": [{"conditions": [{"parameter": "Frequency", "operator": "Is", "value": "Annually"}]}]},
            500,
        )
    new_pledges = 0
    for p in pledges:
        pd = _parse_date(p.get("pledgeDate"))
        if pd is not None and pd >= FY_START:
            new_pledges += 1

    realized = client.paged_query(
        GIFT_PATH,
        _gift_on_or_after([{"parameter": "Segment Name", "operator": "Is", "value": "Realized Bequest"}]),
        200,
    )
    planned = client.paged_query(
        PLANNED_PATH,
        {"groups": [{"conditions": [
            {"parameter": "Segment Name", "operator": "Is", "value": "Bequest Intentions"},
        ]}]},
        200,
    )
    planned_count = 0
    for p in planned:
        pd = _parse_date(p.get("plannedGiftDate"))
        if pd is not None and pd >= FY_START:
            planned_count += 1
    estate_count = len(realized) + planned_count

    asks = client.paged_query(
        ASK_PATH,
        {"groups": [{"conditions": [
            {"parameter": "Ask Date", "operator": "OnOrAfter", "value": "7/1/2025"},
        ]}]},
        500,
    )
    pipeline_map: dict[str, dict[str, Any]] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    for a in asks:
        status = (a.get("status") or "").strip()
        if not status or status in PIPELINE_EXCLUDE:
            continue
        ad = _parse_date(a.get("askDate") or a.get("askDateFormatted"))
        if ad is None or ad < FY_START:
            continue
        pipeline_map[status]["amount"] += _num(a.get("askAmount"))
        pipeline_map[status]["count"] += 1
    pipeline = []
    seen = set()
    for status in PIPELINE_ORDER:
        if status in pipeline_map:
            row = pipeline_map[status]
            pipeline.append({
                "status": status,
                "amount": round(row["amount"], 2),
                "count": row["count"],
            })
            seen.add(status)
    for status, row in sorted(pipeline_map.items()):
        if status in seen:
            continue
        pipeline.append({
            "status": status,
            "amount": round(row["amount"], 2),
            "count": row["count"],
        })
    pipeline_total_amount = round(sum(r["amount"] for r in pipeline), 2)
    pipeline_total_count = sum(r["count"] for r in pipeline)

    def _delta(cur: float, prv: float) -> dict[str, Any]:
        diff = cur - prv
        pct = round(100.0 * diff / prv, 1) if prv else None
        return {"current": round(cur, 2), "prior": round(prv, 2), "difference": round(diff, 2), "pct": pct}

    snapshot = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "virtuous",
        "fiscalYearLabel": "FY 2025-26",
        "asOf": today.isoformat(),
        "kpis": {
            "totalFundraising": {
                "label": "Total Fundraising",
                "amount": round(current_total, 2),
                "goal": TOTAL_GOAL,
                "pctOfGoal": round(100.0 * current_total / TOTAL_GOAL, 0) if TOTAL_GOAL else None,
            },
            "unrestricted": {
                "label": "Unrestricted Gifts",
                "amount": round(unrestricted_total, 2),
                "goal": UNRESTRICTED_GOAL,
                "pctOfGoal": round(100.0 * unrestricted_total / UNRESTRICTED_GOAL, 1) if UNRESTRICTED_GOAL else None,
            },
            "multiYearPledges": {
                "label": "New Multi-Year Pledges",
                "count": new_pledges,
                "goal": PLEDGE_GOAL,
            },
            "estateGifts": {
                "label": "Estate Gifts",
                "count": estate_count,
                "goal": ESTATE_GOAL,
                "realizedBequests": len(realized),
                "bequestIntentions": planned_count,
            },
        },
        "ytd": {
            "overall": _delta(current_total, prior_overall),
            "mgoTeam": _delta(mgo_current, mgo_prior),
        },
        "officers": officers,
        "pipeline": {
            "rows": pipeline,
            "totalAmount": pipeline_total_amount,
            "totalCount": pipeline_total_count,
        },
    }
    print(
        f"  overview total={current_total:.2f} unrestricted={unrestricted_total:.2f} "
        f"pledges={new_pledges} estate={estate_count} pipeline={pipeline_total_count}",
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
    snapshot = build_snapshot(client, dt.datetime.now(dt.timezone.utc).date())
    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
