"""FY Advancement Overview publisher (Virtuous source).

Reads Virtuous directly and writes ``advancement-overview/latest.json`` for
reporting.avemaria.edu/advancement/overview. The definitions follow the Qlik
"FY Advancement Overview" load script and KPI measures, with two corrections
Advancement asked for:

* Class bars (endowed / temporary restricted / unrestricted) split each gift
  across its designations in proportion to ``amountDesignated`` instead of
  summing the full gift ``amount`` once per designation status. Split gifts no
  longer double count, and gifts to funds missing from the classification
  table land in ``unassigned`` instead of vanishing. The four buckets always
  add up to the total.
* A gift is credited to exactly one MGO (the Qlik join can credit a gift to
  every MGO portfolio the donor sits in).

Dry run (no S3 write): ``python3 handler.py --dry-run``.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Iterable

FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
ASK_PATH = "/api/GiftAsk/Query"
PLEDGE_PATH_V2 = "/api/v2/Pledge/Query"
PLANNED_PATH = "/api/PlannedGift/Query"
GROUP_PATH = "/api/OrganizationGroup"

CACHE_KEY = os.environ.get("ADVANCEMENT_OVERVIEW_CACHE_KEY") or "advancement-overview/latest.json"
RETRYABLE = {429, 500, 502, 503, 504}
FULL_GIFT_PAGE = 500

PLEDGE_GOAL = 30
ESTATE_GOAL = 25
RELEASED_NOTE = "Actuals Updated 7/1/2026"

# Qlik [Gift MGO Last] team list (ytd_mgo_* and officers measures).
MGO_TEAM = ["Middendorf", "Dolnick", "Thomas", "O'Connell", "Emond", "Buzzanca", "Luzarraga", "Sanford"]
UNASSIGNED_MGO = "Unassigned"

PIPELINE_EXCLUDE = {
    "Declined (MGO)",
    "Gift Received (Adv Svcs)",
    "Prospect Research Review (Adv Svcs)",
}
# Qlik pipeline table sort: Match(Trim(status), ...). Compared whitespace-folded.
PIPELINE_ORDER = [
    "Cultivation / Gift Ask Strategy (MGO)",
    "Preparing Proposal / Agreement (MGO)",
    "Solicitation / Ask (MGO)",
    "Pending (MGO)",
    "Accepted (MGO)",
    "Pending Installment / Annual Gift (MGO)",
]

STATUS_BUCKETS = {
    "Endowed": "endowed",
    "Temporary Restricted": "temporaryRestricted",
    "Unrestricted": "unrestricted",
}
BUCKETS = ["endowed", "temporaryRestricted", "unrestricted", "unassigned"]
CENT = Decimal("0.01")

FUND_STATUS_FILE = "fund_status.csv"


def log(message: str) -> None:
    # stderr so ``--dry-run`` stdout stays clean JSON.
    print(message, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Virtuous client
# --------------------------------------------------------------------------


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 180):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.requests = 0

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
            self.requests += 1
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code in RETRYABLE and attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                detail = exc.read().decode("utf-8", errors="replace")[:500]
                raise RuntimeError(f"Virtuous {path} -> {exc.code}: {detail}") from exc
            except (TimeoutError, urllib.error.URLError) as exc:
                if attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                raise RuntimeError(f"Virtuous {path} timed out after retries: {exc}") from exc
        raise RuntimeError(f"Virtuous {path} failed after retries")


# --------------------------------------------------------------------------
# Parsing helpers
# --------------------------------------------------------------------------


def _money(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    text = str(value).replace("$", "").replace(",", "").strip()
    try:
        return Decimal(text)
    except Exception:  # noqa: BLE001
        return Decimal("0")


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


def _gift_date(gift: dict[str, Any]) -> dt.date | None:
    return _parse_date(gift.get("giftDate") or gift.get("giftDateFormatted"))


def _custom(record: dict[str, Any], name: str) -> str | None:
    for field in record.get("customFields") or []:
        if field.get("name") == name:
            value = field.get("value")
            text = str(value).strip() if value is not None else ""
            return text or None
    return None


def _fold_ws(value: Any) -> str:
    return " ".join(str(value or "").split())


def _to_float(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


# --------------------------------------------------------------------------
# Fiscal year windows
# --------------------------------------------------------------------------


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


def ytd_windows(today: dt.date) -> dict[str, Any]:
    """Current = FY start..today. Prior = prior FY start..same day last year. Inclusive."""
    fy, start, end = fiscal_year_window(today)
    return {
        "fy": fy,
        "fyStart": start,
        "fyEnd": end,
        "current": (start, today),
        "prior": (shift_years(start, -1), shift_years(today, -1)),
    }


def in_window(day: dt.date | None, window: tuple[dt.date, dt.date]) -> bool:
    return day is not None and window[0] <= day <= window[1]


# --------------------------------------------------------------------------
# Fund classification (Qlik load script INLINE [Table])
# --------------------------------------------------------------------------


def fund_id_from_code(code: Any) -> str | None:
    """Qlik ``Mid(externalAccountingCode, 5, 4)``: 1-based chars 5-8."""
    text = str(code or "").strip()
    if len(text) < 5:
        return None
    fund = text[4:8].strip()
    return fund or None


def load_fund_rows(path: Path | None = None) -> list[dict[str, str]]:
    candidates = []
    env = (os.environ.get("ADVANCEMENT_FUND_STATUS_CSV") or "").strip()
    if path is not None:
        candidates.append(path)
    if env:
        candidates.append(Path(env))
    here = Path(__file__).resolve().parent
    candidates.extend([here / FUND_STATUS_FILE, Path("/var/task") / FUND_STATUS_FILE])
    for candidate in candidates:
        if candidate.is_file():
            with candidate.open(newline="", encoding="utf-8") as fh:
                rows = [
                    {k: (v or "").strip() for k, v in row.items()}
                    for row in csv.DictReader(fh)
                ]
            if not rows:
                raise RuntimeError(f"{candidate} has no fund rows")
            return rows
    tried = ", ".join(str(c) for c in candidates)
    # Never fall back to "everything unassigned": fail the run loudly.
    raise FileNotFoundError(f"{FUND_STATUS_FILE} not found (tried {tried})")


def build_fund_map(rows: Iterable[dict[str, str]]) -> tuple[dict[str, dict[str, str]], list[dict[str, Any]]]:
    """fund id -> row, plus the list of fund ids whose rows disagree on status.

    The Qlik INLINE table lists a few fund ids twice. When the duplicate rows
    disagree on status, the row with a non-empty category wins. Today that is
    only 6404 Library, listed as both "Temp - Program Support / Temporary
    Restricted" and "(no category) / Unrestricted"; we use Temporary Restricted
    and publish the conflict in ``conflictingFunds`` so Advancement can decide.
    """
    by_id: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        fid = (row.get("fund_id") or "").strip()
        if fid:
            by_id[fid].append(row)
    fund_map: dict[str, dict[str, str]] = {}
    conflicts: list[dict[str, Any]] = []
    for fid, dupes in by_id.items():
        statuses = sorted({d.get("status") or "" for d in dupes})
        if len(statuses) > 1:
            chosen = next((d for d in dupes if d.get("category")), dupes[0])
            conflicts.append({
                "fundId": fid,
                "description": chosen.get("description") or "",
                "statuses": statuses,
                "used": chosen.get("status") or "",
            })
        else:
            chosen = next((d for d in dupes if d.get("category")), dupes[0])
        fund_map[fid] = chosen
    conflicts.sort(key=lambda c: c["fundId"])
    return fund_map, conflicts


def bucket_for_fund(fund_id: str | None, fund_map: dict[str, dict[str, str]]) -> str:
    if not fund_id:
        return "unassigned"
    row = fund_map.get(fund_id)
    if not row:
        return "unassigned"
    return STATUS_BUCKETS.get(row.get("status") or "", "unassigned")


# --------------------------------------------------------------------------
# Received: designation-allocated class buckets
# --------------------------------------------------------------------------


def allocate_gift(
    gift: dict[str, Any],
    fund_map: dict[str, dict[str, str]],
) -> list[tuple[str, str | None, str, Decimal]]:
    """Split one gift into (bucket, fundId, description, exact share) parts.

    share = amount * amountDesignated / sum(amountDesignated). No designations,
    or designations summing to 0, put the whole amount in ``unassigned``.
    """
    amount = _money(gift.get("amount"))
    designations = gift.get("giftDesignations") or []
    weights = [(d, _money(d.get("amountDesignated"))) for d in designations]
    denom = sum((w for _d, w in weights), Decimal("0"))
    if not weights or denom == 0:
        return [("unassigned", None, "(no designation)", amount)]
    parts = []
    for designation, weight in weights:
        fid = fund_id_from_code(designation.get("externalAccountingCode"))
        bucket = bucket_for_fund(fid, fund_map)
        description = _fold_ws(designation.get("project")) or "(no project)"
        parts.append((bucket, fid, description, amount * weight / denom))
    return parts


def received_breakdown(
    gifts: Iterable[dict[str, Any]],
    fund_map: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Totals for the gifts passed in (caller filters to the current window).

    Buckets are accumulated unrounded, rounded once, and any residual cent(s)
    go to the largest bucket so the four buckets equal the total exactly.
    """
    exact = {b: Decimal("0") for b in BUCKETS}
    total = Decimal("0")
    unassigned_funds: dict[tuple[str | None, str], Decimal] = defaultdict(lambda: Decimal("0"))
    gift_count = 0
    split_gifts = 0
    undesignated = 0
    for gift in gifts:
        gift_count += 1
        total += _money(gift.get("amount"))
        parts = allocate_gift(gift, fund_map)
        if len(parts) > 1:
            split_gifts += 1
        if parts and parts[0][1] is None and parts[0][2] == "(no designation)":
            undesignated += 1
        for bucket, fid, description, share in parts:
            exact[bucket] += share
            if bucket == "unassigned":
                unassigned_funds[(fid, description)] += share

    total_c = total.quantize(CENT, rounding=ROUND_HALF_UP)
    rounded = {b: exact[b].quantize(CENT, rounding=ROUND_HALF_UP) for b in BUCKETS}
    residual = total_c - sum(rounded.values(), Decimal("0"))
    if residual:
        largest = max(BUCKETS, key=lambda b: (abs(rounded[b]), -BUCKETS.index(b)))
        rounded[largest] += residual

    funds = [
        {
            "fundId": fid,
            "description": description,
            "amount": _to_float(amount),
        }
        for (fid, description), amount in unassigned_funds.items()
    ]
    funds.sort(key=lambda f: (-f["amount"], f["fundId"] or "", f["description"]))
    return {
        "decimal": {**rounded, "total": total_c},
        "endowed": float(rounded["endowed"]),
        "temporaryRestricted": float(rounded["temporaryRestricted"]),
        "unrestricted": float(rounded["unrestricted"]),
        "unassigned": float(rounded["unassigned"]),
        "total": float(total_c),
        "unassignedFunds": funds,
        "method": "designation-allocated",
        "giftCount": gift_count,
        "splitGiftCount": split_gifts,
        "undesignatedGiftCount": undesignated,
    }


