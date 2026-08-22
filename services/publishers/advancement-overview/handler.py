"""FY Advancement Overview publisher.

Mirrors the Qlik Advancement Overview Results sheet using live Virtuous data.
Each run builds the current fiscal year and the prior fiscal year so the
Overview page can switch between them. Writes ``advancement-overview/latest.json``
and returns the snapshot so the reporting API can invoke this function on a
cache miss.
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

GIFT_PATH = "/api/Gift/Query"
FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
ASK_PATH = "/api/GiftAsk/Query"
PLEDGE_PATH_V2 = "/api/v2/Pledge/Query"
PLANNED_PATH = "/api/PlannedGift/Query"
DESIGNATION_PATH = "/api/GiftDesignation/Query"

CACHE_KEY = os.environ.get("ADVANCEMENT_OVERVIEW_CACHE_KEY") or "advancement-overview/latest.json"
RETRYABLE = {429, 500, 502, 503, 504}

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


def _status_key(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


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


def shift_years(day: dt.date, years: int) -> dt.date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        return dt.date(day.year + years, day.month, 28)


def fiscal_year_label(fy: int) -> str:
    return f"FY {fy - 1}-{str(fy)[2:]}"


def gauge_label(fy: int) -> str:
    return f"of {str(fy - 1)[2:]}/{str(fy)[2:]} FY"


def overview_windows(today: dt.date) -> list[tuple[int, dt.date, dt.date, dt.date]]:
    """Current FY then prior FY: (fy, start, end, as_of)."""
    fy, start, end = fiscal_year_window(today)
    windows = []
    for offset in (0, 1):
        year = fy - offset
        fy_start = shift_years(start, -offset)
        fy_end = shift_years(end, -offset)
        windows.append((year, fy_start, fy_end, min(today, fy_end)))
    return windows


def virt_date(day: dt.date) -> str:
    return f"{day.month}/{day.day}/{day.year}"


def _between(day: dt.date | None, start: dt.date, end: dt.date) -> bool:
    return day is not None and start <= day <= end


def _gift_date(gift: dict[str, Any]) -> dt.date | None:
    return _parse_date(gift.get("giftDate") or gift.get("giftDateFormatted"))


def _query_since(parameter: str, start: dt.date, extra: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    conditions = [
        {"parameter": parameter, "operator": "OnOrAfter", "value": virt_date(start)},
        *(extra or []),
    ]
    return {"groups": [{"conditions": conditions}]}


def _delta(cur: float, prv: float) -> dict[str, Any]:
    diff = cur - prv
    pct = round(100.0 * diff / prv, 1) if prv else None
    return {
        "current": round(cur, 2),
        "prior": round(prv, 2),
        "difference": round(diff, 2),
        "pct": pct,
    }


def _assemble_year(
    *,
    fy: int,
    fy_start: dt.date,
    fy_end: dt.date,
    as_of: dt.date,
    gifts: list[dict[str, Any]],
    designations: list[dict[str, Any]],
    solicitor_gifts: list[dict[str, Any]],
    pledges: list[dict[str, Any]],
    realized: list[dict[str, Any]],
    planned: list[dict[str, Any]],
    asks: list[dict[str, Any]],
) -> dict[str, Any]:
    prior_start = shift_years(fy_start, -1)
    prior_as_of = shift_years(as_of, -1)

    current_by_id: dict[Any, dict[str, Any]] = {}
    current_total = 0.0
    prior_overall = 0.0
    for gift in gifts:
        gift_day = _gift_date(gift)
        amount = _num(gift.get("amount"))
        if _between(gift_day, fy_start, as_of):
            current_total += amount
            current_by_id[gift.get("id")] = gift
        if _between(gift_day, prior_start, prior_as_of):
            prior_overall += amount

    unrestricted_gift_ids: set[Any] = set()
    for row in designations:
        if (row.get("projectLocation") or "") != "Unrestricted":
            continue
        gid = row.get("giftId") or row.get("gift_id")
        if gid in current_by_id:
            unrestricted_gift_ids.add(gid)
    unrestricted_total = 0.0
    for gid in unrestricted_gift_ids:
        unrestricted_total += _num(current_by_id[gid].get("amount"))

    mgo_current = 0.0
    mgo_prior = 0.0
    by_solicitor: dict[str, float] = defaultdict(float)
    for gift in solicitor_gifts:
        name = (_custom(gift, "GFT_Solicitor") or "").strip()
        if name not in SOLICITOR_NAMES:
            continue
        amount = _num(gift.get("amount"))
        gift_day = _gift_date(gift)
        if _between(gift_day, fy_start, as_of):
            mgo_current += amount
            by_solicitor[name] += amount
        if _between(gift_day, prior_start, prior_as_of):
            mgo_prior += amount

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

    cancelled = {"cancelled", "canceled", "writeoff", "write off"}
    new_pledges = 0
    for pledge in pledges:
        if _status_key(pledge.get("status")) in cancelled:
            continue
        if _between(_parse_date(pledge.get("pledgeDate")), fy_start, as_of):
            new_pledges += 1

    realized_count = 0
    for gift in realized:
        if _between(_gift_date(gift), fy_start, as_of):
            realized_count += 1
    planned_count = 0
    for row in planned:
        if _between(_parse_date(row.get("plannedGiftDate")), fy_start, as_of):
            planned_count += 1
    estate_count = realized_count + planned_count

    pipeline_map: dict[str, dict[str, Any]] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    for ask in asks:
        status = " ".join((ask.get("status") or "").split())
        if not status or status in PIPELINE_EXCLUDE:
            continue
        ask_day = _parse_date(ask.get("askDate") or ask.get("askDateFormatted"))
        if not _between(ask_day, fy_start, as_of):
            continue
        pipeline_map[status]["amount"] += _num(ask.get("askAmount"))
        pipeline_map[status]["count"] += 1
    pipeline = []
    seen: set[str] = set()
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

    return {
        "fiscalYear": fy,
        "fiscalYearLabel": fiscal_year_label(fy),
        "gaugeLabel": gauge_label(fy),
        "fyStart": fy_start.isoformat(),
        "fyEnd": fy_end.isoformat(),
        "asOf": as_of.isoformat(),
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
                "realizedBequests": realized_count,
                "bequestIntentions": planned_count,
            },
        },
        "ytd": {
            "overall": _delta(current_total, prior_overall),
            "mgoTeam": _delta(mgo_current, mgo_prior),
            "currentYear": fy_start.year,
            "priorYear": prior_start.year,
        },
        "officers": officers,
        "pipeline": {
            "rows": pipeline,
            "totalAmount": round(sum(r["amount"] for r in pipeline), 2),
            "totalCount": sum(r["count"] for r in pipeline),
        },
    }


def build_snapshot(client: VirtuousClient, today: dt.date) -> dict[str, Any]:
    windows = overview_windows(today)
    oldest = shift_years(windows[0][1], -2)
    print(f"  fetching gifts since {virt_date(oldest)}…", flush=True)
    gifts = client.paged_query(GIFT_PATH, _query_since("Gift Date", oldest), 1000)
    print(f"  gifts: {len(gifts)}", flush=True)

    print("  fetching designations…", flush=True)
    designations = client.paged_query(
        DESIGNATION_PATH,
        _query_since("Gift Date", oldest),
        1000,
    )
    print(f"  designations: {len(designations)}", flush=True)

    print("  fetching MGO solicitor gifts…", flush=True)
    try:
        solicitor_gifts = client.paged_query(
            FULL_GIFT_PATH,
            _query_since(
                "Gift Date",
                oldest,
                [{"parameter": "GFT_Solicitor", "operator": "IsKnown"}],
            ),
            200,
        )
    except RuntimeError as exc:
        print(f"  solicitor query by custom field failed ({exc}); using full-gift date window", flush=True)
        solicitor_gifts = client.paged_query(
            FULL_GIFT_PATH,
            _query_since("Gift Date", oldest),
            200,
        )
    print(f"  solicitor gifts: {len(solicitor_gifts)}", flush=True)

    print("  fetching pledges / estate / asks…", flush=True)
    # /api/Pledge/Query is RecurringGift, not multi-year pledges. Qlik counts
    # v2 Pledge rows with Frequency = Annually and pledgeDate in the FY through as-of.
    pledges = client.paged_query(
        PLEDGE_PATH_V2,
        _query_since(
            "Pledge Date",
            oldest,
            [{"parameter": "Frequency", "operator": "Is", "value": "Annually"}],
        ),
        200,
    )
    realized = client.paged_query(
        GIFT_PATH,
        _query_since(
            "Gift Date",
            oldest,
            [{"parameter": "Segment Name", "operator": "Is", "value": "Realized Bequest"}],
        ),
        200,
    )
    planned = client.paged_query(
        PLANNED_PATH,
        {"groups": [{"conditions": [
            {"parameter": "Segment Name", "operator": "Is", "value": "Bequest Intentions"},
        ]}]},
        200,
    )
    asks = client.paged_query(ASK_PATH, _query_since("Ask Date", oldest), 500)

    years = [
        _assemble_year(
            fy=fy,
            fy_start=fy_start,
            fy_end=fy_end,
            as_of=as_of,
            gifts=gifts,
            designations=designations,
            solicitor_gifts=solicitor_gifts,
            pledges=pledges,
            realized=realized,
            planned=planned,
            asks=asks,
        )
        for fy, fy_start, fy_end, as_of in windows
    ]
    current = years[0]
    snapshot = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "virtuous",
        "currentFiscalYear": current["fiscalYear"],
        "fiscalYearLabel": current["fiscalYearLabel"],
        "gaugeLabel": current["gaugeLabel"],
        "asOf": current["asOf"],
        "kpis": current["kpis"],
        "ytd": current["ytd"],
        "officers": current["officers"],
        "pipeline": current["pipeline"],
        "fiscalYears": years,
    }
    print(
        f"  {current['fiscalYearLabel']} total={current['kpis']['totalFundraising']['amount']:.2f} "
        f"unrestricted={current['kpis']['unrestricted']['amount']:.2f} "
        f"pledges={current['kpis']['multiYearPledges']['count']} "
        f"estate={current['kpis']['estateGifts']['count']} "
        f"pipeline={current['pipeline']['totalCount']}",
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
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
