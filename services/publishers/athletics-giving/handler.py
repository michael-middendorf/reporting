"""Department athletics giving publisher.

Recreates the Qlik Athletics Giving / Gifts for Athletics views from Virtuous
GiftDesignation rows, not from Qlik QVDs.

Qlik filters gifts whose Segment Name is one of:
  Athletics Fundraising
  Athletics - Specific Sport
  Athletics Fundraising-HIST_DS

Athletics event gifts post to their own event segments, not those three.
Segment Name Contains Tournament, Booster, Hall of Fame, or Sponsorship
picks up golf tournaments, Gyrene Booster Club, Boosters registration,
Hall of Fame, and athletics sponsorships. Athletics Program - General
gifts that are not those named events still show as Athletics Sponsorship
on the Giving Event dropdown.

Sport-fund gifts can be tagged Direct Solicitation (MGO) or other non-
athletics segments. Coaching fundraising queries by project code, so Master
Giving also queries those athletics funds (plus general / booster /
scholarship / XC) so a football gift on the coaching sheet is on Master too.

Those QVDs live in lib://Advancement (DEV):DataFiles/virtuous_full_gifts_*.qvd
and are produced by the Advancement Virtuous reload apps. This publisher hits
POST /api/GiftDesignation/Query with Qlik segments, athletics events, and
athletics project codes so totals stay on the designation grain (one fund
split per gift). That avoids the Qlik join that inflates Sum(amountDesignated)
and the Concat(segment) "Gift Destination" cell.

CREDITCARDCOSTS is kept on gift rows (Qlik shows it) and split out of program
totals. Do not read sources/virtuous/gifts (365-day window).
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

CACHE_KEY = os.environ.get("ATHLETICS_GIVING_CACHE_KEY") or "athletics-giving/latest.json"
GIFT_DESIGNATION_QUERY_PATH = "/api/GiftDesignation/Query"
RETRYABLE = {429, 500, 502, 503, 504}
CONTACT_VIEW = "https://app.virtuoussoftware.com/Generosity/Contact/View"

SEGMENTS = (
    "Athletics Fundraising",
    "Athletics - Specific Sport",
    "Athletics Fundraising-HIST_DS",
)
EVENT_NAME_CONTAINS = (
    "Tournament",
    "Booster",
    "Hall of Fame",
    "Sponsorship",
)
# Keep in sync with athletics-coaching sports.ts plus general athletics funds.
ATHLETICS_PROJECT_CODES = (
    "6625Cheer",
    "6596Dance",
    "6552FB",
    "6543MBase",
    "6530MBB",
    "6622MGolf",
    "6569MSoc",
    "6540MRugby",
    "6201Swim",
    "6563Tennis",
    "6683Track",
    "6251FrisM",
    "6514WBB",
    "6654WLACR",
    "6572WSoc",
    "6557WSoft",
    "6573WVB",
    "6578MXC",
    "6580WXC",
    "6117AthGEN",
    "6644",
    "6521",
)
FEE_CODES = frozenset({"CREDITCARDCOSTS"})


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
                detail = exc.read().decode("utf-8", errors="replace")[:200]
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


def fiscal_year_label(fy: int) -> str:
    return f"FY {fy - 1}-{str(fy)[2:]}"


def parse_money(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace("$", "").replace(",", "").strip()
    if not text:
        return None
    neg = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    try:
        n = float(text)
    except ValueError:
        return None
    return -n if neg else n


def parse_gift_date(value: Any) -> dt.date | None:
    """Parse Virtuous 'M/D/YYYY' and ISO 'YYYY-MM-DD...' gift dates."""
    text = str(value or "").strip()
    if not text:
        return None
    if "/" in text:
        parts = text.split("/")
        if len(parts) != 3:
            return None
        try:
            return dt.date(int(parts[2]), int(parts[0]), int(parts[1]))
        except ValueError:
            return None
    try:
        return dt.date.fromisoformat(text[:10])
    except ValueError:
        return None


def previous_fiscal_year_start(fy_start: dt.date) -> dt.date:
    return dt.date(fy_start.year - 1, fy_start.month, fy_start.day)


def _date_condition(since: dt.date | None) -> list[dict[str, str]]:
    if since is None:
        return []
    return [{"parameter": "Gift Date", "operator": "OnOrAfter", "value": since.isoformat()}]


def designation_query(since: dt.date | None = None) -> dict[str, Any]:
    groups = [
        {
            "conditions": [
                {"parameter": "Segment Name", "operator": "Is", "value": segment},
                *_date_condition(since),
            ]
        }
        for segment in SEGMENTS
    ]
    for needle in EVENT_NAME_CONTAINS:
        groups.append(
            {
                "conditions": [
                    {"parameter": "Segment Name", "operator": "Contains", "value": needle},
                    *_date_condition(since),
                ]
            }
        )
    for code in ATHLETICS_PROJECT_CODES:
        groups.append(
            {
                "conditions": [
                    {"parameter": "Project Code", "operator": "Is", "value": code},
                    *_date_condition(since),
                ]
            }
        )
    return {"groups": groups}


def unique_designations(raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[Any] = set()
    out: list[dict[str, Any]] = []
    for raw in raw_rows:
        key = raw.get("id")
        if key is None:
            key = (
                raw.get("giftId"),
                raw.get("projectCode"),
                raw.get("amountDesignated"),
                raw.get("segmentName") or raw.get("segment"),
            )
        if key in seen:
            continue
        seen.add(key)
        out.append(raw)
    return out


def contact_url(contact_id: Any) -> str | None:
    if contact_id is None or contact_id == "":
        return None
    return f"{CONTACT_VIEW}/{contact_id}"


def normalize_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    gift_day = parse_gift_date(raw.get("giftDate") or raw.get("giftDateFormatted"))
    amount = parse_money(raw.get("amountDesignated"))
    if amount is None:
        return None
    project = str(raw.get("project") or "").strip() or None
    code = str(raw.get("projectCode") or "").strip() or None
    gift_id = raw.get("giftId")
    if gift_id is None:
        gift_id = raw.get("giftID")
    contact_id = raw.get("contactId")
    return {
        "giftId": gift_id,
        "giftDate": gift_day.isoformat() if gift_day else None,
        "contactId": contact_id,
        "contactName": str(raw.get("contactName") or "").strip() or None,
        "contactUrl": contact_url(contact_id),
        "amountDesignated": round(amount, 2),
        "project": project,
        "projectCode": code,
        "segment": str(raw.get("segmentName") or raw.get("segment") or "").strip() or None,
        "segmentCode": str(raw.get("segmentCode") or "").strip() or None,
        "giftType": str(raw.get("giftType") or "").strip() or None,
        "isFee": code in FEE_CODES if code else False,
        "isPrivate": bool(raw.get("giftIsPrivate") or raw.get("isPrivate")),
    }


def window_totals(
    rows: list[dict[str, Any]],
    start: dt.date | None,
    end: dt.date | None,
) -> dict[str, Any]:
    total = 0.0
    program = 0.0
    fees = 0.0
    gift_ids: set[Any] = set()
    anonymous = 0
    designation_count = 0
    for row in rows:
        day = parse_gift_date(row.get("giftDate"))
        if start is not None and (day is None or day < start):
            continue
        if end is not None and (day is None or day > end):
            continue
        designation_count += 1
        amount = float(row.get("amountDesignated") or 0)
        total += amount
        if row.get("isFee"):
            fees += amount
        else:
            program += amount
        gift_id = row.get("giftId")
        if gift_id is None:
            anonymous += 1
        else:
            gift_ids.add(gift_id)
    return {
        "amount": round(total, 2),
        "programAmount": round(program, 2),
        "feeAmount": round(fees, 2),
        "giftCount": len(gift_ids) + anonymous,
        "designationCount": designation_count,
    }


def fund_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str | None, str | None], dict[str, Any]] = {}
    gift_ids: dict[tuple[str | None, str | None], set[Any]] = defaultdict(set)
    anonymous: dict[tuple[str | None, str | None], int] = defaultdict(int)
    for row in rows:
        key = (row.get("projectCode"), row.get("project"))
        bucket = buckets.setdefault(
            key,
            {
                "project": row.get("project"),
                "projectCode": row.get("projectCode"),
                "amount": 0.0,
                "isFee": bool(row.get("isFee")),
            },
        )
        bucket["amount"] += float(row.get("amountDesignated") or 0)
        gift_id = row.get("giftId")
        if gift_id is None:
            anonymous[key] += 1
        else:
            gift_ids[key].add(gift_id)
    out: list[dict[str, Any]] = []
    for key, bucket in buckets.items():
        out.append(
            {
                "project": bucket["project"],
                "projectCode": bucket["projectCode"],
                "amount": round(bucket["amount"], 2),
                "giftCount": len(gift_ids[key]) + anonymous[key],
                "isFee": bucket["isFee"],
            }
        )
    out.sort(key=lambda item: (-item["amount"], item.get("project") or ""))
    return out


def build_snapshot(
    raw_rows: list[dict[str, Any]],
    *,
    today: dt.date,
    generated_at: str,
) -> dict[str, Any]:
    fy, fy_start, fy_end = fiscal_year_window(today)
    since = previous_fiscal_year_start(fy_start)
    rows = [row for row in (normalize_row(raw) for raw in unique_designations(raw_rows)) if row]
    rows = [
        row
        for row in rows
        if (day := parse_gift_date(row.get("giftDate"))) is not None and day >= since
    ]
    rows.sort(
        key=lambda row: (
            row.get("giftDate") or "",
            row.get("giftId") if isinstance(row.get("giftId"), (int, float)) else 0,
        ),
        reverse=True,
    )
    week_start = today - dt.timedelta(days=7)
    return {
        "generated_at": generated_at,
        "source": "virtuous",
        "segments": list(
            dict.fromkeys(
                [
                    *SEGMENTS,
                    *[
                        str(row.get("segment"))
                        for row in rows
                        if row.get("segment") and row.get("segment") not in SEGMENTS
                    ],
                ]
            )
        ),
        "fiscalYear": fy,
        "fiscalYearLabel": fiscal_year_label(fy),
        "fyStart": fy_start.isoformat(),
        "fyEnd": fy_end.isoformat(),
        "since": since.isoformat(),
        "asOf": generated_at,
        "weekly": window_totals(rows, week_start, today),
        "fytd": window_totals(rows, fy_start, min(today, fy_end)),
        "lastFy": window_totals(rows, since, fy_start - dt.timedelta(days=1)),
        "allTime": window_totals(rows, since, None),
        "funds": fund_rows(rows),
        "gifts": rows,
    }


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
    if not key:
        raise RuntimeError("VIRTUOUS_API_KEY is required")
    client = VirtuousClient(
        key,
        os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com",
    )
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    _fy, fy_start, _fy_end = fiscal_year_window(today)
    since = previous_fiscal_year_start(fy_start)
    print(
        f"  athletics giving querying GiftDesignation by segment since {since.isoformat()}…",
        flush=True,
    )
    raw = client.paged_query(GIFT_DESIGNATION_QUERY_PATH, designation_query(since))
    snapshot = build_snapshot(raw, today=today, generated_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    print(
        f"  athletics giving gifts={snapshot['allTime']['giftCount']} "
        f"designations={len(snapshot['gifts'])} "
        f"fytd={snapshot['fytd']['amount']} weekly={snapshot['weekly']['amount']}",
        flush=True,
    )
    return snapshot