# --------------------------------------------------------------------------
# MGO attribution (Qlik load script tab "MGO Gift")
# --------------------------------------------------------------------------


def _norm_apostrophe(value: str) -> str:
    return value.replace("’", "'").replace("‘", "'")


def _norm_group(name: str) -> str:
    return " ".join((name or "").replace("\u2013", "-").replace("\u2014", "-").split())


def is_mgo_portfolio(name: str) -> bool:
    """Same rule as the mgo-top-prospects publisher: "Portfolio - First Last",
    not "MA Portfolio - ..."."""
    n = _norm_group(name).lower()
    if n.startswith("ma portfolio"):
        return False
    return n.startswith("portfolio -")


def group_mgo_last(name: str) -> str | None:
    """Qlik: MGO Assigned = text after '- '; MGO Last = its last word."""
    n = _norm_apostrophe(_norm_group(name))
    idx = n.find("- ")
    if idx < 0:
        return None
    assigned = n[idx + 2 :].strip()
    if not assigned:
        return None
    return assigned.split(" ")[-1]


def solicitor_last(value: str | None) -> str | None:
    """Qlik ``[value last]``: text after the last space of GFT_Solicitor."""
    text = _norm_apostrophe(" ".join((value or "").split()))
    if not text:
        return None
    return text.split(" ")[-1]


