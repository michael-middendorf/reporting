"""Year-End Appeal publisher.

Writes ``year-end-appeal/latest.json`` to ReportData (feeds
``/advancement/year-end-appeal``). Gift figures come from Virtuous gifts tagged
to the year-end campaign (default "2026 End of Calendar Year").

Cloned from the Fall Appeal publisher and trimmed to the aggregates this report
needs. Each gift's ``segment`` field carries a source code such as
``FYE27YE_A_2P_RD``. A committed registry (``year-end-codes.json``) maps every
valid code to a donor segment (A, LP12, LP24 or none), a package length (2P or
4P or none) and an asset (RD, BRE, EML, WEB, PC, SS, SOC). Gifts whose code is
not in the registry are reported in one ``unmatched`` bucket so totals still
reconcile.

Mailed counts (pieces sent per code) are optional. When the S3 object named by
YEAR_END_MAILED_KEY exists, response rate = distinct donors / mailed, otherwise
it is null. A rolled-up bucket gets a rate only when every code with gifts has
a mailed count.

The snapshot holds aggregates only. No donor names, ids or addresses.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any


GIFT_QUERY_PATH = "/api/Gift/Query"
RETRYABLE = {429, 500, 502, 503, 504}
DEFAULT_CAMPAIGN = "2026 End of Calendar Year"
DEFAULT_CAMPAIGN_START = dt.date(2026, 11, 13)
DEFAULT_CAMPAIGN_END = dt.date(2027, 6, 30)
DEFAULT_CACHE_KEY = "year-end-appeal/latest.json"
MAX_UNMATCHED_CODES = 50

# Gift-size bands (lower bound inclusive, upper bound inclusive).
GIFT_BANDS = [
    # Lowest band's lower bound is -inf so reversals/refunds and $0 gifts land
    # here and the breakdown reconciles to total net revenue.
    ("lt100", "Under $100", float("-inf"), 99.9999),
    ("100_249", "$100-249", 100.0, 249.9999),
    ("250_499", "$250-499", 250.0, 499.9999),
    ("500_999", "$500-999", 500.0, 999.9999),
    ("1000_2499", "$1,000-2,499", 1000.0, 2499.9999),
    ("2500_4999", "$2,500-4,999", 2500.0, 4999.9999),
    ("5000_plus", "$5,000+", 5000.0, float("inf")),
]

ASSET_LABELS = {
    "RD": "Reply device",
    "BRE": "Business reply envelope",
    "EML": "Email",
    "WEB": "Web",
    "PC": "Postcard",
    "SS": "Stained glass",
    "SOC": "Social",
}
SEGMENT_LABELS = {"A": "A", "LP12": "LP12", "LP24": "LP24", "none": "No segment"}


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
                raise RuntimeError(f"Virtuous {path} returned {exc.code}: {detail}") from exc
        raise RuntimeError(f"Virtuous {path} failed after retries")


# ── parsing helpers ──────────────────────────────────────────────────────────

def _parse_money(value: Any) -> float:
    if value is None:
        return 0.0
    s = str(value).replace("$", "").replace(",", "").strip()
    if not s:
        return 0.0
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        n = float(s)
    except ValueError:
        return 0.0
    return -n if neg else n


def _parse_md(s: Any) -> dt.date | None:
    """Parse Virtuous 'M/D/YYYY' (and ISO 'YYYY-MM-DD...') gift dates."""
    s = (str(s or "")).strip()
    if not s:
        return None
    if "/" in s:
        parts = s.split("/")
        if len(parts) != 3:
            return None
        try:
            return dt.date(int(parts[2]), int(parts[0]), int(parts[1]))
        except ValueError:
            return None
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def _campaign_condition(campaign: str) -> dict[str, Any]:
    return {"parameter": "Campaign Name", "operator": "Is", "value": campaign}


def normalize_gifts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Project raw gift rows to {contactId, amount, date, segment}.

    Rows without a usable date are dropped.
    """
    out: list[dict[str, Any]] = []
    for r in rows:
        d = _parse_md(r.get("giftDate"))
        if d is None:
            continue
        out.append({
            "contactId": r.get("contactId"),
            "amount": _parse_money(r.get("amount")),
            "date": d,
            "segment": r.get("segment"),
        })
    return out


