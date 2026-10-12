"""Thank-you letter donor cards publisher (DST-3062).

Builds ``ty-letters/latest.json`` for /advancement/ty-letters from live
Virtuous data. One card per gift of MIN_AMOUNT or more dated in the last
WINDOW_DAYS days:

* Donor = the recognition contact: ``contactPassthroughId`` when set, else
  ``contactId``. History is every gift where the donor is the hard credit
  contact or a passthrough (soft credit) contact. FullContact
  ``lifeToDateGiving`` excludes soft credit, so it is never used.
* Each card is point in time as of the thanked gift: history is limited to
  gifts dated on or before the thanked gift's date. Rows are Latest, 2nd
  Latest, Largest and 1st, plus Total Giving.
* Credited amount: ``amount`` when the donor is the hard credit contact, else
  the donor's ``giftPassthroughs[].passthroughAmount`` (fallback ``amount``).
* Reversals: Virtuous puts no flag on a reversed gift. Only the
  ReversingTransaction gift carries ``reversedGiftId``. Every run pulls all
  ReversingTransaction gifts (a few dozen org wide) and excludes the reversed
  originals and their reversing gifts from rows and totals. A reversing gift
  with no ``reversedGiftId`` (a processor refund) cannot be matched, so it
  stays in Total Giving as a negative amount and is never picked as a row.
* As-of history never changes for a given gift, so the as-of part of each card
  (rows, total) is cached in the previous snapshot and reused unless the
  thanked gift's ``modifiedDateTimeUtc`` changed. Contact fields (name,
  address, phones, salutation, solicitor, anonymous) are refreshed every run.
* Time budget: new donors stop starting at about 10 minutes; the snapshot is
  then ``partial`` with ``pending`` gifts that the next run continues.

The Virtuous rate limit is shared org wide with every other publisher, so
history is fetched for several donors per request (OR groups) with modest
concurrency. Logs carry counts only, never donor names or amounts.

CLI (read-only, never writes S3):
  python3 handler.py --dry-run --days 3
  python3 handler.py --dry-run --gift-ids 1001,1002
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Iterable

CACHE_KEY = os.environ.get("TY_LETTERS_CACHE_KEY") or "ty-letters/latest.json"
FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
FULL_CONTACT_PATH = "/api/Contact/Query/FullContact"
GIFT_VIEW = "https://app.virtuoussoftware.com/Generosity/Gift/View"
RETRYABLE = {429, 500, 502, 503, 504}
REQUEST_TIMEOUT_S = 120
MAX_PAGES = 200
PAGE = 1000
CONTACT_BATCH = 100
CENT = Decimal("0.01")

# Business constants (DST-3062).
WINDOW_DAYS = 60
MIN_AMOUNT = Decimal("1000")
REVERSING_TYPE = "ReversingTransaction"
ANONYMOUS_DONOR_TAG = "Anonymous Donor"
DEFAULT_PLACEHOLDERS = {"default", "default contact"}
SEGMENT_HIST_RE = re.compile(r"-HIST_[A-Za-z0-9]+$")

# Run budget: Lambda timeout is 15 minutes. Stop starting new donor batches at
# BUDGET_S (or earlier when the Lambda context says less time is left), which
# leaves room for in-flight requests, the contact pull and the S3 write.
BUDGET_S = 600.0
# Cards for gifts this recent are rebuilt every run even when cached, so gifts
# entered late (dated on or before the thanked gift) show up while letters
# are still being written.
REFRESH_DAYS = 14
RESERVE_S = 240.0
CONCURRENCY = 3
DONOR_BATCH = 5


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Virtuous client (mgo-analysis client: timeouts, guarded paging), with a
# lock on the request counter because history pulls run in threads.
# --------------------------------------------------------------------------


class VirtuousHttpError(RuntimeError):
    def __init__(self, path: str, code: int, detail: str):
        super().__init__(f"Virtuous {path} -> {code}: {detail}")
        self.path = path
        self.code = code
        self.detail = detail


class VirtuousTimeout(RuntimeError):
    pass


class VirtuousClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: int = REQUEST_TIMEOUT_S,
        max_pages: int = MAX_PAGES,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_pages = max_pages
        self.requests = 0
        self._lock = threading.Lock()

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = PAGE) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        for _page in range(self.max_pages):
            payload = self._request("POST", path, body, {"skip": skip, "take": page_size})
            batch = payload.get("list") or []
            rows.extend(batch)
            skip += page_size
            raw_total = payload.get("total")
            if raw_total is None or raw_total == "":
                break
            if len(batch) < page_size or skip >= int(raw_total):
                break
        else:
            raise RuntimeError(f"Virtuous POST {path} exceeded {self.max_pages} pages of {page_size}")
        return rows

    def _count(self) -> int:
        with self._lock:
            self.requests += 1
            return self.requests

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}?{urllib.parse.urlencode(params)}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        skip = params.get("skip")
        timeouts = 0
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
            n = self._count()
            started = time.monotonic()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                    rows = len(payload.get("list") or []) if isinstance(payload, dict) else 0
                    log(
                        f"  virtuous {method} {path} skip={skip} status={resp.status} "
                        f"elapsed={time.monotonic() - started:.1f}s rows={rows} requests={n}"
                    )
                    return payload
            except urllib.error.HTTPError as exc:
                log(f"  virtuous {method} {path} skip={skip} status={exc.code} requests={n}")
                if exc.code in RETRYABLE and attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                raise VirtuousHttpError(path, exc.code, detail) from exc
            except (TimeoutError, socket.timeout, urllib.error.URLError) as exc:
                timeouts += 1
                log(f"  virtuous {method} {path} skip={skip} status=timeout/{type(exc).__name__} requests={n}")
                if timeouts < 2:
                    time.sleep(2)
                    continue
                raise VirtuousTimeout(f"Virtuous {method} {path} skip={skip} timed out twice") from exc
        raise RuntimeError(f"Virtuous {method} {path} failed after retries")


def resolve_api_key() -> str:
    key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
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


def _to_float(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


def _parse_date(value: Any) -> dt.date | None:
    if not value:
        return None
    text = str(value).strip()
    if "T" in text:
        text = text.split("T", 1)[0]
    if " " in text:
        text = text.split(" ", 1)[0]
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _int_id(value: Any) -> int | None:
    try:
        return int(value) if value is not None and str(value).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _custom(record: dict[str, Any], name: str) -> str | None:
    for field in record.get("customFields") or []:
        if field.get("name") == name:
            text = _text(field.get("value"))
            return text or None
    return None


def today_eastern() -> dt.date:
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # noqa: BLE001
        return dt.datetime.now(dt.timezone.utc).date()


# --------------------------------------------------------------------------
# Gift rules
# --------------------------------------------------------------------------


def donor_contact_id(gift: dict[str, Any]) -> int | None:
    """Recognition contact: the passthrough contact when set, else the gift contact."""
    return _int_id(gift.get("contactPassthroughId")) or _int_id(gift.get("contactId"))


def gift_id(gift: dict[str, Any]) -> int:
    return _int_id(gift.get("id")) or 0


def gift_date(gift: dict[str, Any]) -> dt.date | None:
    return _parse_date(gift.get("giftDate"))


def is_reversing(gift: dict[str, Any]) -> bool:
    return _text(gift.get("giftType")) == REVERSING_TYPE


def reversed_gift_ids(reversing: Iterable[dict[str, Any]]) -> set[int]:
    """Original gift ids named by ReversingTransaction gifts."""
    out: set[int] = set()
    for g in reversing:
        rid = _int_id(g.get("reversedGiftId"))
        if rid is not None:
            out.add(rid)
    return out


def credited_amount(gift: dict[str, Any], donor_id: int) -> Decimal:
    """Hard credit ``amount`` when the donor is the gift contact, else the
    donor's passthrough (soft credit) amount, falling back to ``amount``."""
    if _int_id(gift.get("contactId")) == donor_id:
        return _money(gift.get("amount"))
    for p in gift.get("giftPassthroughs") or []:
        if _int_id(p.get("contactId")) == donor_id:
            value = p.get("passthroughAmount")
            if value is None or value == "":
                return _money(gift.get("amount"))
            return _money(value)
    return _money(gift.get("amount"))