def contact_mgo_map(members: Iterable[dict[str, Any]]) -> dict[str, str]:
    """contactId -> MGO last name. A contact in several MGO portfolios is
    credited to the alphabetically first portfolio group name, so each gift is
    counted once."""
    groups_by_contact: dict[str, set[str]] = defaultdict(set)
    for m in members:
        cid = m.get("contactId")
        name = m.get("organizationGroupName") or ""
        if cid is None or not is_mgo_portfolio(name):
            continue
        groups_by_contact[str(cid)].add(_norm_group(name))
    out: dict[str, str] = {}
    for cid, names in groups_by_contact.items():
        for name in sorted(names):
            last = group_mgo_last(name)
            if last:
                out[cid] = last
                break
    return out


def gift_mgo_last(gift: dict[str, Any], contact_mgo: dict[str, str]) -> str:
    """Solicitor last name wins; else the donor's portfolio MGO; else Unassigned."""
    solicitor = solicitor_last(_custom(gift, "GFT_Solicitor"))
    if solicitor:
        return solicitor
    cid = gift.get("contactId")
    if cid is not None and str(cid) in contact_mgo:
        return contact_mgo[str(cid)]
    return UNASSIGNED_MGO


# --------------------------------------------------------------------------
# Pledges / estate / pipeline
# --------------------------------------------------------------------------


