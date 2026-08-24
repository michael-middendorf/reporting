"""Fall Appeal publisher.

Writes ``fall-appeal/latest.json`` to ReportData (feeds
``/advancement/fall-appeal``). All figures are sourced from Virtuous gifts
tagged to the appeal campaign (default "2026 Fall Appeal").

Scope (Virtuous-only, per Advancement): executive summary, gift-size breakdown,
donor segmentation, geography, weekly campaign timeline, and a year-over-year
point-in-time (pace) comparison against a prior appeal campaign. Deliberately
OUT of scope (data lives outside Virtuous): direct-mail volume / deliverability
/ QR scans, email open/click/unsubscribe, website + digital-source analytics,
and any rate needing a solicited-audience denominator (response / conversion
rate). Cost-derived metrics (ROI, cost-to-raise-a-dollar, net revenue) and the
Annual Fund goal are omitted (no source in Virtuous).

Segmentation is computed with one gift query per segment (Campaign Name Is X AND
Contact Tag Is[Any|None]Of [...]) so it scales with the number of segments, not
the number of donors. Geography needs each donor's state (not a gift field), so
it does a bounded per-donor Contact fetch. Current-Donor / LYBUNT / SYBUNT are
deferred: they have no maintained tag, need multi-year fiscal giving history,
and are most meaningful against the solicited audience (see the dropped rates).
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
from typing import Any

GIFT_QUERY_PATH = "/api/Gift/Query"
CONTACT_PATH = "/api/Contact"
RETRYABLE = {429, 500, 502, 503, 504}
# Virtuous campaign 49 window (used when no gifts have posted yet).
DEFAULT_CAMPAIGN_START = dt.date(2026, 8, 16)
DEFAULT_CAMPAIGN_END = dt.date(2027, 2, 28)

# ── segment definitions ──────────────────────────────────────────────────────
# Constituency segments (non-exclusive; a donor may carry several). "Friends" is
# the residual: appeal donors carrying none of the constituency tags.
CONSTITUENCY_TAGS = {
    "alumni": ["Alumni"],
    "parents": ["Parent"],
    "faculty_staff": ["Staff/Faculty"],
}
CONSTITUENCY_LABELS = {
    "alumni": "Alumni",
    "parents": "Parents",
    "faculty_staff": "Faculty/Staff",
    "friends": "Friends",
}
# Donor-type segments (maintained Prospect-Pipeline tags).
DONOR_TYPE_TAGS = {
    "first_time": (["First-time Donor"], "First-Time Donor"),
    "major": (["Major Donor", "Large Giver"], "Major Donor"),
    "monthly": (["Recurring Giver", "Sustaining Donor"], "Monthly Donor"),
    "lapsed": (["Lapsed Donor"], "Lapsed Donor"),
}
# Segments named in the spec that we cannot compute from tags yet.
DEFERRED_SEGMENTS = ["Current Donor", "LYBUNT", "SYBUNT"]

# Gift-size bands (lower bound inclusive, upper bound inclusive) for the breakdown.
GIFT_BANDS = [
    # Lowest band's lower bound is -inf so reversals/refunds (negative gifts) and
    # $0 gifts land here and the breakdown reconciles to total net revenue.
    ("lt100", "Under $100", float("-inf"), 99.9999),
    ("100_249", "$100–249", 100.0, 249.9999),
    ("250_499", "$250–499", 250.0, 499.9999),
    ("500_999", "$500–999", 500.0, 999.9999),
    ("1000_2499", "$1,000–2,499", 1000.0, 2499.9999),
    ("2500_4999", "$2,500–4,999", 2500.0, 4999.9999),
    ("5000_plus", "$5,000+", 5000.0, float("inf")),
]


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get(self, path: str) -> Any:
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"},
            method="GET",
        )
        for attempt in range(6):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code in RETRYABLE and attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                raise
        raise RuntimeError(f"Virtuous GET {path} failed after retries")

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


# ── gift normalization ───────────────────────────────────────────────────────

def _campaign_condition(campaign: str) -> dict[str, Any]:
    return {"parameter": "Campaign Name", "operator": "Is", "value": campaign}


def normalize_gifts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Project raw gift rows to {contactId, amount, date, segment}, dropping rows
    without a usable amount+date."""
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


# ── core aggregations (pure — validated offline) ─────────────────────────────

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
    """Cumulative revenue + gifts bucketed by ISO week (week starting Monday)."""
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
            "label": wk.strftime("%b %-d"),
            "revenue": round(by_week_rev.get(wk, 0.0), 2),
            "gifts": by_week_cnt.get(wk, 0),
            "cumRevenue": round(cum_rev, 2),
            "cumGifts": cum_cnt,
            "overlays": [m for m in overlay_by_week.get(wk, []) if m],
        })
        wk += dt.timedelta(days=7)
    return out