def credits_donor(gift: dict[str, Any], donor_id: int) -> bool:
    if _int_id(gift.get("contactId")) == donor_id:
        return True
    if _int_id(gift.get("contactPassthroughId")) == donor_id:
        return True
    return any(_int_id(p.get("contactId")) == donor_id for p in gift.get("giftPassthroughs") or [])


def strip_segment(segment: Any) -> str:
    return SEGMENT_HIST_RE.sub("", _text(segment)).strip()


def fund_names(gift: dict[str, Any]) -> str:
    designations = sorted(
        gift.get("giftDesignations") or [],
        key=lambda d: _money(d.get("amountDesignated")),
        reverse=True,
    )
    names: list[str] = []
    for d in designations:
        name = _text(d.get("project"))
        if name and name not in names:
            names.append(name)
    return "; ".join(names)


def gift_row(gift: dict[str, Any], donor_id: int) -> dict[str, Any]:
    day = gift_date(gift)
    return {
        "giftId": str(gift_id(gift)),
        "amount": _to_float(credited_amount(gift, donor_id)),
        "date": day.isoformat() if day else None,
        "type": _text(gift.get("giftType")) or None,
        "fund": fund_names(gift) or None,
        "appeal": strip_segment(gift.get("segment")) or None,
        "hardCredit": _text(gift.get("contactName")) or None,
    }