def count_multi_year_pledges(pledges: Iterable[dict[str, Any]], fy_start: dt.date) -> int:
    """Qlik: count(pledgeDate) with pledgeDate >= FY start and frequency Annually."""
    n = 0
    for pledge in pledges:
        day = _parse_date(pledge.get("pledgeDate"))
        if day is None or day < fy_start:
            continue
        if _fold_ws(pledge.get("frequency")) != "Annually":
            continue
        n += 1
    return n


def count_realized_estate(gifts: Iterable[dict[str, Any]]) -> int:
    """Distinct contacts whose gift segment is Realized Bequest (gifts pre-filtered to the window)."""
    contacts = set()
    for gift in gifts:
        if _fold_ws(gift.get("segment")) != "Realized Bequest":
            continue
        cid = gift.get("contactId")
        if cid is not None:
            contacts.add(str(cid))
    return len(contacts)


def count_planned_estate(planned: Iterable[dict[str, Any]], fy_start: dt.date) -> int:
    n = 0
    for row in planned:
        day = _parse_date(row.get("plannedGiftDate"))
        if day is None or day < fy_start:
            continue
        # Virtuous docs spell the field "pkannedGiftType"; read both.
        gift_type = _fold_ws(row.get("plannedGiftType") or row.get("pkannedGiftType"))
        if gift_type != "WillAndBequest":
            continue
        n += 1
    return n


def _pipeline_rank(status: str) -> int:
    folded = _fold_ws(status)
    for idx, name in enumerate(PIPELINE_ORDER):
        if folded == _fold_ws(name):
            return idx
    return len(PIPELINE_ORDER)


def pipeline_rows(
    asks: Iterable[dict[str, Any]],
    fy_start: dt.date,
    fy_end: dt.date,
) -> tuple[list[dict[str, Any]], float, int]:
    grouped: dict[str, dict[str, Any]] = {}
    for ask in asks:
        status = str(ask.get("status") or "").strip()
        if not status or _fold_ws(status) in {_fold_ws(s) for s in PIPELINE_EXCLUDE}:
            continue
        expected = _parse_date(
            ask.get("expectedFulfillmentDate") or ask.get("expectedFulfillmentDateFormatted")
        )
        if expected is None or expected < fy_start or expected > fy_end:
            continue
        row = grouped.setdefault(status, {"amount": Decimal("0"), "count": 0})
        raw_amount = ask.get("askAmount")
        row["amount"] += _money(raw_amount)
        # Qlik Count(askAmount) skips null amounts.
        if raw_amount is not None and raw_amount != "":
            row["count"] += 1
    ordered = sorted(grouped.items(), key=lambda item: (_pipeline_rank(item[0]), item[0]))
    rows = [
        {"status": status, "amount": _to_float(row["amount"]), "count": row["count"]}
        for status, row in ordered
    ]
    total_amount = _to_float(sum((row["amount"] for row in grouped.values()), Decimal("0")))
    total_count = sum(row["count"] for row in grouped.values())
    return rows, total_amount, total_count