# ── registry ─────────────────────────────────────────────────────────────────

def _code_key(value: Any) -> str:
    return str(value or "").strip().upper()


def load_registry(path: Path | None = None) -> list[dict[str, Any]]:
    """Load the committed code registry.

    Looks next to this file first, then the Lambda task root (SST copyFiles),
    then the working directory.
    """
    candidates = [path] if path else [
        Path(__file__).resolve().parent / "year-end-codes.json",
        Path("/var/task/year-end-codes.json"),
        Path.cwd() / "year-end-codes.json",
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            entries = json.loads(candidate.read_text(encoding="utf-8"))
            return validate_registry(entries)
    tried = [str(c) for c in candidates if c]
    raise FileNotFoundError(f"year-end-codes.json not found (tried {tried})")


def validate_registry(entries: Any) -> list[dict[str, Any]]:
    if not isinstance(entries, list) or not entries:
        raise ValueError("year-end code registry must be a non-empty list")
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for e in entries:
        if not isinstance(e, dict) or not e.get("code") or not e.get("asset"):
            raise ValueError(f"invalid registry entry: {e!r}")
        key = _code_key(e["code"])
        if key in seen:
            raise ValueError(f"duplicate registry code: {key}")
        seen.add(key)
        out.append({
            "code": key,
            "segment": e.get("segment") or None,
            "length": e.get("length") or None,
            "asset": e["asset"],
        })
    return out


# ── aggregation (pure) ───────────────────────────────────────────────────────

def summarize(gifts: list[dict[str, Any]]) -> dict[str, Any]:
    amounts = [g["amount"] for g in gifts]
    total = round(sum(amounts), 2)
    n = len(amounts)
    return {
        "totalRevenue": total,
        "totalGifts": n,
        "avgGift": round(total / n, 2) if n else 0.0,
        "medianGift": round(statistics.median(amounts), 2) if n else 0.0,
        "donors": len({g["contactId"] for g in gifts if g["contactId"] is not None}),
    }


def gift_breakdown(gifts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total = sum(g["amount"] for g in gifts) or 0.0
    bands: list[dict[str, Any]] = []
    for key, label, lo, hi in GIFT_BANDS:
        in_band = [g for g in gifts if lo <= g["amount"] <= hi]
        rev = round(sum(g["amount"] for g in in_band), 2)
        bands.append({
            "key": key,
            "label": label,
            "gifts": len(in_band),
            "revenue": rev,
            "pctOfRevenue": round(100.0 * rev / total, 1) if total else 0.0,
        })
    return bands


def weekly_timeline(
    gifts: list[dict[str, Any]], overlays: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Cumulative revenue + gifts bucketed by week (week starting Monday)."""
    if not gifts:
        return []
    by_week_rev: dict[dt.date, float] = defaultdict(float)
    by_week_cnt: dict[dt.date, int] = defaultdict(int)
    for g in gifts:
        wk = g["date"] - dt.timedelta(days=g["date"].weekday())
        by_week_rev[wk] += g["amount"]
        by_week_cnt[wk] += 1
    start = min(by_week_rev)
    end = max(by_week_rev)
    overlay_by_week: dict[dt.date, list[str]] = defaultdict(list)
    for o in overlays:
        od = _parse_md(o.get("date"))
        if od is None:
            continue
        wk = od - dt.timedelta(days=od.weekday())
        overlay_by_week[wk].append(str(o.get("label") or "").strip())
    out: list[dict[str, Any]] = []
    cum_rev = 0.0
    cum_cnt = 0
    wk = start
    while wk <= end:
        cum_rev += by_week_rev.get(wk, 0.0)
        cum_cnt += by_week_cnt.get(wk, 0)
        out.append({
            "weekStart": wk.isoformat(),
            "label": f"{wk.strftime('%b')} {wk.day}",
            "revenue": round(by_week_rev.get(wk, 0.0), 2),
            "gifts": by_week_cnt.get(wk, 0),
            "cumRevenue": round(cum_rev, 2),
            "cumGifts": cum_cnt,
            "overlays": [m for m in overlay_by_week.get(wk, []) if m],
        })
        wk += dt.timedelta(days=7)
    return out


def pace_series(
    current: list[dict[str, Any]],
    prior: list[dict[str, Any]],
    current_start: dt.date | None,
    prior_start: dt.date | None,
    as_of_offset: int | None,
) -> dict[str, Any]:
    """Point-in-time YoY pace: cumulative revenue/gifts by day-offset from each
    campaign's own start."""

    def cum_by_offset(gifts: list[dict[str, Any]], start: dt.date | None) -> dict[int, dict[str, float]]:
        if start is None:
            return {}
        daily_rev: dict[int, float] = defaultdict(float)
        daily_cnt: dict[int, int] = defaultdict(int)
        for g in gifts:
            off = (g["date"] - start).days
            if off < 0:
                continue
            daily_rev[off] += g["amount"]
            daily_cnt[off] += 1
        max_off = max([*daily_rev.keys(), 0]) if daily_rev else 0
        series: dict[int, dict[str, float]] = {}
        cum_r = 0.0
        cum_c = 0
        for off in range(max_off + 1):
            cum_r += daily_rev.get(off, 0.0)
            cum_c += daily_cnt.get(off, 0)
            series[off] = {"revenue": round(cum_r, 2), "gifts": cum_c}
        return series

    cur_series = cum_by_offset(current, current_start)
    pri_series = cum_by_offset(prior, prior_start)
    max_off = max([*cur_series.keys(), *pri_series.keys(), 0]) if (cur_series or pri_series) else 0

    def at(series: dict[int, dict[str, float]], off: int) -> dict[str, float]:
        if not series:
            return {"revenue": 0.0, "gifts": 0}
        capped = min(off, max(series.keys()))
        return series.get(capped, {"revenue": 0.0, "gifts": 0})

    points: list[dict[str, Any]] = []
    for off in range(max_off + 1):
        points.append({
            "dayOffset": off,
            "currentCum": at(cur_series, off) if off in cur_series else None,
            "priorCum": at(pri_series, off) if off in pri_series else None,
        })

    off_now = as_of_offset if as_of_offset is not None else (max(cur_series.keys()) if cur_series else 0)
    return {
        "asOfOffset": off_now,
        "points": points,
        "priorFinal": at(pri_series, max(pri_series.keys())) if pri_series else {"revenue": 0.0, "gifts": 0},
        "priorToDate": at(pri_series, off_now),
        "currentToDate": at(cur_series, off_now),
    }


def _pct_delta(cur: float, base: float) -> float | None:
    if not base:
        return None
    return round(100.0 * (cur - base) / base, 1)


def normalize_mailed(raw: Any) -> dict[str, int]:
    """Coerce a {code: count} object to {CODE: int}. Bad entries are dropped."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, int] = {}
    for code, count in raw.items():
        if isinstance(count, bool):
            continue
        try:
            n = int(count)
        except (TypeError, ValueError):
            continue
        if n > 0:
            out[_code_key(code)] = n
    return out


def classify_gifts(
    gifts: list[dict[str, Any]], registry: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split gifts into (matched, unmatched). Matched gifts gain registry fields.

    A matched code can still have a null donor segment (the stained glass code).
    That is different from an unmatched gift whose code is blank or unknown.
    """
    by_code = {e["code"]: e for e in registry}
    matched: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    for g in gifts:
        entry = by_code.get(_code_key(g.get("segment")))
        if entry is None:
            unmatched.append(g)
        else:
            matched.append({
                **g,
                "code": entry["code"],
                "donorSegment": entry["segment"],
                "length": entry["length"],
                "asset": entry["asset"],
            })
    return matched, unmatched


def _stats(gifts: list[dict[str, Any]]) -> dict[str, Any]:
    total = round(sum(g["amount"] for g in gifts), 2)
    n = len(gifts)
    return {
        "revenue": total,
        "gifts": n,
        "donors": len({g["contactId"] for g in gifts if g["contactId"] is not None}),
        "avgGift": round(total / n, 2) if n else 0.0,
    }


def _mail_fields(
    codes: list[str], gift_codes: set[str], donors: int, mailed: dict[str, int]
) -> dict[str, Any]:
    """mailed = sum of counts over the bucket's codes, else null.

    ``codes`` are every registry code in the bucket and ``gift_codes`` the ones
    that have gifts. A rollup rate is only valid when every gift-bearing code
    also has a mailed count; otherwise donors from uncounted codes would be
    divided by a smaller denominator and overstate the rate, so both fields are
    null. Codes with no gifts and no count are fine. A single-code row is the
    same rule: its count present means a rate.
    """
    counted = [c for c in codes if c in mailed]
    if not counted or any(c not in mailed for c in gift_codes):
        return {"mailed": None, "responseRate": None}
    total = sum(mailed[c] for c in counted)
    return {"mailed": total, "responseRate": round(100.0 * donors / total, 2)}


def build_aggregates(
    gifts: list[dict[str, Any]],
    registry: list[dict[str, Any]],
    mailed: dict[str, int] | None = None,
) -> dict[str, Any]:
    mailed = mailed or {}
    matched, unmatched = classify_gifts(gifts, registry)

    def bucket_row(rows: list[dict[str, Any]], codes: list[str]) -> dict[str, Any]:
        stats = _stats(rows)
        gift_codes = {g["code"] for g in rows}
        return {**stats, **_mail_fields(codes, gift_codes, stats["donors"], mailed)}

    # byCode: every registry code, zero rows included, in registry order.
    by_code_gifts: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g in matched:
        by_code_gifts[g["code"]].append(g)
    by_code = [
        {
            "code": e["code"],
            "segment": e["segment"],
            "length": e["length"],
            "asset": e["asset"],
            **bucket_row(by_code_gifts.get(e["code"], []), [e["code"]]),
        }
        for e in registry
    ]

    def codes_where(pred) -> list[str]:
        return [e["code"] for e in registry if pred(e)]

    # bySegment: A, LP12, LP24, then "none" (null donor segment).
    segment_keys = sorted({e["segment"] for e in registry if e["segment"]}) + (
        ["none"] if any(not e["segment"] for e in registry) else []
    )
    by_segment = []
    for key in segment_keys:
        want = None if key == "none" else key
        rows = [g for g in matched if g["donorSegment"] == want]
        by_segment.append({
            "key": key,
            "label": SEGMENT_LABELS.get(key, key),
            **bucket_row(rows, codes_where(lambda e, w=want: e["segment"] == w)),
        })

    # byLength: 2P vs 4P overall and within each donor segment. Codes without a
    # length (postcard, stained glass, social) are not part of the comparison.
    lengths = sorted({e["length"] for e in registry if e["length"]})
    by_length = []
    for scope in ["total", *[k for k in segment_keys if k != "none"]]:
        for length in lengths:
            rows = [
                g for g in matched
                if g["length"] == length and (scope == "total" or g["donorSegment"] == scope)
            ]
            codes = codes_where(
                lambda e, s=scope, ln=length: e["length"] == ln and (s == "total" or e["segment"] == s)
            )
            by_length.append({"scope": scope, "length": length, **bucket_row(rows, codes)})

    assets = []
    for e in registry:
        if e["asset"] not in assets:
            assets.append(e["asset"])
    by_asset = [
        {
            "asset": a,
            "label": ASSET_LABELS.get(a, a),
            **bucket_row(
                [g for g in matched if g["asset"] == a],
                codes_where(lambda e, x=a: e["asset"] == x),
            ),
        }
        for a in assets
    ]

    unmatched_codes = sorted({str(g.get("segment") or "").strip() or "(blank)" for g in unmatched})
    unmatched_stats = _stats(unmatched)
    return {
        "bySegment": by_segment,
        "byLength": by_length,
        "byAsset": by_asset,
        "byCode": by_code,
        "unmatched": {
            "revenue": unmatched_stats["revenue"],
            "gifts": unmatched_stats["gifts"],
            "codes": unmatched_codes[:MAX_UNMATCHED_CODES],
        },
        "mailedAvailable": bool(mailed),
    }


# ── entrypoint ───────────────────────────────────────────────────────────────

def _env_date(name: str) -> dt.date | None:
    v = (os.environ.get(name) or "").strip()
    return _parse_md(v) if v else None


def _load_overlays() -> list[dict[str, Any]]:
    raw = (os.environ.get("YEAR_END_OVERLAYS") or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return [o for o in data if isinstance(o, dict)]
    except (ValueError, TypeError):
        print("  YEAR_END_OVERLAYS is not valid JSON, ignoring", flush=True)
        return []


def load_mailed_counts() -> dict[str, int]:
    """Read {code: count} from S3 when YEAR_END_MAILED_KEY is set.

    A missing object is the expected state until Advancement provides counts.
    Other S3 errors propagate so a permission regression is visible.
    """
    key = (os.environ.get("YEAR_END_MAILED_KEY") or "").strip()
    if not key:
        return {}
    from botocore.exceptions import ClientError
    from common.s3util import data_bucket, s3

    try:
        response = s3().get_object(Bucket=data_bucket(), Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
            return {}
        raise
    with response["Body"] as body:
        return normalize_mailed(json.loads(body.read()))


def build_payload(
    client: VirtuousClient,
    campaign: str,
    prior_campaign: str,
    page_size: int,
    today: dt.date,
    *,
    registry: list[dict[str, Any]],
    mailed: dict[str, int] | None = None,
) -> dict[str, Any]:
    raw_gifts = client.paged_query(GIFT_QUERY_PATH, {"groups": [{"conditions": [_campaign_condition(campaign)]}]}, page_size)
    gifts = normalize_gifts(raw_gifts)
    print(f"  {campaign}: {len(gifts)} gifts", flush=True)

    overlays = _load_overlays()
    campaign_start = (
        _env_date("YEAR_END_START")
        or (min(g["date"] for g in gifts) if gifts else None)
        or DEFAULT_CAMPAIGN_START
    )
    campaign_end = _env_date("YEAR_END_END") or DEFAULT_CAMPAIGN_END

    yoy: dict[str, Any] | None = None
    if prior_campaign:
        raw_prior = client.paged_query(
            GIFT_QUERY_PATH, {"groups": [{"conditions": [_campaign_condition(prior_campaign)]}]}, page_size
        )
        prior = normalize_gifts(raw_prior)
        print(f"  {prior_campaign} (prior): {len(prior)} gifts", flush=True)
        prior_start = _env_date("YEAR_END_PRIOR_START") or (min(g["date"] for g in prior) if prior else None)
        as_of_offset = max(0, (today - campaign_start).days)
        pace = pace_series(gifts, prior, campaign_start, prior_start, as_of_offset)
        yoy = {
            "priorCampaign": prior_campaign,
            "priorStart": prior_start.isoformat() if prior_start else None,
            "currentToDate": pace["currentToDate"],
            "priorToDate": pace["priorToDate"],
            "priorFinal": pace["priorFinal"],
            "revenueDeltaPct": _pct_delta(pace["currentToDate"]["revenue"], pace["priorToDate"]["revenue"]),
            "giftsDeltaPct": _pct_delta(pace["currentToDate"]["gifts"], pace["priorToDate"]["gifts"]),
            "asOfOffset": pace["asOfOffset"],
            "points": pace["points"],
        }

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "campaign": campaign,
        "asOf": today.isoformat(),
        "campaignStart": campaign_start.isoformat(),
        "campaignEnd": campaign_end.isoformat(),
        "empty": not gifts,
        "summary": summarize(gifts),
        "yoy": yoy,
        "giftBreakdown": gift_breakdown(gifts),
        "timeline": weekly_timeline(gifts, overlays),
        **build_aggregates(gifts, registry, mailed),
        "overlays": overlays,
    }


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    api_key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("VIRTUOUS_API_KEY required")
    base = os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com"
    campaign = os.environ.get("YEAR_END_CAMPAIGN", DEFAULT_CAMPAIGN)
    prior_campaign = (os.environ.get("YEAR_END_PRIOR_CAMPAIGN") or "").strip()
    key = os.environ.get("YEAR_END_CACHE_KEY") or DEFAULT_CACHE_KEY
    page_size = int(os.environ.get("PAGE_SIZE", "1000"))

    client = VirtuousClient(api_key, base)
    print(f"Building Year-End Appeal report for campaign '{campaign}'...", flush=True)
    payload = build_payload(
        client,
        campaign,
        prior_campaign,
        page_size,
        dt.date.today(),
        registry=load_registry(),
        mailed=load_mailed_counts(),
    )
    from common.s3util import put_json

    uri = put_json(key, payload)
    payload["cache"] = uri
    print(f"  put {uri}", flush=True)
    return payload