def _recency_key(gift: dict[str, Any]) -> tuple[dt.date, int]:
    return (gift_date(gift) or dt.date.min, gift_id(gift))


def build_asof(
    donor_id: int,
    thanked: dict[str, Any],
    history: Iterable[dict[str, Any]],
    reversed_ids: set[int],
) -> dict[str, Any]:
    """Rows and Total Giving as of the thanked gift's date."""
    cutoff = gift_date(thanked)
    by_id: dict[int, dict[str, Any]] = {}
    for g in history:
        if credits_donor(g, donor_id):
            by_id[gift_id(g)] = g
    by_id[gift_id(thanked)] = thanked
    asof = [g for g in by_id.values() if cutoff is None or (gift_date(g) and gift_date(g) <= cutoff)]

    total = Decimal("0")
    counted: list[int] = []
    eligible: list[tuple[dict[str, Any], Decimal]] = []
    for g in asof:
        gid = gift_id(g)
        reversing = is_reversing(g)
        if gid in reversed_ids or g.get("isReversed") is True:
            continue
        if reversing and _int_id(g.get("reversedGiftId")) is not None:
            continue
        amount = credited_amount(g, donor_id)
        total += amount
        counted.append(gid)
        if reversing or amount == 0:
            continue
        eligible.append((g, amount))

    thanked_id = gift_id(thanked)

    def recency(g: dict[str, Any]) -> tuple[dt.date, int, int]:
        # On the thanked gift's own date it sorts as the most recent, so it is
        # always the Latest row of its own card.
        return (gift_date(g) or dt.date.min, 1 if gift_id(g) == thanked_id else 0, gift_id(g))

    by_recent = sorted(eligible, key=lambda pair: recency(pair[0]), reverse=True)
    latest = by_recent[0][0] if by_recent else None
    second = by_recent[1][0] if len(by_recent) > 1 else None
    first = min(eligible, key=lambda pair: recency(pair[0]))[0] if eligible else None
    largest = max(eligible, key=lambda pair: (pair[1], recency(pair[0])))[0] if eligible else None

    def row(g: dict[str, Any] | None) -> dict[str, Any] | None:
        return gift_row(g, donor_id) if g is not None else None

    return {
        "rows": {
            "latest": row(latest),
            "secondLatest": row(second),
            "largest": row(largest),
            "first": row(first),
        },
        "totalGiving": _to_float(total),
        # Gift ids that went into this card, so a later reversal of any of them
        # invalidates the cached card.
        "historyGiftIds": sorted(counted),
    }