# --------------------------------------------------------------------------
# Snapshot
# --------------------------------------------------------------------------


def _ytd_row(current: Decimal | int, prior: Decimal | int, *, money: bool) -> dict[str, Any]:
    diff = current - prior
    pct = round(100.0 * float(diff) / float(prior), 1) if prior else None
    if money:
        return {
            "current": _to_float(Decimal(current)),
            "prior": _to_float(Decimal(prior)),
            "difference": _to_float(Decimal(diff)),
            "pct": pct,
        }
    return {"current": int(current), "prior": int(prior), "difference": int(diff), "pct": pct}


def dedupe_gifts(gifts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out = []
    for gift in gifts:
        gid = gift.get("id")
        key = str(gid) if gid is not None else json.dumps(gift, sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        out.append(gift)
    return out


def assemble_snapshot(
    *,
    today: dt.date,
    generated_at: str,
    gifts: list[dict[str, Any]],
    members: list[dict[str, Any]],
    pledges: list[dict[str, Any]],
    planned: list[dict[str, Any]],
    asks: list[dict[str, Any]],
    fund_rows: list[dict[str, str]],
) -> dict[str, Any]:
    win = ytd_windows(today)
    fy = win["fy"]
    fy_start: dt.date = win["fyStart"]
    fy_end: dt.date = win["fyEnd"]
    fund_map, conflicts = build_fund_map(fund_rows)
    contact_mgo = contact_mgo_map(members)
    team = set(MGO_TEAM)

    gifts = dedupe_gifts(gifts)
    current = [g for g in gifts if in_window(_gift_date(g), win["current"])]
    prior = [g for g in gifts if in_window(_gift_date(g), win["prior"])]

    received = received_breakdown(current, fund_map)
    received.pop("decimal")  # exact Decimal buckets; tests assert on them

    def total_of(rows: list[dict[str, Any]]) -> Decimal:
        return sum((_money(g.get("amount")) for g in rows), Decimal("0"))

    def donors_of(rows: list[dict[str, Any]]) -> int:
        return len({str(g.get("contactId")) for g in rows if g.get("contactId") is not None})

    by_officer: dict[str, Decimal] = {name: Decimal("0") for name in MGO_TEAM}
    mgo_current = Decimal("0")
    for gift in current:
        last = gift_mgo_last(gift, contact_mgo)
        if last in team:
            amount = _money(gift.get("amount"))
            by_officer[last] += amount
            mgo_current += amount
    mgo_prior = Decimal("0")
    for gift in prior:
        if gift_mgo_last(gift, contact_mgo) in team:
            mgo_prior += _money(gift.get("amount"))

    officer_list = sorted(by_officer.items(), key=lambda item: (-item[1], item[0]))
    officers = [
        {"name": "Totals", "amount": _to_float(mgo_current), "isTotal": True},
        *({"name": name, "amount": _to_float(amount)} for name, amount in officer_list),
    ]

    pipe_rows, pipe_amount, pipe_count = pipeline_rows(asks, fy_start, fy_end)

    snapshot = {
        "generated_at": generated_at,
        "source": "virtuous",
        "currentFiscalYear": fy,
        "fiscalYearLabel": fiscal_year_label(fy),
        "asOf": today.isoformat(),
        "windows": {
            "current": {"start": win["current"][0].isoformat(), "end": win["current"][1].isoformat()},
            "prior": {"start": win["prior"][0].isoformat(), "end": win["prior"][1].isoformat()},
            "fyEnd": fy_end.isoformat(),
        },
        "received": received,
        "conflictingFunds": conflicts,
        "released": {
            "fy26": None,
            "other": None,
            "total": 0,
            "note": RELEASED_NOTE,
        },
        "pledges": {
            "multiYear": count_multi_year_pledges(pledges, fy_start),
            "multiYearGoal": PLEDGE_GOAL,
            "realizedEstate": count_realized_estate(current),
            "realizedEstateGoal": ESTATE_GOAL,
            "plannedEstate": count_planned_estate(planned, fy_start),
        },
        "ytd": {
            "currentLabel": f"FY{fy}",
            "priorLabel": f"FY{fy - 1}",
            "overall": _ytd_row(total_of(current), total_of(prior), money=True),
            "mgoTeam": _ytd_row(mgo_current, mgo_prior, money=True),
            "activeDonors": _ytd_row(donors_of(current), donors_of(prior), money=False),
        },
        "officers": officers,
        "pipeline": {
            "rows": pipe_rows,
            "totalAmount": pipe_amount,
            "totalCount": pipe_count,
        },
    }
    log(
        f"  {snapshot['fiscalYearLabel']} total={received['total']} "
        f"endowed={received['endowed']} temp={received['temporaryRestricted']} "
        f"unrestricted={received['unrestricted']} unassigned={received['unassigned']} "
        f"split={received['splitGiftCount']} pledges={snapshot['pledges']['multiYear']} "
        f"pipeline={pipe_count}"
    )
    return snapshot


# --------------------------------------------------------------------------
# Fetch
# --------------------------------------------------------------------------


def gift_window_query(windows: list[tuple[dt.date, dt.date]]) -> dict[str, Any]:
    """One OR-group per window: Gift Date between start and end, inclusive."""
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Gift Date", "operator": "OnOrAfter", "value": start.isoformat()},
                    {"parameter": "Gift Date", "operator": "OnOrBefore", "value": end.isoformat()},
                ]
            }
            for start, end in windows
        ],
        "sortBy": "Id",
        "descending": False,
    }


