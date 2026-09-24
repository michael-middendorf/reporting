"""Per-sport athletics coaching fundraising publisher.

Writes ``athletics-coaching-fundraising/latest.json`` with FYTD and all-time
totals per catalog sport plus a ``gifts`` list (donorName, amount, giftDate,
fytd). Amounts are GiftDesignation ``amountDesignated`` for this sport fund.
Names come from FullGift (Project Code), else designation contactName, else
Anonymous. Donors whose contact carries the Virtuous tag "Anonymous Donor" are
always Anonymous; if that tag lookup fails or comes back empty, every name is
Anonymous (fail closed). No emails or contact IDs.

Do not read ``sources/virtuous/gifts`` (365-day window, incomplete projectCode).
Sport codes come from ``apps/web-next/src/lib/reports/athletics-coaching/sports.ts``.
Never include Athletics General 6117AthGEN or Gyrene Booster 6644.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

CACHE_KEY = (
    os.environ.get("ATHLETICS_COACHING_FUNDRAISING_CACHE_KEY")
    or "athletics-coaching-fundraising/latest.json"
)
RETRYABLE = {429, 500, 502, 503, 504}
FORBIDDEN_CODES = frozenset({"6117AthGEN", "6644"})
GIFT_DESIGNATION_QUERY_PATH = "/api/GiftDesignation/Query"
FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
PROJECT_BY_CODE_PATH = "/api/Project/Code"
CONTACT_QUERY_PATH = "/api/Contact/Query"
# Virtuous CRM gifts carry no anonymity flag; Advancement marks anonymous
# donors with this contact tag.
ANONYMOUS_DONOR_TAG = "Anonymous Donor"

_SPORT_BLOCK = re.compile(
    r'\{\s*key:\s*"([^"]+)"[\s\S]*?virtuousProjectCode:\s*(null|"[^"]+")',
    re.M,
)


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        for attempt in range(6):
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Accept": "application/json",
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    return None
                if exc.code in RETRYABLE and attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                detail = exc.read().decode("utf-8", errors="replace")[:200]
                raise RuntimeError(f"Virtuous GET {path} → {exc.code}: {detail}") from exc
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


def parse_count(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


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


def _norm_gift_id(value: Any) -> Any:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _gift_id(row: dict[str, Any]) -> Any:
    if row.get("giftId") is not None and row.get("giftId") != "":
        return _norm_gift_id(row.get("giftId"))
    if row.get("giftID") is not None and row.get("giftID") != "":
        return _norm_gift_id(row.get("giftID"))
    return _norm_gift_id(row.get("id"))


def _clean_name(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_anonymous(value: Any) -> bool:
    if value is True or value == 1:
        return True
    if isinstance(value, str) and value.strip().lower() in {"true", "yes", "1"}:
        return True
    return False


def _donor_name(gift: dict[str, Any]) -> str | None:
    passthroughs = gift.get("giftPassthroughs") or []
    if passthroughs:
        name = _clean_name(passthroughs[0].get("contactName"))
        if name:
            return name
    return _clean_name(gift.get("contactName"))


def _contact_ids(record: dict[str, Any]) -> set[str]:
    ids = {str(record["contactId"])} if record.get("contactId") is not None else set()
    for passthrough in record.get("giftPassthroughs") or []:
        if passthrough.get("contactId") is not None:
            ids.add(str(passthrough["contactId"]))
    return ids


def names_from_full_gifts(gifts: list[dict[str, Any]]) -> dict[Any, dict[str, Any]]:
    mapping: dict[Any, dict[str, Any]] = {}
    for gift in gifts:
        gid = _gift_id(gift)
        if gid is None:
            continue
        mapping[gid] = {
            "name": _donor_name(gift),
            "anonymous": _is_anonymous(gift.get("isAnonymous")),
            "contactIds": _contact_ids(gift),
        }
    return mapping


def anonymous_contact_ids(client: Any) -> frozenset[str] | None:
    """Contact IDs tagged ANONYMOUS_DONOR_TAG, or None when unknown.

    The tag is in use, so an empty result is treated as a failed lookup.
    """
    try:
        rows = client.paged_query(
            CONTACT_QUERY_PATH,
            {"groups": [{"conditions": [
                {"parameter": "Tag", "operator": "Is", "value": ANONYMOUS_DONOR_TAG},
            ]}]},
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  anonymous donor tag query failed: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
        return None
    ids = frozenset(str(r["id"]) for r in rows if r.get("id") is not None)
    if not ids:
        print("  anonymous donor tag query returned no contacts", flush=True)
        return None
    print(f"  anonymous donor contacts={len(ids)}", flush=True)
    return ids


def resolve_donor_name(
    designation: dict[str, Any],
    name_map: dict[Any, dict[str, Any]],
    anonymous_ids: frozenset[str] | None,
) -> str:
    if anonymous_ids is None:
        return "Anonymous"
    gid = _gift_id(designation)
    info = name_map.get(gid) if gid is not None else None
    contact_ids = _contact_ids(designation) | set((info or {}).get("contactIds") or ())
    if contact_ids & anonymous_ids:
        return "Anonymous"
    if info and info.get("anonymous"):
        return "Anonymous"
    if _is_anonymous(designation.get("isAnonymous")):
        return "Anonymous"
    if info:
        name = _clean_name(info.get("name"))
        if name:
            return name
    des_name = _clean_name(designation.get("contactName"))
    if des_name:
        return des_name
    return "Anonymous"


def gifts_from_designations(
    code: str,
    rows: list[dict[str, Any]],
    name_map: dict[Any, dict[str, Any]],
    fy_start: dt.date,
    fy_end: dt.date,
    *,
    anonymous_ids: frozenset[str] | None,
) -> list[dict[str, Any]]:
    """Build cache gift rows from designations joined to FullGift names.

    Amount is ``amountDesignated`` (split-safe). Dedupes by giftId + amount.
    Newest first. No emails or contact IDs.
    """
    seen: set[tuple[Any, float]] = set()
    gifts: list[dict[str, Any]] = []
    for row in rows:
        project_code = str(row.get("projectCode") or "").strip()
        if not project_code or project_code in FORBIDDEN_CODES or project_code != code:
            continue
        gift_day = parse_gift_date(row.get("giftDate") or row.get("giftDateFormatted"))
        if gift_day is None:
            continue
        amount = parse_money(row.get("amountDesignated"))
        amount = 0.0 if amount is None else round(amount, 2)
        gift_id = _gift_id(row)
        if gift_id is not None:
            key = (gift_id, amount)
            if key in seen:
                continue
            seen.add(key)
        gifts.append(
            {
                "donorName": resolve_donor_name(row, name_map, anonymous_ids),
                "amount": amount,
                "giftDate": gift_day.isoformat(),
                "fytd": fy_start <= gift_day <= fy_end,
            }
        )
    gifts.sort(key=lambda g: str(g.get("giftDate") or ""), reverse=True)
    return gifts


def all_time_from_project(project: dict[str, Any]) -> tuple[float | None, int | None]:
    """All-time $ and gift count from GET /api/Project/Code/{code}.

    Dollars: ``raisedAmount`` (specified). CRM Code payloads may instead expose
    ``lifeToDateGiving``; use that only when ``raisedAmount`` is absent.
    Gift count: ``giftAmount`` (Raise Project, number of gifts) or
    ``lifeToDateGiftCount`` (CRM Project-by-code). Caller counts designations
    with no date filter when both count fields are missing.
    """
    amount = parse_money(project.get("raisedAmount"))
    if amount is None:
        amount = parse_money(project.get("lifeToDateGiving"))
    count = parse_count(project.get("giftAmount"))
    if count is None:
        count = parse_count(project.get("lifeToDateGiftCount"))
    return amount, count


def fytd_from_designations(
    code: str,
    rows: list[dict[str, Any]],
    fy_start: dt.date,
    fy_end: dt.date,
) -> tuple[float, int]:
    """Sum ``amountDesignated`` for this project code in the FY window.

    Skips forbidden codes. Gift count is unique ``giftId`` when present,
    otherwise one per designation row.
    """
    total = 0.0
    gift_ids: set[Any] = set()
    anonymous = 0
    for row in rows:
        project_code = str(row.get("projectCode") or "").strip()
        if not project_code or project_code in FORBIDDEN_CODES or project_code != code:
            continue
        gift_day = parse_gift_date(row.get("giftDate") or row.get("giftDateFormatted"))
        if gift_day is None or gift_day < fy_start or gift_day > fy_end:
            continue
        amount = parse_money(row.get("amountDesignated"))
        total += 0.0 if amount is None else amount
        gift_id = row.get("giftId")
        if gift_id is None:
            gift_id = row.get("giftID")
        if gift_id is None:
            anonymous += 1
        else:
            gift_ids.add(gift_id)
    return round(total, 2), len(gift_ids) + anonymous


def unmapped_row(key: str, project_code: str | None = None) -> dict[str, Any]:
    return {
        "key": key,
        "projectCode": project_code,
        "mapped": False,
        "fytdAmount": None,
        "fytdGiftCount": None,
        "allTimeAmount": None,
        "allTimeGiftCount": None,
        "asOf": None,
        "reason": "unmapped",
        "gifts": [],
    }


def unavailable_row(key: str, project_code: str) -> dict[str, Any]:
    return {
        "key": key,
        "projectCode": project_code,
        "mapped": True,
        "fytdAmount": None,
        "fytdGiftCount": None,
        "allTimeAmount": None,
        "allTimeGiftCount": None,
        "asOf": None,
        "reason": "unavailable",
        "gifts": [],
    }


def mapped_row(
    key: str,
    project_code: str,
    *,
    fytd_amount: float,
    fytd_gift_count: int,
    all_time_amount: float | None,
    all_time_gift_count: int | None,
    as_of: str,
    gifts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "projectCode": project_code,
        "mapped": True,
        "fytdAmount": fytd_amount,
        "fytdGiftCount": fytd_gift_count,
        "allTimeAmount": all_time_amount,
        "allTimeGiftCount": all_time_gift_count,
        "asOf": as_of,
        "gifts": list(gifts or []),
    }


def parse_sports_catalog(text: str) -> list[dict[str, str | None]]:
    """Read key + virtuousProjectCode from sports.ts. Codes only; no edits."""
    start = text.find("export const SPORTS")
    end = text.find("export const sportByKey")
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError("sports.ts catalog markers not found")
    chunk = text[start:end]
    sports: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for match in _SPORT_BLOCK.finditer(chunk):
        key = match.group(1)
        raw = match.group(2)
        code = None if raw == "null" else raw.strip('"')
        if key in seen:
            continue
        seen.add(key)
        if code in FORBIDDEN_CODES:
            code = None
        sports.append({"key": key, "projectCode": code})
    if not sports:
        raise RuntimeError("sports.ts catalog parsed zero sports")
    return sports


def sports_catalog_candidates() -> list[Path]:
    env = (os.environ.get("ATHLETICS_COACHING_SPORTS_TS") or "").strip()
    here = Path(__file__).resolve().parent
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env))
    candidates.append(here / "sports.ts")
    candidates.append(Path("/var/task/sports.ts"))
    if len(here.parents) >= 2:
        candidates.append(
            here.parents[2] / "apps/web-next/src/lib/reports/athletics-coaching/sports.ts"
        )
    candidates.append(Path.cwd() / "apps/web-next/src/lib/reports/athletics-coaching/sports.ts")
    return candidates


def load_sports_catalog() -> list[dict[str, str | None]]:
    tried: list[str] = []
    for path in sports_catalog_candidates():
        tried.append(str(path))
        if path.is_file():
            return parse_sports_catalog(path.read_text())
    raise FileNotFoundError(f"sports.ts not found (tried {', '.join(tried)})")


def designation_query(code: str, fy_start: dt.date | None = None, fy_end: dt.date | None = None) -> dict[str, Any]:
    conditions: list[dict[str, str]] = [
        {"parameter": "Project Code", "operator": "Is", "value": code},
    ]
    if fy_start is not None:
        conditions.append(
            {"parameter": "Gift Date", "operator": "OnOrAfter", "value": fy_start.isoformat()}
        )
    if fy_end is not None:
        conditions.append(
            {"parameter": "Gift Date", "operator": "OnOrBefore", "value": fy_end.isoformat()}
        )
    return {"groups": [{"conditions": conditions}]}


def _assert_allowed_code(code: str) -> None:
    if code in FORBIDDEN_CODES:
        raise RuntimeError(f"refusing forbidden project code {code}")


def collect_sport(
    client: VirtuousClient,
    sport: dict[str, str | None],
    fy_start: dt.date,
    fy_end: dt.date,
    as_of: str,
    anonymous_ids: frozenset[str] | None,
) -> dict[str, Any]:
    key = str(sport["key"])
    code = sport.get("projectCode")
    if not code:
        return unmapped_row(key, None)
    _assert_allowed_code(code)
    try:
        project = client.get(f"{PROJECT_BY_CODE_PATH}/{urllib.parse.quote(code, safe='')}")
    except Exception as exc:  # noqa: BLE001 - one sport must not fail the snapshot
        print(f"  {key} project fetch failed: {type(exc).__name__}", flush=True)
        return unavailable_row(key, code)
    if not project:
        return unavailable_row(key, code)

    all_time_amount, all_time_count = all_time_from_project(project)
    try:
        fytd_rows = client.paged_query(
            GIFT_DESIGNATION_QUERY_PATH,
            designation_query(code, fy_start, fy_end),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  {key} fytd query failed: {type(exc).__name__}", flush=True)
        return unavailable_row(key, code)
    fytd_amount, fytd_count = fytd_from_designations(code, fytd_rows, fy_start, fy_end)

    all_rows: list[dict[str, Any]] = []
    try:
        all_rows = client.paged_query(
            GIFT_DESIGNATION_QUERY_PATH,
            designation_query(code),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  {key} all-time designation query failed: {type(exc).__name__}", flush=True)
        if all_time_count is None:
            return unavailable_row(key, code)

    if all_time_count is None:
        _, all_time_count = fytd_from_designations(
            code,
            all_rows,
            dt.date(1900, 1, 1),
            dt.date(9999, 12, 31),
        )

    name_map: dict[Any, dict[str, Any]] = {}
    try:
        full_gifts = client.paged_query(FULL_GIFT_PATH, designation_query(code))
        name_map = names_from_full_gifts(full_gifts)
    except Exception as exc:  # noqa: BLE001
        print(f"  {key} full gift query failed: {type(exc).__name__}: {str(exc)[:200]}", flush=True)

    gifts = gifts_from_designations(
        code, all_rows, name_map, fy_start, fy_end, anonymous_ids=anonymous_ids
    )

    print(
        f"  {key} code={code} fytd={fytd_amount} fytd_gifts={fytd_count} "
        f"all_time={all_time_amount} all_time_gifts={all_time_count} gift_rows={len(gifts)}",
        flush=True,
    )
    return mapped_row(
        key,
        code,
        fytd_amount=fytd_amount,
        fytd_gift_count=fytd_count,
        all_time_amount=all_time_amount,
        all_time_gift_count=all_time_count,
        as_of=as_of,
        gifts=gifts,
    )


def build_snapshot(
    sports: list[dict[str, str | None]],
    rows: dict[str, dict[str, Any]],
    *,
    today: dt.date,
    generated_at: str,
) -> dict[str, Any]:
    fy, fy_start, fy_end = fiscal_year_window(today)
    payload_sports: dict[str, dict[str, Any]] = {}
    for sport in sports:
        key = str(sport["key"])
        row = rows[key]
        if row.get("projectCode") in FORBIDDEN_CODES:
            row = unmapped_row(key, None)
        payload_sports[key] = row
    return {
        "generated_at": generated_at,
        "source": "virtuous",
        "fiscalYear": fy,
        "fiscalYearLabel": fiscal_year_label(fy),
        "fyStart": fy_start.isoformat(),
        "fyEnd": fy_end.isoformat(),
        "sports": payload_sports,
    }


def collect_snapshot(
    client: VirtuousClient,
    sports: list[dict[str, str | None]],
    *,
    today: dt.date,
    generated_at: str,
) -> dict[str, Any]:
    fy, fy_start, fy_end = fiscal_year_window(today)
    rows: dict[str, dict[str, Any]] = {}
    anonymous_ids = anonymous_contact_ids(client)
    for sport in sports:
        key = str(sport["key"])
        rows[key] = collect_sport(client, sport, fy_start, fy_end, generated_at, anonymous_ids)
    return build_snapshot(sports, rows, today=today, generated_at=generated_at)


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
    if not key:
        raise RuntimeError("VIRTUOUS_API_KEY is required")
    sports = load_sports_catalog()
    print(f"  athletics coaching fundraising sports={len(sports)}", flush=True)
    client = VirtuousClient(
        key,
        os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com",
    )
    now = dt.datetime.now(dt.timezone.utc)
    snapshot = collect_snapshot(
        client,
        sports,
        today=now.date(),
        generated_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