# --------------------------------------------------------------------------
# Contact rules
# --------------------------------------------------------------------------


def _not_placeholder(value: Any) -> str:
    text = _text(value)
    return "" if text.casefold() in DEFAULT_PLACEHOLDERS else text


def salutation(contact: dict[str, Any]) -> str:
    return _not_placeholder(contact.get("preferredSalutationName"))


def addressee(contact: dict[str, Any]) -> str:
    return _not_placeholder(contact.get("preferredAddresseeName")) or _not_placeholder(
        contact.get("formalContactName")
    )


def address_lines(contact: dict[str, Any]) -> list[str]:
    a = contact.get("address") or {}
    if not isinstance(a, dict):
        return []
    lines = [_text(a.get("address1")), _text(a.get("address2"))]
    city, state, postal = _text(a.get("city")), _text(a.get("state")), _text(a.get("postal"))
    last = ", ".join(x for x in [city, " ".join(x for x in [state, postal] if x)] if x)
    lines.append(last)
    country = _text(a.get("country"))
    if country and country.casefold() not in {"united states", "usa", "us", "united states of america"}:
        lines.append(country)
    return [line for line in lines if line]


def _living_individuals(contact: dict[str, Any]) -> list[dict[str, Any]]:
    people = [p for p in contact.get("contactIndividuals") or [] if not p.get("isDeceased")]
    return sorted(people, key=lambda p: 0 if p.get("isPrimary") else 1)


def _method(person: dict[str, Any], kind: str) -> str:
    methods = [m for m in person.get("contactMethods") or [] if _text(m.get("type")) == kind and _text(m.get("value"))]
    methods.sort(key=lambda m: 0 if m.get("isPrimary") else 1)
    return _text(methods[0].get("value")) if methods else ""


def phone(contact: dict[str, Any], kind: str) -> str:
    """First ``kind`` method on the primary living individual, else on any living individual."""
    for person in _living_individuals(contact):
        value = _method(person, kind)
        if value:
            return value
    return ""


def is_anonymous(contact: dict[str, Any]) -> bool:
    target = ANONYMOUS_DONOR_TAG.casefold()
    for tag in contact.get("tags") or []:
        name = tag.get("name") if isinstance(tag, dict) else tag
        if _text(name).casefold() == target:
            return True
    return False


def contact_fields(contact: dict[str, Any] | None, thanked: dict[str, Any], donor_id: int) -> dict[str, Any]:
    c = contact or {}
    return {
        # No hard-credit fallback: for a soft credit gift that is the DAF or
        # foundation, not the donor.
        "donorName": _text(c.get("name")) or f"Contact {donor_id}",
        "solicitor": _custom(c, "Solicitor") or _custom(thanked, "GFT_Solicitor") or "",
        "salutation": salutation(c),
        "addressee": addressee(c),
        "addressLines": address_lines(c),
        "cellPhone": phone(c, "Mobile Phone"),
        "homePhone": phone(c, "Home Phone"),
        "anonymous": is_anonymous(c),
    }


# --------------------------------------------------------------------------
# Virtuous pulls
# --------------------------------------------------------------------------


