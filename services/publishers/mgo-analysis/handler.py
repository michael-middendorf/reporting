"""MGO Analysis and Management publisher (DST-2830).

Builds ``mgo-analysis/latest.json`` for /advancement/mgo-analysis from live
Virtuous data:

* MGOs are the MGO organization groups ("Portfolio - X", not "MA Portfolio -").
* donors[]: one row per (portfolio contact, MGO), with Top Prospect tag, open
  Gift Ask totals, FY proposal / FY27 plan notes, last gift date, and the last
  Contact Note the assigned MGO authored for that contact (all time).
* notes[]: slim FY Contact Note rows (no text) classified by note type into
  outreach / face_to_face / proposal / plan, so the page can count by week,
  month, fiscal quarter, and full fiscal year.
* kpisByMgo: FY raised (same gift crediting rule as advancement-overview),
  open Gift Asks (expected fulfillment in the FY, like mgo-top-prospects),
  funded Gift Asks, and donor counts, plus a deduped ``__team__`` row.

``event={"mode": "discover"}`` is a read-only check for post-deploy
verification: it returns note type, tag, and ask status counts and writes
nothing to S3. Logs carry counts only (never note text or donor names).
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable

CACHE_KEY = os.environ.get("MGO_ANALYSIS_CACHE_KEY") or "mgo-analysis/latest.json"
CONTACT_VIEW = "https://app.virtuoussoftware.com/Generosity/Contact/View"
GROUP_PATH = "/api/OrganizationGroup"
FULL_CONTACT = "/api/Contact/Query/FullContact"
FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
ASK_PATH = "/api/GiftAsk/Query"
NOTE_QUERY = "/api/ContactNote/Query"
RETRYABLE = {429, 500, 502, 503, 504}
REQUEST_TIMEOUT_S = 120
MAX_PAGES = 200
NOTE_PAGE = 1000
FULL_GIFT_PAGE = 500
CENT = Decimal("0.01")
UNASSIGNED = "Unassigned"
TEAM_KEY = "__team__"

# --------------------------------------------------------------------------
# Business constants
# --------------------------------------------------------------------------

# Live Virtuous tag name, confirmed with discover mode on 2026-10-01. The ticket
# called it "Top FY27 MGO Donor"; that and the docx spellings stay as aliases.
TOP_PROSPECT_TAG = "Top FY27 MGO Prospect"
# Also accepted (normalized name equality) in case Advancement renames the tag.
TOP_PROSPECT_TAG_ALIASES = ["Top FY27 MGO Prospect", "Top FY27 MGO Donor", "FY27 Top Prospect", "Top FY27 Prospect"]

OPEN_ASK_EXCLUDED_STATUSES = [
    "Declined (MGO)",
    "Gift Received (Adv Svcs)",
    "Prospect Research Review (Adv Svcs)",
]
FUNDED_STATUSES = ["Gift Received (Adv Svcs)"]

# Note type pattern rules. Types are normalized (casefold, collapsed spaces)
# and checked in this order: plan, proposal, face_to_face, outreach.
NOTE_KIND_ORDER = ["plan", "proposal", "face_to_face", "outreach"]
# Substring phrases (not single "plan") so "planned giving" or "estate plan" do
# not qualify alone. Live type is "FY27 MGO Plan" (discover mode, 2026-10-01);
# the year words below are still required. "FY27 MGO Goal Activity" notes
# (written by Advancement staff, not always the MGO) also feed the plan column.
PLAN_WORDS = ["mgo plan", "plan for", "activity plan", "goal activity"]
PLAN_YEAR_WORDS = ["fy27", "fy 27", "2027"]
PROPOSAL_WORDS = ["proposal"]
FACE_TO_FACE_WORDS = ["in person", "face to face", "face-to-face", "meeting", "visit"]
# Remote meetings are not face to face; they fall through to outreach or None.
FACE_TO_FACE_EXCLUDE_WORDS = ["zoom", "virtual", "teams", "phone", "video", "online"]
OUTREACH_WORDS = ["call", "email", "e-mail", "text", "letter", "mail", "thank"]
# Mission Advancement types belong to the MA team, not MGOs.
MA_TYPE_PREFIX = "mission advancement"
EXCLUDED_TYPE_WORDS = ["obituary", "general", "invalid"]

# Roster (copied from the portfolios publisher): MGO display name, email,
# group name, and the Virtuous createdByUser stamp on their notes.
ROSTER: list[dict[str, Any]] = [
    {
        "name": "Beatrice Sanford",
        "email": "beatrice.sanford@avemaria.edu",
        "groupName": "Portfolio - Beatrice Sanford",
        "createdByUser": "Beatrice Sanford",
    },
    {
        "name": "Brigid Luzarraga",
        "email": "brigid.luzarraga@avemaria.edu",
        "groupName": "Portfolio - Brigid Luzarraga",
        "createdByUser": "Brigid Luzarraga",
    },
    {
        "name": "Colleen M. Dolnick",
        "email": "colleen.dolnick@avemaria.edu",
        "groupName": "Portfolio - Colleen M. Dolnick",
        "createdByUser": "Colleen Dolnick",
    },
    {
        "name": "James Thomas",
        "email": "jim.thomas@avemaria.edu",
        "groupName": "Portfolio - James Thomas",
        "createdByUser": "Jim Thomas",
    },
    {
        "name": "Julie Musselman",
        "email": "julie.musselman@avemaria.edu",
        "groupName": "Portfolio - Julie Musselman",
        "createdByUser": "Julie Musselman",
    },
    {
        "name": "Marita N. Emond",
        "email": "marita.emond@avemaria.edu",
        "groupName": "Portfolio - Marita N. Emond",
        "createdByUser": "Marita Emond",
    },
    {
        "name": "Mark J. Middendorf",
        "email": "mark.middendorf@avemaria.edu",
        "groupName": "Portfolio - Mark J. Middendorf",
        "createdByUser": "Mark Middendorf",
    },
    {
        "name": "Matthew Buzzanca",
        "email": "matthew.buzzanca@avemaria.edu",
        "groupName": "Portfolio - Matthew Buzzanca",
        "createdByUser": "Matthew Buzzanca",
    },
    {
        "name": "Patrick J. O'Connell",
        "email": "patrick.oconnell@avemaria.edu",
        "groupName": "Portfolio - Patrick J. O'Connell",
        "createdByUser": "Patrick OConnell",
    },
]

# First-name aliases used when matching note authors and ask assignees.
FIRST_NAME_ALIASES = {"jim": "james", "james": "jim"}


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Virtuous client (advancement-overview client: timeouts, guarded paging)
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

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = 1000) -> list[dict]:
        return self._paged("POST", path, body, page_size)

    def paged_get(self, path: str, page_size: int = 1000) -> list[dict]:
        return self._paged("GET", path, None, page_size)

    def _paged(self, method: str, path: str, body: dict[str, Any] | None, page_size: int) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        for _page in range(self.max_pages):
            payload = self._request(method, path, body, {"skip": skip, "take": page_size})
            batch = payload.get("list") or []
            rows.extend(batch)
            skip += page_size
            raw_total = payload.get("total")
            if raw_total is None or raw_total == "":
                break
            if len(batch) < page_size or skip >= int(raw_total):
                break
        else:
            raise RuntimeError(f"Virtuous {method} {path} exceeded {self.max_pages} pages of {page_size}")
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
            self.requests += 1
            started = time.monotonic()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                    rows = len(payload.get("list") or []) if isinstance(payload, dict) else 0
                    log(
                        f"  virtuous {method} {path} skip={skip} status={resp.status} "
                        f"elapsed={time.monotonic() - started:.1f}s rows={rows} requests={self.requests}"
                    )
                    return payload
            except urllib.error.HTTPError as exc:
                log(f"  virtuous {method} {path} skip={skip} status={exc.code} requests={self.requests}")
                if exc.code in RETRYABLE and attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                raise VirtuousHttpError(path, exc.code, detail) from exc
            except (TimeoutError, urllib.error.URLError) as exc:
                timeouts += 1
                log(
                    f"  virtuous {method} {path} skip={skip} status=timeout/{type(exc).__name__} "
                    f"requests={self.requests}"
                )
                if timeouts < 2:
                    time.sleep(2)
                    continue
                raise VirtuousTimeout(f"Virtuous {method} {path} skip={skip} timed out twice") from exc
        raise RuntimeError(f"Virtuous {method} {path} failed after retries")


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
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _iso(day: dt.date | None) -> str | None:
    return day.isoformat() if day else None


def _int_id(value: Any) -> int | None:
    try:
        return int(value) if value is not None and str(value).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _fold_ws(value: Any) -> str:
    return " ".join(str(value or "").split())


def _norm(value: Any) -> str:
    """casefold + collapsed whitespace (note types, statuses, tags)."""
    return _fold_ws(value).casefold()


def _contact_url(cid: Any) -> str | None:
    if cid is None or cid == "":
        return None
    return f"{CONTACT_VIEW}/{cid}"


def _custom(record: dict[str, Any], name: str) -> str | None:
    for field in record.get("customFields") or []:
        if field.get("name") == name:
            value = field.get("value")
            text = str(value).strip() if value is not None else ""
            return text or None
    return None


_TAG_RE = re.compile(r"<[^>]+>")


def clean_note_text(value: Any) -> str | None:
    text = html.unescape(_TAG_RE.sub(" ", str(value or "")))
    text = " ".join(text.split())
    return text or None


# --------------------------------------------------------------------------
# Fiscal year (advancement-overview)
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


def fiscal_year_label(fy: int) -> str:
    return f"FY {fy - 1}-{str(fy)[2:]}"


def today_eastern() -> dt.date:
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # noqa: BLE001
        return dt.datetime.now(dt.timezone.utc).date()


# --------------------------------------------------------------------------
# Portfolio groups and names
# --------------------------------------------------------------------------


_APOS = dict.fromkeys(map(ord, "\u2018\u2019\u02bc`"), ord("'"))


def _norm_group(name: str) -> str:
    n = (name or "").replace("\u2013", "-").replace("\u2014", "-").translate(_APOS)
    return " ".join(n.split())


def is_mgo_portfolio(name: str) -> bool:
    n = _norm_group(name).lower()
    if n.startswith("ma portfolio"):
        return False
    return n.startswith("portfolio -")


def portfolio_label(name: str) -> str:
    n = _norm_group(name)
    prefix = "portfolio -"
    if n.lower().startswith(prefix):
        return n[len(prefix):].strip()
    return n


def _fold_name(value: str) -> str:
    """casefold, drop punctuation (so O'Connell == OConnell), collapse spaces."""
    text = _norm_group(value or "").casefold()
    text = "".join(ch if ch.isalnum() or ch.isspace() else "" for ch in text)
    return " ".join(text.split())


def _name_variants(name: str) -> set[str]:
    """Normalized forms of a person's name: full, first+last (drops middle
    initials), and the same with Jim <-> James swapped."""
    folded = _fold_name(name)
    if not folded:
        return set()
    tokens = folded.split()
    forms = {folded}
    if len(tokens) >= 2:
        forms.add(f"{tokens[0]} {tokens[-1]}")
    out = set(forms)
    for form in forms:
        parts = form.split()
        alias = FIRST_NAME_ALIASES.get(parts[0])
        if alias:
            out.add(" ".join([alias, *parts[1:]]))
    return out


def roster_for_group(group_name: str) -> dict[str, Any] | None:
    target = _norm_group(group_name).lower()
    for person in ROSTER:
        if _norm_group(person["groupName"]).lower() == target:
            return person
    return None


def build_mgos(groups: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    mgos: list[dict[str, Any]] = []
    seen: set[str] = set()
    for g in groups:
        raw = g.get("name") or ""
        if not is_mgo_portfolio(raw):
            continue
        key = portfolio_label(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        person = roster_for_group(raw)
        created_by = (person or {}).get("createdByUser") or key
        first_name = created_by.split()[0] if created_by.split() else key.split()[0]
        mgos.append(
            {
                "key": key,
                "name": (person or {}).get("name") or key,
                "firstName": first_name,
                "email": (person or {}).get("email") or None,
                "groupName": raw,
                "groupId": g.get("id"),
                "createdByUser": created_by,
            }
        )
    mgos.sort(key=lambda m: m["key"].lower())
    return mgos


def author_index(mgos: Iterable[dict[str, Any]]) -> dict[str, str]:
    """normalized author/assignee name form -> mgo key."""
    index: dict[str, str] = {}
    for m in mgos:
        for source in (m.get("createdByUser"), m.get("name"), m.get("key")):
            for form in _name_variants(source or ""):
                index.setdefault(form, m["key"])
    return index


def map_user_to_mgo(user: Any, index: dict[str, str]) -> str | None:
    for form in sorted(_name_variants(str(user or ""))):
        if form in index:
            return index[form]
    return None


def pick_portfolio(assigned_user: str, labels: list[str]) -> str:
    """mgo-top-prospects rule: fuzzy match the assignee to one of the contact's
    MGO portfolios; single portfolio wins; else alphabetical first."""
    if not labels:
        return UNASSIGNED
    if len(labels) == 1:
        return labels[0]
    assigned = _fold_name(assigned_user)
    if assigned:
        for label in labels:
            folded = _fold_name(label)
            if assigned in folded or folded in assigned:
                return label
        last = assigned.split()[-1]
        for label in labels:
            if last and last in _fold_name(label).split():
                return label
    return sorted(labels)[0]


def ask_mgo(ask: dict[str, Any], index: dict[str, str], contact_labels: dict[int, list[str]]) -> str | None:
    """MGO an ask counts toward: the assignee when it is an MGO, else the
    contact's MGO portfolio via pick_portfolio, else None."""
    direct = map_user_to_mgo(ask.get("assignedUser"), index)
    if direct:
        return direct
    cid = _int_id(ask.get("contactId"))
    label = pick_portfolio(str(ask.get("assignedUser") or ""), contact_labels.get(cid, []) if cid else [])
    return None if label == UNASSIGNED else label


# --------------------------------------------------------------------------
# Tags
# --------------------------------------------------------------------------


def _iter_tag_names(contact: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for key in ("tags", "contactTags"):
        for tag in contact.get(key) or []:
            if isinstance(tag, str):
                out.append(tag.strip())
            elif isinstance(tag, dict):
                name = tag.get("tagName") or tag.get("name") or tag.get("tag") or ""
                out.append(str(name).strip())
    return [n for n in out if n]


def _tag_norm(name: Any) -> str:
    folded = _norm(name)
    for prefix in ("mgo:", "ma:"):
        if folded.startswith(prefix):
            return folded[len(prefix):].strip()
    return folded


_TOP_PROSPECT_NORMS = {_tag_norm(n) for n in TOP_PROSPECT_TAG_ALIASES}


def is_top_prospect(contact: dict[str, Any]) -> bool:
    return any(_tag_norm(n) in _TOP_PROSPECT_NORMS for n in _iter_tag_names(contact))


# --------------------------------------------------------------------------
# Notes
# --------------------------------------------------------------------------


def _has_any(text: str, words: Iterable[str]) -> bool:
    return any(w in text for w in words)


def classify_note_type(note_type: Any) -> str | None:
    t = _norm(note_type)
    if not t:
        return None
    if _has_any(t, PLAN_WORDS) and _has_any(t, PLAN_YEAR_WORDS):
        return "plan"
    if _has_any(t, PROPOSAL_WORDS):
        return "proposal"
    if t.startswith(MA_TYPE_PREFIX) or _has_any(t, EXCLUDED_TYPE_WORDS):
        return None
    if _has_any(t, FACE_TO_FACE_WORDS) and not _has_any(t, FACE_TO_FACE_EXCLUDE_WORDS):
        return "face_to_face"
    if _has_any(t, OUTREACH_WORDS):
        return "outreach"
    return None


def note_type(note: dict[str, Any]) -> str:
    return _fold_ws(note.get("type") or note.get("noteType"))


def note_author(note: dict[str, Any]) -> str:
    return _fold_ws(note.get("createdByUser") or note.get("creator"))


def note_date(note: dict[str, Any]) -> dt.date | None:
    return _parse_date(note.get("noteDate") or note.get("noteDateTime") or note.get("createDateTimeUtc"))


# --------------------------------------------------------------------------
# Gift Asks
# --------------------------------------------------------------------------


_EXCLUDED_NORMS = {_norm(s) for s in OPEN_ASK_EXCLUDED_STATUSES}
_FUNDED_NORMS = {_norm(s) for s in FUNDED_STATUSES}


def is_open_ask(ask: dict[str, Any]) -> bool:
    status = _norm(ask.get("status"))
    return bool(status) and status not in _EXCLUDED_NORMS


def is_open_ask_in_fy(ask: dict[str, Any], fy_start: dt.date, fy_end: dt.date) -> bool:
    """Open ask whose expected fulfillment date falls in the fiscal year.
    No expected date means not open here (same gate as mgo-top-prospects)."""
    if not is_open_ask(ask):
        return False
    expected = _parse_date(ask.get("expectedFulfillmentDate") or ask.get("expectedFulfillmentDateFormatted"))
    return expected is not None and fy_start <= expected <= fy_end


def ask_funded_date(ask: dict[str, Any]) -> dt.date | None:
    """Date used to place a funded ask in a FY. Ask date or expected
    fulfillment date; the modified date only when both are missing."""
    for key in ("askDate", "expectedFulfillmentDate"):
        day = _parse_date(ask.get(key) or ask.get(f"{key}Formatted"))
        if day:
            return day
    return _parse_date(ask.get("modifiedDateTimeUtc") or ask.get("modifiedDate"))


def is_funded_ask(ask: dict[str, Any], fy_start: dt.date, fy_end: dt.date) -> bool:
    if _norm(ask.get("status")) not in _FUNDED_NORMS:
        return False
    candidates = [
        _parse_date(ask.get("askDate") or ask.get("askDateFormatted")),
        _parse_date(ask.get("expectedFulfillmentDate") or ask.get("expectedFulfillmentDateFormatted")),
    ]
    present = [d for d in candidates if d]
    if not present:
        modified = _parse_date(ask.get("modifiedDateTimeUtc") or ask.get("modifiedDate"))
        present = [modified] if modified else []
    return any(fy_start <= d <= fy_end for d in present)


# --------------------------------------------------------------------------
# Gift crediting (advancement-overview "MGO Gift" rule)
# --------------------------------------------------------------------------


def _norm_apostrophe(value: str) -> str:
    return value.replace("\u2019", "'").replace("\u2018", "'")


def group_mgo_last(name: str) -> str | None:
    n = _norm_apostrophe(_norm_group(name))
    idx = n.find("- ")
    if idx < 0:
        return None
    assigned = n[idx + 2:].strip()
    if not assigned:
        return None
    return assigned.split(" ")[-1]


def solicitor_last(value: str | None) -> str | None:
    text = _norm_apostrophe(" ".join((value or "").split()))
    if not text:
        return None
    return text.split(" ")[-1]


def contact_mgo_map(members: Iterable[dict[str, Any]]) -> dict[str, str]:
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
    solicitor = solicitor_last(_custom(gift, "GFT_Solicitor"))
    if solicitor:
        return solicitor
    cid = gift.get("contactId")
    if cid is not None and str(cid) in contact_mgo:
        return contact_mgo[str(cid)]
    return UNASSIGNED


def dedupe_by_id(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out = []
    for row in rows:
        rid = row.get("id")
        key = str(rid) if rid is not None else json.dumps(row, sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


# --------------------------------------------------------------------------
# Snapshot assembly (pure)
# --------------------------------------------------------------------------


def _empty_kpi() -> dict[str, Any]:
    return {
        "fyRaised": Decimal("0"),
        "openAskAmount": Decimal("0"),
        "openAskCount": 0,
        "fundedAmount": Decimal("0"),
        "fundedCount": 0,
        "donorCount": 0,
    }


def _kpi_out(k: dict[str, Any]) -> dict[str, Any]:
    return {
        "fyRaised": _to_float(k["fyRaised"]),
        "openAskAmount": _to_float(k["openAskAmount"]),
        "openAskCount": int(k["openAskCount"]),
        "fundedAmount": _to_float(k["fundedAmount"]),
        "fundedCount": int(k["fundedCount"]),
        "donorCount": int(k["donorCount"]),
    }


def _contact_name(contact: dict[str, Any], cid: int) -> str:
    name = _fold_ws(contact.get("name") or contact.get("formalContactName") or contact.get("contactName"))
    return name or f"Contact {cid}"


def build_snapshot(
    *,
    today: dt.date,
    groups: list[dict[str, Any]],
    contacts_by_group: dict[Any, list[dict[str, Any]]],
    asks: list[dict[str, Any]],
    gifts: list[dict[str, Any]],
    fy_notes: list[dict[str, Any]],
    creator_notes: list[dict[str, Any]] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    fy, fy_start, fy_end = fiscal_year_window(today)
    mgos = build_mgos(groups)
    index = author_index(mgos)
    mgo_keys = [m["key"] for m in mgos]

    # Portfolio membership.
    portfolio: dict[str, dict[int, dict[str, Any]]] = {k: {} for k in mgo_keys}
    contact_labels: dict[int, list[str]] = defaultdict(list)
    members: list[dict[str, Any]] = []
    for m in mgos:
        for contact in contacts_by_group.get(m["groupId"], []) or []:
            cid = _int_id(contact.get("id") or contact.get("contactId"))
            if cid is None:
                continue
            portfolio[m["key"]][cid] = contact
            if m["key"] not in contact_labels[cid]:
                contact_labels[cid].append(m["key"])
            members.append({"contactId": cid, "organizationGroupName": m["groupName"]})

    kpis = {k: _empty_kpi() for k in mgo_keys}
    team = _empty_kpi()

    # FY raised: each gift credited once (GFT_Solicitor, else portfolio MGO).
    contact_mgo = contact_mgo_map(members)
    last_to_key: dict[str, str] = {}
    for m in mgos:
        last = group_mgo_last(m["groupName"])
        if last:
            last_to_key.setdefault(last.casefold(), m["key"])
    for gift in dedupe_by_id(gifts):
        day = _parse_date(gift.get("giftDate") or gift.get("giftDateFormatted"))
        if day is None or day < fy_start or day > today:
            continue
        key = last_to_key.get(gift_mgo_last(gift, contact_mgo).casefold())
        if not key:
            continue
        amount = _money(gift.get("amount"))
        kpis[key]["fyRaised"] += amount
        team["fyRaised"] += amount

    # Gift Asks.
    donor_open: dict[int, list[Decimal]] = defaultdict(list)
    for ask in dedupe_by_id(asks):
        open_ = is_open_ask_in_fy(ask, fy_start, fy_end)
        funded = is_funded_ask(ask, fy_start, fy_end)
        if not open_ and not funded:
            continue
        amount = _money(ask.get("askAmount"))
        cid = _int_id(ask.get("contactId"))
        if open_ and cid is not None:
            donor_open[cid].append(amount)
        key = ask_mgo(ask, index, contact_labels)
        if not key:
            continue
        bucket = ("openAskAmount", "openAskCount") if open_ else ("fundedAmount", "fundedCount")
        for target in (kpis[key], team):
            target[bucket[0]] += amount
            target[bucket[1]] += 1

    # Donor counts (team = distinct contacts).
    for key in mgo_keys:
        kpis[key]["donorCount"] = len(portfolio[key])
    team["donorCount"] = len(contact_labels)

    # FY notes.
    note_rows: list[dict[str, Any]] = []
    observed: dict[str, set[str]] = {k: set() for k in NOTE_KIND_ORDER}
    proposal_contacts: set[int] = set()
    latest_plan: dict[int, tuple[str, int, str | None]] = {}
    last_activity: dict[tuple[str, int], dt.date] = {}

    def stamp_plan(note: dict[str, Any], cid: int, day: dt.date) -> None:
        nid = _int_id(note.get("id"))
        prev = latest_plan.get(cid)
        cand = (day.isoformat(), nid or 0, clean_note_text(note.get("note") or note.get("text")))
        if prev is None or cand[:2] > prev[:2]:
            latest_plan[cid] = cand

    def stamp_activity(note: dict[str, Any]) -> None:
        author_key = map_user_to_mgo(note_author(note), index)
        cid = _int_id(note.get("contactId"))
        day = note_date(note)
        if not author_key or cid is None or day is None or day > today:
            return
        prev = last_activity.get((author_key, cid))
        if prev is None or day > prev:
            last_activity[(author_key, cid)] = day

    for note in dedupe_by_id(fy_notes):
        stamp_activity(note)
        day = note_date(note)
        cid = _int_id(note.get("contactId"))
        if day is None or day < fy_start or day > today or cid is None:
            continue
        raw_type = note_type(note)
        kind = classify_note_type(raw_type)
        if kind is None:
            continue
        observed[kind].add(raw_type)
        nid = _int_id(note.get("id"))
        if kind in ("outreach", "face_to_face"):
            author_key = map_user_to_mgo(note_author(note), index)
            if author_key and cid in portfolio.get(author_key, {}):
                note_rows.append(
                    {"mgo": author_key, "contactId": cid, "kind": kind, "date": day.isoformat(), "noteId": nid}
                )
            continue
        if kind == "proposal":
            proposal_contacts.add(cid)
        else:
            stamp_plan(note, cid, day)
        for key in contact_labels.get(cid, []):
            note_rows.append({"mgo": key, "contactId": cid, "kind": kind, "date": day.isoformat(), "noteId": nid})

    # "MGO Plan for FY27" notes are often written before Jul 1 (spring
    # planning). The type name already pins the year, so pre-FY plan notes
    # by MGO authors still fill planFy27. FY KPIs above stay FY-only.
    for note in creator_notes or []:
        stamp_activity(note)
        cid = _int_id(note.get("contactId"))
        day = note_date(note)
        if cid is None or day is None or day > today:
            continue
        raw_type = note_type(note)
        if classify_note_type(raw_type) == "plan":
            observed["plan"].add(raw_type)
            stamp_plan(note, cid, day)

    note_rows.sort(key=lambda r: (r["date"], r["mgo"], r["contactId"], r["noteId"] or 0))

    # Donors.
    mgo_by_key = {m["key"]: m for m in mgos}
    donors: list[dict[str, Any]] = []
    for key in mgo_keys:
        for cid, contact in portfolio[key].items():
            opens = donor_open.get(cid, [])
            plan = latest_plan.get(cid)
            activity = last_activity.get((key, cid))
            donors.append(
                {
                    "contactId": cid,
                    "name": _contact_name(contact, cid),
                    "contactUrl": _contact_url(cid),
                    "assignedMgo": key,
                    "assignedFirstName": mgo_by_key[key]["firstName"],
                    "topProspect": is_top_prospect(contact),
                    "openAskAmount": _to_float(sum(opens, Decimal("0"))),
                    "openAskCount": len(opens),
                    "formalProposal": cid in proposal_contacts,
                    "planFy27": plan[2] if plan else None,
                    "planDate": plan[0] if plan else None,
                    "lastGiftDate": _iso(_parse_date(contact.get("lastGiftDate"))),
                    "lastMgoActivityDate": _iso(activity),
                }
            )
    donors.sort(key=lambda d: (d["assignedMgo"].lower(), d["name"].lower(), d["contactId"]))

    kpis_out = {k: _kpi_out(v) for k, v in kpis.items()}
    kpis_out[TEAM_KEY] = _kpi_out(team)

    return {
        "generated_at": generated_at or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "virtuous",
        "fiscalYear": {"label": fiscal_year_label(fy), "start": fy_start.isoformat(), "end": fy_end.isoformat()},
        "asOf": today.isoformat(),
        "definitions": {
            "outreachTypes": sorted(observed["outreach"]),
            "faceToFaceTypes": sorted(observed["face_to_face"]),
            "proposalTypes": sorted(observed["proposal"]),
            "planTypes": sorted(observed["plan"]),
            "topProspectTag": TOP_PROSPECT_TAG,
            "topProspectTagAliases": list(TOP_PROSPECT_TAG_ALIASES),
            "openAskExcludedStatuses": list(OPEN_ASK_EXCLUDED_STATUSES),
            "fundedStatuses": list(FUNDED_STATUSES),
            "noteTypePatterns": {
                "order": list(NOTE_KIND_ORDER),
                "plan": {"all": [PLAN_WORDS, PLAN_YEAR_WORDS]},
                "proposal": {"any": list(PROPOSAL_WORDS)},
                "face_to_face": {"any": list(FACE_TO_FACE_WORDS)},
                "outreach": {"any": list(OUTREACH_WORDS)},
                "excludedPrefix": MA_TYPE_PREFIX,
                "excludedWords": list(EXCLUDED_TYPE_WORDS),
            },
        },
        "mgos": [
            {"key": m["key"], "name": m["name"], "firstName": m["firstName"], "email": m["email"], "groupName": m["groupName"]}
            for m in mgos
        ],
        "kpisByMgo": kpis_out,
        "notes": note_rows,
        "donors": donors,
    }


def build_discovery(
    *,
    today: dt.date,
    groups: list[dict[str, Any]],
    contacts_by_group: dict[Any, list[dict[str, Any]]],
    asks: list[dict[str, Any]],
    fy_notes: list[dict[str, Any]],
) -> dict[str, Any]:
    _fy, fy_start, _fy_end = fiscal_year_window(today)
    mgos = build_mgos(groups)
    index = author_index(mgos)
    by_type: dict[str, int] = defaultdict(int)
    by_author: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for note in dedupe_by_id(fy_notes):
        day = note_date(note)
        if day is None or day < fy_start or day > today:
            continue
        t = note_type(note) or "(none)"
        by_type[t] += 1
        key = map_user_to_mgo(note_author(note), index)
        if key:
            by_author[key][t] += 1
    tags: set[str] = set()
    for rows in contacts_by_group.values():
        for contact in rows or []:
            for name in _iter_tag_names(contact):
                low = name.casefold()
                if "top" in low or "fy27" in low or "prospect" in low:
                    tags.add(name)
    statuses: dict[str, int] = defaultdict(int)
    for ask in dedupe_by_id(asks):
        statuses[_fold_ws(ask.get("status")) or "(none)"] += 1
    return {
        "mode": "discover",
        "asOf": today.isoformat(),
        "noteTypesFy": dict(sorted(by_type.items())),
        "noteTypesByMgoAuthor": {k: dict(sorted(v.items())) for k, v in sorted(by_author.items())},
        "tagsMatching": sorted(tags),
        "giftAskStatuses": dict(sorted(statuses.items())),
        "mgos": [m["key"] for m in mgos],
    }


# --------------------------------------------------------------------------
# Fetch
# --------------------------------------------------------------------------


def _full_contacts_for_group(client: VirtuousClient, group: dict[str, Any]) -> list[dict[str, Any]]:
    """portfolios publisher: FullContact by Organization Group name, falling
    back to the group member listing plus Contact Id batches."""
    name = group.get("name") or ""
    gid = group.get("id")
    body = {"groups": [{"conditions": [{"parameter": "Organization Group", "operator": "Is", "value": name}]}]}
    try:
        return client.paged_query(FULL_CONTACT, body, 1000)
    except VirtuousHttpError as exc:
        log(f"  FullContact by group name failed ({exc.code}); using member listing")
    if gid is None:
        return []
    members = client.paged_get(f"{GROUP_PATH}/{gid}/contacts", 1000)
    ids = sorted({i for i in (_int_id(m.get("contactId") or m.get("id")) for m in members) if i is not None})
    contacts: list[dict[str, Any]] = []
    for i in range(0, len(ids), 40):
        batch = ids[i:i + 40]
        groups = [{"conditions": [{"parameter": "Contact Id", "operator": "Is", "value": str(c)}]} for c in batch]
        contacts.extend(client.paged_query(FULL_CONTACT, {"groups": groups}, 200))
    return contacts


def note_window_body(start: dt.date, end: dt.date) -> dict[str, Any]:
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Note Date", "operator": "OnOrAfter", "value": start.isoformat()},
                    {"parameter": "Note Date", "operator": "OnOrBefore", "value": end.isoformat()},
                ]
            }
        ]
    }


def fetch_notes_window(client: VirtuousClient, start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """Note Date window, no type filter. On an error the window is split in
    half and retried (mas pipeline _paged_query_with_date_fallback)."""
    try:
        return client.paged_query(NOTE_QUERY, note_window_body(start, end), NOTE_PAGE)
    except (VirtuousHttpError, VirtuousTimeout):
        if start >= end:
            raise
        mid = start + dt.timedelta(days=(end - start).days // 2)
        log(f"  notes window {start}..{end} failed; splitting at {mid}")
        return fetch_notes_window(client, start, mid) + fetch_notes_window(client, mid + dt.timedelta(days=1), end)


def fetch_creator_notes(client: VirtuousClient, mgos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """All-time notes per MGO creator (portfolios fetch_activity_for_users
    pattern), for lastMgoActivityDate on contacts with no FY note."""
    out: list[dict[str, Any]] = []
    for m in mgos:
        # ROSTER stamps are "First Last"; otherwise drop middle initials.
        tokens = (m.get("createdByUser") or m["key"]).split()
        if len(tokens) < 2:
            continue
        first, last = tokens[0], tokens[-1]
        body = {
            "groups": [
                {
                    "conditions": [
                        {"parameter": "Creator First Name", "operator": "Is", "value": first},
                        {"parameter": "Creator Last Name", "operator": "Is", "value": last},
                    ]
                }
            ]
        }
        try:
            rows = client.paged_query(NOTE_QUERY, body, NOTE_PAGE)
        except (VirtuousHttpError, VirtuousTimeout) as exc:
            log(f"  creator notes query failed for one MGO ({type(exc).__name__}); continuing")
            continue
        out.extend(rows)
        log(f"  creator notes: {len(rows)} rows")
    return out


def gift_window_query(start: dt.date, end: dt.date) -> dict[str, Any]:
    return {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Gift Date", "operator": "OnOrAfter", "value": start.isoformat()},
                    {"parameter": "Gift Date", "operator": "OnOrBefore", "value": end.isoformat()},
                ]
            }
        ],
        "sortBy": "Id",
        "descending": False,
    }


def fetch_common(client: VirtuousClient, today: dt.date) -> dict[str, Any]:
    _fy, fy_start, _fy_end = fiscal_year_window(today)
    groups = [g for g in client.paged_get(GROUP_PATH, 1000) if is_mgo_portfolio(g.get("name") or "")]
    log(f"  MGO portfolio groups: {len(groups)}")
    contacts_by_group: dict[Any, list[dict[str, Any]]] = {}
    for g in groups:
        rows = _full_contacts_for_group(client, g)
        contacts_by_group[g.get("id")] = rows
        log(f"    group {g.get('id')}: {len(rows)} contacts")
    asks = client.paged_query(ASK_PATH, {"groups": []}, 1000)
    log(f"  gift asks: {len(asks)}")
    fy_notes = fetch_notes_window(client, fy_start, today)
    log(f"  FY contact notes: {len(fy_notes)}")
    return {"groups": groups, "contacts_by_group": contacts_by_group, "asks": asks, "fy_notes": fy_notes}


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


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del context
    mode = (event or {}).get("mode") if isinstance(event, dict) else None
    client = make_client()
    today = today_eastern()
    common = fetch_common(client, today)

    if mode == "discover":
        result = build_discovery(today=today, **common)
        log(f"  discover: noteTypes={len(result['noteTypesFy'])} requests={client.requests}")
        return result

    _fy, fy_start, _fy_end = fiscal_year_window(today)
    gifts = client.paged_query(FULL_GIFT_PATH, gift_window_query(fy_start, today), FULL_GIFT_PAGE)
    log(f"  FY gifts: {len(gifts)}")
    creator_notes = fetch_creator_notes(client, build_mgos(common["groups"]))
    snapshot = build_snapshot(today=today, gifts=gifts, creator_notes=creator_notes, **common)

    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    summary = {
        "cache": uri,
        "generated_at": snapshot["generated_at"],
        "asOf": snapshot["asOf"],
        "mgos": len(snapshot["mgos"]),
        "donors": len(snapshot["donors"]),
        "notes": len(snapshot["notes"]),
        "requests": client.requests,
    }
    log(
        f"  mgo-analysis mgos={summary['mgos']} donors={summary['donors']} "
        f"notes={summary['notes']} requests={client.requests}"
    )
    return summary