def mail_segments(gifts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Revenue/gifts by the gift's acquisition segment (the appeal's sub-asks)."""
    rev: dict[str, float] = defaultdict(float)
    cnt: dict[str, int] = defaultdict(int)
    for g in gifts:
        seg = g["segment"] or "Unattributed"
        rev[seg] += g["amount"]
        cnt[seg] += 1
    out = [
        {
            "segment": seg,
            "revenue": round(rev[seg], 2),
            "gifts": cnt[seg],
            "avgGift": round(rev[seg] / cnt[seg], 2) if cnt[seg] else 0.0,
        }
        for seg in rev
    ]
    out.sort(key=lambda s: s["revenue"], reverse=True)
    return out


def pace_series(
    current: list[dict[str, Any]],
    prior: list[dict[str, Any]],
    current_start: dt.date | None,
    prior_start: dt.date | None,
    as_of_offset: int | None,
) -> dict[str, Any]:
    """Point-in-time YoY pace: cumulative revenue/gifts by day-offset from each
    appeal's own start. ``as_of_offset`` (days elapsed in the current appeal)
    marks where the prior appeal stood at the equivalent point."""

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


# ── segmentation (one gift query per segment) ────────────────────────────────

def _segment_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    amounts = [_parse_money(r.get("amount")) for r in rows]
    total = round(sum(amounts), 2)
    n = len(amounts)
    return {
        "revenue": total,
        "gifts": n,
        "avgGift": round(total / n, 2) if n else 0.0,
        "donors": len({r.get("contactId") for r in rows if r.get("contactId") is not None}),
    }


def build_segments(client: VirtuousClient, campaign: str, page_size: int) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    campaign_cond = _campaign_condition(campaign)

    def query_tags(tags: list[str], any_of: bool) -> list[dict[str, Any]]:
        op = "IsAnyOf" if any_of else "IsNoneOf"
        body = {"groups": [{"conditions": [
            campaign_cond,
            {"parameter": "Contact Tag", "operator": op, "values": tags},
        ]}]}
        return client.paged_query(GIFT_QUERY_PATH, body, page_size)

    all_constituency = [t for tags in CONSTITUENCY_TAGS.values() for t in tags]
    for key, tags in CONSTITUENCY_TAGS.items():
        stats = _segment_stats(query_tags(tags, any_of=True))
        segments.append({"key": key, "label": CONSTITUENCY_LABELS[key], "group": "constituency", **stats})
    # Friends = appeal donors carrying none of the constituency tags.
    friends = _segment_stats(query_tags(all_constituency, any_of=False))
    segments.append({"key": "friends", "label": CONSTITUENCY_LABELS["friends"], "group": "constituency", **friends})

    for key, (tags, label) in DONOR_TYPE_TAGS.items():
        stats = _segment_stats(query_tags(tags, any_of=True))
        segments.append({"key": key, "label": label, "group": "donorType", **stats})

    return segments


# ── geography (bounded per-donor fetch) ──────────────────────────────────────

def build_geography(
    client: VirtuousClient, gifts: list[dict[str, Any]], enabled: bool, max_donors: int, top_n: int
) -> dict[str, Any]:
    donor_ids = sorted({g["contactId"] for g in gifts if g["contactId"] is not None})
    total_donors = len(donor_ids)
    if not enabled or total_donors == 0:
        return {"topStates": [], "donorsGeocoded": 0, "donorsTotal": total_donors, "partial": False}

    truncated = total_donors > max_donors
    donor_ids = donor_ids[:max_donors]
    state_by_donor: dict[Any, str] = {}
    for cid in donor_ids:
        try:
            c = client.get(f"{CONTACT_PATH}/{cid}")
        except Exception as exc:  # noqa: BLE001 - skip unreadable contacts, geo degrades gracefully
            print(f"  geo: contact {cid} fetch failed: {exc}", flush=True)
            continue
        st = ((c.get("address") or {}).get("state") or "").strip()
        if st:
            state_by_donor[cid] = st

    rev: dict[str, float] = defaultdict(float)
    cnt: dict[str, int] = defaultdict(int)
    donors: dict[str, set] = defaultdict(set)
    for g in gifts:
        st = state_by_donor.get(g["contactId"])
        if not st:
            continue
        rev[st] += g["amount"]
        cnt[st] += 1
        donors[st].add(g["contactId"])
    states = [
        {
            "state": st,
            "revenue": round(rev[st], 2),
            "gifts": cnt[st],
            "donors": len(donors[st]),
            "avgGift": round(rev[st] / cnt[st], 2) if cnt[st] else 0.0,
        }
        for st in rev
    ]
    states.sort(key=lambda s: s["revenue"], reverse=True)
    return {
        "topStates": states[:top_n],
        "donorsGeocoded": len(state_by_donor),
        "donorsTotal": total_donors,
        "partial": truncated or len(state_by_donor) < len(donor_ids),
    }


# ── entrypoint ───────────────────────────────────────────────────────────────

def _env_start(name: str) -> dt.date | None:
    v = (os.environ.get(name) or "").strip()
    return _parse_md(v) if v else None


def _load_overlays() -> list[dict[str, Any]]:
    raw = (os.environ.get("FALL_APPEAL_OVERLAYS") or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return [o for o in data if isinstance(o, dict)]
    except (ValueError, TypeError):
        print("  FALL_APPEAL_OVERLAYS is not valid JSON — ignoring", flush=True)
        return []


def build_payload(
    client: VirtuousClient,
    campaign: str,
    prior_campaign: str,
    page_size: int,
    today: dt.date,
    *,
    geo_enabled: bool = True,
    geo_max: int = 5000,
    top_states: int = 10,
) -> dict[str, Any]:
    raw_gifts = client.paged_query(GIFT_QUERY_PATH, {"groups": [{"conditions": [_campaign_condition(campaign)]}]}, page_size)
    gifts = normalize_gifts(raw_gifts)
    print(f"  {campaign}: {len(gifts)} gifts", flush=True)

    overlays = _load_overlays()
    summary = summarize(gifts)
    appeal_start = (
        _env_start("FALL_APPEAL_START")
        or (min(g["date"] for g in gifts) if gifts else None)
        or DEFAULT_CAMPAIGN_START
    )
    appeal_end = _env_start("FALL_APPEAL_END") or DEFAULT_CAMPAIGN_END

    yoy: dict[str, Any] | None = None
    if prior_campaign:
        raw_prior = client.paged_query(
            GIFT_QUERY_PATH, {"groups": [{"conditions": [_campaign_condition(prior_campaign)]}]}, page_size
        )
        prior = normalize_gifts(raw_prior)
        print(f"  {prior_campaign} (prior): {len(prior)} gifts", flush=True)
        prior_start = _env_start("FALL_APPEAL_PRIOR_START") or (min(g["date"] for g in prior) if prior else None)
        as_of_offset = (today - appeal_start).days if appeal_start else 0
        pace = pace_series(gifts, prior, appeal_start, prior_start, as_of_offset)
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
        "appealStart": appeal_start.isoformat() if appeal_start else None,
        "campaignStart": appeal_start.isoformat() if appeal_start else None,
        "campaignEnd": appeal_end.isoformat() if appeal_end else None,
        "empty": not gifts,
        "summary": summary,
        "yoy": yoy,
        "giftBreakdown": gift_breakdown(gifts),
        "segments": build_segments(client, campaign, page_size),
        "deferredSegments": DEFERRED_SEGMENTS,
        "geography": build_geography(client, gifts, geo_enabled, geo_max, top_states),
        "timeline": weekly_timeline(gifts, overlays),
        "mailSegments": mail_segments(gifts),
        "overlays": overlays,
    }


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    api_key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("VIRTUOUS_API_KEY required")
    base = os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com"
    campaign = os.environ.get("FALL_APPEAL_CAMPAIGN", "2026 Fall Appeal")
    prior_campaign = (os.environ.get("FALL_APPEAL_PRIOR_CAMPAIGN") or "").strip()
    key = os.environ.get("FALL_APPEAL_CACHE_KEY") or "fall-appeal/latest.json"
    page_size = int(os.environ.get("PAGE_SIZE", "1000"))
    geo_enabled = (os.environ.get("FALL_APPEAL_GEO", "1")).strip() not in {"0", "false", "False", ""}
    geo_max = int(os.environ.get("FALL_APPEAL_GEO_MAX", "5000"))

    client = VirtuousClient(api_key, base)
    print(f"Building Fall Appeal report for campaign '{campaign}'...", flush=True)
    payload = build_payload(
        client,
        campaign,
        prior_campaign,
        page_size,
        dt.date.today(),
        geo_enabled=geo_enabled,
        geo_max=geo_max,
    )
    from common.s3util import put_json

    uri = put_json(key, payload)
    payload["cache"] = uri
    print(f"  put {uri}", flush=True)
    return payload