def window_query(start: dt.date, end: dt.date, with_amount: bool = True) -> dict[str, Any]:
    conditions: list[dict[str, Any]] = [
        {"parameter": "Gift Date", "operator": "OnOrAfter", "value": start.isoformat()},
        {"parameter": "Gift Date", "operator": "OnOrBefore", "value": end.isoformat()},
    ]
    if with_amount:
        conditions.append(
            {"parameter": "Amount", "operator": "GreaterThanOrEqual", "value": str(int(MIN_AMOUNT))}
        )
    return {"groups": [{"conditions": conditions}], "sortBy": "Id", "descending": False}


def fetch_window(client: VirtuousClient, start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """Window gifts. The Amount condition only narrows the pull; the floor is
    always re-applied client side, so a server that ignores it is still safe."""
    try:
        rows = client.paged_query(FULL_GIFT_PATH, window_query(start, end), PAGE)
    except VirtuousHttpError as exc:
        if exc.code != 400:
            raise
        log("  Amount condition rejected; pulling the date window only")
        rows = client.paged_query(FULL_GIFT_PATH, window_query(start, end, with_amount=False), PAGE)
    return rows


def fetch_gift_ids(client: VirtuousClient, ids: list[int]) -> list[dict[str, Any]]:
    groups = [{"conditions": [{"parameter": "Gift Id", "operator": "Is", "value": str(i)}]} for i in ids]
    return client.paged_query(FULL_GIFT_PATH, {"groups": groups}, PAGE) if groups else []


def fetch_reversing(client: VirtuousClient) -> list[dict[str, Any]]:
    body = {"groups": [{"conditions": [{"parameter": "Gift Type", "operator": "Is", "value": REVERSING_TYPE}]}]}
    return client.paged_query(FULL_GIFT_PATH, body, PAGE)


def history_query(donor_ids: list[int]) -> dict[str, Any]:
    groups: list[dict[str, Any]] = []
    for d in donor_ids:
        groups.append({"conditions": [{"parameter": "Contact Id", "operator": "Is", "value": str(d)}]})
        groups.append({"conditions": [{"parameter": "Passthrough Contact Id", "operator": "Is", "value": str(d)}]})
    return {"groups": groups, "sortBy": "Id", "descending": False}


def fetch_history(client: VirtuousClient, donor_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    """Hard and soft credit gifts for several donors in one paged query, split per donor."""
    rows = client.paged_query(FULL_GIFT_PATH, history_query(donor_ids), PAGE)
    out: dict[int, dict[int, dict[str, Any]]] = {d: {} for d in donor_ids}
    for g in rows:
        for d in donor_ids:
            if credits_donor(g, d):
                out[d][gift_id(g)] = g
    return {d: list(v.values()) for d, v in out.items()}


def fetch_contacts(client: VirtuousClient, ids: Iterable[int]) -> dict[int, dict[str, Any]]:
    wanted = sorted(set(ids))
    found: dict[int, dict[str, Any]] = {}
    for start in range(0, len(wanted), CONTACT_BATCH):
        batch = wanted[start:start + CONTACT_BATCH]
        groups = [{"conditions": [{"parameter": "Contact Id", "operator": "Is", "value": str(i)}]} for i in batch]
        for rec in client.paged_query(FULL_CONTACT_PATH, {"groups": groups, "includeArchived": True}, CONTACT_BATCH):
            rid = _int_id(rec.get("id"))
            if rid is not None:
                found[rid] = rec
    missing = len([i for i in wanted if i not in found])
    if missing:
        log(f"  WARNING contacts not returned by Virtuous: {missing}")
    return found


# --------------------------------------------------------------------------
# Snapshot
# --------------------------------------------------------------------------


def select_window_gifts(gifts: Iterable[dict[str, Any]], reversed_ids: set[int]) -> list[dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for g in gifts:
        gid = gift_id(g)
        if not gid or is_reversing(g) or gid in reversed_ids or g.get("isReversed") is True:
            continue
        if _money(g.get("amount")) < MIN_AMOUNT:
            continue
        if donor_contact_id(g) is None:
            continue
        out[gid] = g
    return list(out.values())


def cached_asof(previous: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for card in (previous or {}).get("cards") or []:
        gid = str(card.get("giftId") or "")
        if gid and isinstance(card.get("rows"), dict):
            out[gid] = card
    return out


def _cache_valid(card: dict[str, Any] | None, gift: dict[str, Any], reversed_ids: set[int]) -> bool:
    """A cached card is still correct: same donor, the thanked gift was not
    modified, and no gift counted on it has since been reversed."""
    if not card:
        return False
    if str(card.get("donorContactId")) != str(donor_contact_id(gift)):
        return False
    if (card.get("giftModified") or None) != (gift.get("modifiedDateTimeUtc") or None):
        return False
    history = card.get("historyGiftIds")
    if not isinstance(history, list):
        return False
    return not any(_int_id(i) in reversed_ids for i in history)


def needs_build(
    card: dict[str, Any] | None,
    gift: dict[str, Any],
    reversed_ids: set[int],
    today: dt.date,
) -> bool:
    """Build when the cache is invalid, and always for gifts dated within
    REFRESH_DAYS of today."""
    if not _cache_valid(card, gift, reversed_ids):
        return True
    day = gift_date(gift)
    return day is not None and day >= today - dt.timedelta(days=REFRESH_DAYS)


class Budget:
    def __init__(self, seconds: float, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self.started = clock()
        self.seconds = seconds

    def elapsed(self) -> float:
        return self.clock() - self.started

    def exhausted(self) -> bool:
        return self.elapsed() >= self.seconds


def build_asof_for_gifts(
    client: Any,
    todo: list[dict[str, Any]],
    reversed_ids: set[int],
    budget: Budget,
    history_fn: Callable[[Any, list[int]], dict[int, list[dict[str, Any]]]] = fetch_history,
    concurrency: int = CONCURRENCY,
    donor_batch: int = DONOR_BATCH,
    errors: list[str] | None = None,
) -> dict[int, dict[str, Any]]:
    """As-of parts for uncached gifts, newest gifts first. Stops starting new
    donor batches once the budget is spent; unbuilt gifts are left out. A
    failed batch is logged (size and error class only), appended to
    ``errors``, and its gifts are left out too."""
    by_donor: dict[int, list[dict[str, Any]]] = {}
    for g in sorted(todo, key=_recency_key, reverse=True):
        by_donor.setdefault(donor_contact_id(g) or 0, []).append(g)
    donors = list(by_donor)
    batches = [donors[i:i + donor_batch] for i in range(0, len(donors), donor_batch)]
    built: dict[int, dict[str, Any]] = {}

    def run(batch: list[int]) -> dict[int, list[dict[str, Any]]]:
        return history_fn(client, batch)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        pending: set[concurrent.futures.Future] = set()
        futures: dict[concurrent.futures.Future, list[int]] = {}
        queue = list(batches)
        while queue or pending:
            while queue and len(pending) < concurrency and not budget.exhausted():
                batch = queue.pop(0)
                f = pool.submit(run, batch)
                futures[f] = batch
                pending.add(f)
            if not pending:
                break
            done, pending = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            for f in done:
                try:
                    history = f.result()
                except Exception as exc:  # noqa: BLE001
                    log(f"  WARNING history batch failed donors={len(futures[f])} error={type(exc).__name__}")
                    if errors is not None:
                        errors.append(type(exc).__name__)
                    continue
                for donor in futures[f]:
                    for g in by_donor[donor]:
                        built[gift_id(g)] = build_asof(donor, g, history.get(donor, []), reversed_ids)
    return built


def assemble(
    *,
    window_gifts: list[dict[str, Any]],
    previous: dict[str, Any] | None,
    built: dict[int, dict[str, Any]],
    contacts: dict[int, dict[str, Any]],
    window_start: dt.date,
    window_end: dt.date,
    generated_at: str,
    reversed_ids: set[int] | None = None,
    failed_batches: int = 0,
) -> dict[str, Any]:
    """Cards from this run's builds, falling back to a still-valid cached card
    (for example a recent card whose refresh did not run in time)."""
    reversed_ids = reversed_ids or set()
    cache = cached_asof(previous)
    cards: list[dict[str, Any]] = []
    pending = 0
    for g in window_gifts:
        gid = gift_id(g)
        donor = donor_contact_id(g) or 0
        part = built.get(gid)
        if part is None:
            hit = cache.get(str(gid))
            if _cache_valid(hit, g, reversed_ids):
                part = {
                    "rows": hit["rows"],
                    "totalGiving": hit.get("totalGiving", 0.0),
                    "historyGiftIds": hit.get("historyGiftIds") or [],
                }
        if part is None:
            pending += 1
            continue
        day = gift_date(g)
        card = {
            "giftId": str(gid),
            "giftDate": day.isoformat() if day else None,
            "amount": _to_float(_money(g.get("amount"))),
            "donorContactId": str(donor),
            **contact_fields(contacts.get(donor), g, donor),
            "rows": part["rows"],
            "totalGiving": part["totalGiving"],
            "historyGiftIds": part.get("historyGiftIds") or [],
            "batch": _text(g.get("batch")) or None,
            "giftModified": g.get("modifiedDateTimeUtc") or None,
            "virtuousGiftUrl": f"{GIFT_VIEW}/{gid}",
        }
        cards.append(card)
    cards.sort(key=lambda c: (c["giftDate"] or "", c["amount"], c["giftId"]), reverse=True)
    return {
        "generatedAt": generated_at,
        "windowStart": window_start.isoformat(),
        "windowEnd": window_end.isoformat(),
        "minAmount": _to_float(MIN_AMOUNT),
        "partial": pending > 0 or failed_batches > 0,
        "pending": pending,
        "cards": cards,
    }


def run(
    client: Any,
    *,
    today: dt.date,
    previous: dict[str, Any] | None,
    budget: Budget,
    days: int = WINDOW_DAYS,
    gift_ids: list[int] | None = None,
) -> dict[str, Any]:
    window_start = today - dt.timedelta(days=days)
    reversing = fetch_reversing(client)
    reversed_ids = reversed_gift_ids(reversing)
    log(f"  reversing gifts={len(reversing)} reversed originals={len(reversed_ids)}")

    raw = fetch_gift_ids(client, gift_ids) if gift_ids else fetch_window(client, window_start, today)
    if gift_ids:
        dated = [gift_date(g) for g in raw if gift_date(g)]
        if dated:
            window_start = min(dated)
            today = max(max(dated), today)
    else:
        raw = [g for g in raw if (gift_date(g) or dt.date.min) >= window_start]
    gifts = select_window_gifts(raw, reversed_ids)
    dropped_reversed = len([g for g in raw if gift_id(g) in reversed_ids])
    log(f"  window gifts pulled={len(raw)} eligible={len(gifts)} reversedDropped={dropped_reversed}")

    cache = cached_asof(previous)
    todo = [g for g in gifts if needs_build(cache.get(str(gift_id(g))), g, reversed_ids, today)]
    log(f"  cached={len(gifts) - len(todo)} toBuild={len(todo)}")
    errors: list[str] = []
    built = build_asof_for_gifts(client, todo, reversed_ids, budget, errors=errors)
    donors = {donor_contact_id(g) for g in gifts if donor_contact_id(g)}
    contacts = fetch_contacts(client, donors)
    generated_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    snapshot = assemble(
        window_gifts=gifts,
        previous=previous,
        built=built,
        contacts=contacts,
        window_start=window_start,
        window_end=today,
        generated_at=generated_at,
        reversed_ids=reversed_ids,
        failed_batches=len(errors),
    )
    if gifts and not snapshot["cards"]:
        # Publishing an empty snapshot would blank the page; fail loudly instead.
        raise RuntimeError(f"no cards built for {len(gifts)} window gifts (failed batches={len(errors)})")
    return snapshot


def read_previous() -> dict[str, Any] | None:
    try:
        from common.s3util import data_bucket, s3

        out = s3().get_object(Bucket=data_bucket(), Key=CACHE_KEY)
        return json.loads(out["Body"].read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        log(f"  no previous snapshot ({type(exc).__name__}); building every card")
        return None


def budget_seconds(context: Any) -> float:
    getter = getattr(context, "get_remaining_time_in_millis", None)
    if callable(getter):
        try:
            return max(30.0, min(BUDGET_S, getter() / 1000.0 - RESERVE_S))
        except Exception:  # noqa: BLE001
            pass
    return BUDGET_S


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event
    budget = Budget(budget_seconds(context))
    client = make_client()
    snapshot = run(client, today=today_eastern(), previous=read_previous(), budget=budget)

    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    summary = {
        "cache": uri,
        "generatedAt": snapshot["generatedAt"],
        "cards": len(snapshot["cards"]),
        "partial": snapshot["partial"],
        "pending": snapshot["pending"],
        "requests": client.requests,
        "elapsedS": round(budget.elapsed(), 1),
    }
    log(
        f"  ty-letters cards={summary['cards']} partial={summary['partial']} pending={summary['pending']} "
        f"requests={client.requests} elapsed={summary['elapsedS']}s"
    )
    return summary


# --------------------------------------------------------------------------
# CLI dry run: aggregates only, never names or addresses.
# --------------------------------------------------------------------------

BLANK_FIELDS = ["donorName", "solicitor", "salutation", "addressee", "addressLines", "cellPhone", "homePhone"]
ROW_KEYS = ["latest", "secondLatest", "largest", "first"]


def dry_run_summary(snapshot: dict[str, Any], requests: int, elapsed: float) -> dict[str, Any]:
    cards = snapshot["cards"]
    blanks = {f: sum(1 for c in cards if not c.get(f)) for f in BLANK_FIELDS}
    blanks.update({f"rows.{k}": sum(1 for c in cards if not (c.get("rows") or {}).get(k)) for k in ROW_KEYS})
    return {
        "windowStart": snapshot["windowStart"],
        "windowEnd": snapshot["windowEnd"],
        "cards": len(cards),
        "donors": len({c["donorContactId"] for c in cards}),
        "anonymous": sum(1 for c in cards if c.get("anonymous")),
        "partial": snapshot["partial"],
        "pending": snapshot["pending"],
        "requests": requests,
        "elapsedS": round(elapsed, 1),
        "blank": blanks,
    }


def reconciliation(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for c in snapshot["cards"]:
        rows = c.get("rows") or {}
        out.append({
            "giftId": c["giftId"],
            "totalGiving": c["totalGiving"],
            **{k: ([rows[k]["date"], rows[k]["amount"]] if rows.get(k) else None) for k in ROW_KEYS},
        })
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Thank-you letter cards publisher")
    parser.add_argument("--dry-run", action="store_true", help="do not read or write S3")
    parser.add_argument("--days", type=int, default=WINDOW_DAYS)
    parser.add_argument("--gift-ids", default="", help="comma separated gift ids (prints totals and row dates/amounts)")
    args = parser.parse_args(argv)
    if not args.dry_run:
        parser.error("only --dry-run is supported from the CLI; the Lambda writes S3")
    ids = [int(x) for x in args.gift_ids.split(",") if x.strip()]
    budget = Budget(BUDGET_S)
    client = make_client()
    snapshot = run(client, today=today_eastern(), previous=None, budget=budget, days=args.days, gift_ids=ids or None)
    print(json.dumps(dry_run_summary(snapshot, client.requests, budget.elapsed()), indent=1))
    if ids:
        print(json.dumps(reconciliation(snapshot), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