def fetch_inputs(client: VirtuousClient, today: dt.date) -> dict[str, Any]:
    win = ytd_windows(today)
    log(
        f"  fetching full gifts {win['prior'][0]}..{win['prior'][1]} and "
        f"{win['current'][0]}..{win['current'][1]}"
    )
    gifts = client.paged_query(
        FULL_GIFT_PATH,
        gift_window_query([win["prior"], win["current"]]),
        FULL_GIFT_PAGE,
    )
    log(f"  gifts: {len(gifts)}")

    groups = [g for g in client.paged_get(GROUP_PATH, 1000) if is_mgo_portfolio(g.get("name") or "")]
    members: list[dict[str, Any]] = []
    for group in groups:
        gid = group.get("id")
        if gid is None:
            continue
        rows = client.paged_get(f"{GROUP_PATH}/{gid}/contacts", 1000)
        for row in rows:
            row.setdefault("organizationGroupName", group.get("name"))
        members.extend(rows)
    log(f"  MGO portfolios: {len(groups)}, members: {len(members)}")

    pledges = client.paged_query(PLEDGE_PATH_V2, {"groups": []}, 1000)
    log(f"  pledges: {len(pledges)}")
    planned = client.paged_query(PLANNED_PATH, {"groups": []}, 1000)
    log(f"  planned gifts: {len(planned)}")
    asks = client.paged_query(ASK_PATH, {"groups": []}, 1000)
    log(f"  gift asks: {len(asks)}")
    return {"gifts": gifts, "members": members, "pledges": pledges, "planned": planned, "asks": asks}


def build_snapshot(client: VirtuousClient, today: dt.date) -> dict[str, Any]:
    fund_rows = load_fund_rows()
    inputs = fetch_inputs(client, today)
    generated_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    snapshot = assemble_snapshot(today=today, generated_at=generated_at, fund_rows=fund_rows, **inputs)
    log(f"  Virtuous requests: {client.requests}")
    return snapshot


def resolve_api_key() -> str:
    key = (os.environ.get("VIRTUOUS_API_KEY") or "").strip()
    if key:
        return key
    raw = (os.environ.get("SST_RESOURCE_VirtuousApiKey") or "").strip()
    if raw:
        try:
            value = json.loads(raw).get("value")
        except (ValueError, AttributeError):
            value = None
        if value:
            return str(value).strip()
    raise RuntimeError("VIRTUOUS_API_KEY is required")


def make_client() -> VirtuousClient:
    return VirtuousClient(
        resolve_api_key(),
        os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com",
    )


def today_eastern() -> dt.date:
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # noqa: BLE001
        return dt.datetime.now(dt.timezone.utc).date()


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    snapshot = build_snapshot(make_client(), today_eastern())
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot


def main(argv: list[str]) -> int:
    if "--dry-run" not in argv:
        print("usage: python3 handler.py --dry-run", file=sys.stderr)
        return 2
    snapshot = build_snapshot(make_client(), today_eastern())
    json.dump(snapshot, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
