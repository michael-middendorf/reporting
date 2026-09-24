"""Stained-glass window naming publisher.

Expands the lumped Chapel Naming "Small Stained Glass Window" row into the
named windows on Virtuous gift field "4 Naming Opportunity": 1 rose window,
12 sanctuary windows ($25,000), and 26 nave windows ($35,000).

Gifts still tagged with the grouped SMALL STAINED GLASS WINDOW pick are
assigned by field "5 Naming Opportunity Specifics" when that value matches a
named window. Unmatched grouped gifts land in an Unspecified bucket.

Writes ``stained-glass-windows/latest.json``.
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
from collections import defaultdict
from pathlib import Path
from typing import Any

FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
CHAPEL_PROJECTS = {"AMU Student Chapel", "Mary, Mother of the Eucharist Chapel"}
NAMING_FIELD = "4 Naming Opportunity"
SPECIFICS_FIELD = "5 Naming Opportunity Specifics"
CACHE_KEY = os.environ.get("STAINED_GLASS_WINDOWS_CACHE_KEY") or "stained-glass-windows/latest.json"
RETRYABLE = {429, 500, 502, 503, 504}
CONTACT_VIEW = "https://app.virtuoussoftware.com/Generosity/Contact/View"
GROUPED_OBJECT = "SMALL STAINED GLASS WINDOW"
UNSPECIFIED_ID = "unspecified"

GROUP_META = {
    "rose": {"label": "Rose Window", "sort": 0},
    "sanctuary": {"label": "Sanctuary windows", "sort": 1},
    "nave": {"label": "Nave windows", "sort": 2},
    "unspecified": {"label": "Unspecified", "sort": 9},
}

DEFINITION = (
    "Named stained-glass windows from Virtuous gift field 4 Naming Opportunity "
    "(1 rose, 12 sanctuary at $25,000, 26 nave at $35,000). Gifts still tagged "
    "with the grouped Small Stained Glass Window pick are assigned by field 5 "
    "Naming Opportunity Specifics when present."
)

_AMOUNT_RE = re.compile(r"\$\s*([\d,]+(?:\.\d+)?)")
_STOP = {"the", "of", "at", "in", "and", "our", "a"}
_SPECIFICS_PREFIXES = (
    "student chapel stained glass window -",
    "student chapel saints in nave -",
)


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = 100) -> list[dict]:
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


def chapel_object_from_naming(value: str | None) -> str | None:
    """Mirror the Qlik parse of 'STUDENT CHAPEL - ITEM $1,000 (1)'."""
    if not value:
        return None
    start = value.find("- ")
    dollar = value.find(" $")
    if start < 0 or dollar < 0 or dollar <= start + 2:
        return None
    key = value[start + 2 : dollar].strip().upper()
    return key or None


def fold(value: str | None) -> str:
    text = (value or "").lower().replace("st.", "st ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(w for w in text.split() if w and w not in _STOP)


def window_id(group: str, item: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (item or "").lower()).strip("-")
    return f"{group}-{slug}" if slug else group


def specifics_subject(raw: str | None) -> str | None:
    text = " ".join((raw or "").split())
    if not text:
        return None
    lower = text.lower()
    for prefix in _SPECIFICS_PREFIXES:
        if lower.startswith(prefix):
            rest = text[len(prefix) :].strip()
            return rest or None
    return text


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


def _gift_date(gift: dict[str, Any]) -> str | None:
    raw = gift.get("giftDateFormatted") or gift.get("giftDate")
    if not raw:
        return None
    text = str(raw)
    if "T" in text:
        return text.split("T", 1)[0]
    return text


def _donor_name(gift: dict[str, Any]) -> str | None:
    passthroughs = gift.get("giftPassthroughs") or []
    if passthroughs:
        name = passthroughs[0].get("contactName")
        if name:
            return str(name)
    return gift.get("contactName")


def _custom(gift: dict[str, Any], name: str) -> str | None:
    for field in gift.get("customFields") or []:
        if field.get("name") == name:
            value = field.get("value")
            return str(value) if value else None
    return None


def _contact_url(cid: Any) -> str | None:
    if cid is None or cid == "":
        return None
    return f"{CONTACT_VIEW}/{cid}"


def _parse_amount(raw: str | None) -> float | None:
    found = _AMOUNT_RE.search(raw or "")
    if not found:
        return None
    return _num(found.group(1))


def load_inventory() -> list[dict[str, Any]]:
    env = (os.environ.get("STAINED_GLASS_WINDOWS_INVENTORY") or "").strip()
    candidates = []
    if env:
        candidates.append(Path(env))
    here = Path(__file__).resolve().parent
    candidates.extend(
        [
            here / "windows.json",
            Path("/var/task/windows.json"),
            Path.cwd() / "windows.json",
        ]
    )
    for path in candidates:
        if path.is_file():
            return json.loads(path.read_text())
    tried = ", ".join(str(p) for p in candidates)
    raise FileNotFoundError(f"stained-glass windows.json not found (tried {tried})")


def _is_window_object(chapel_object: str | None) -> bool:
    if not chapel_object:
        return False
    if chapel_object in {GROUPED_OBJECT, "ROSE WINDOW"}:
        return True
    return chapel_object.startswith("NAVE WINDOW") or chapel_object.startswith("SANCTUARY WINDOW")


def match_window(
    chapel_object: str | None,
    specifics: str | None,
    by_object: dict[str, dict[str, Any]],
    by_fold: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the inventory row this gift belongs to, or None to skip."""
    key = chapel_object or ""
    if key and key != GROUPED_OBJECT and key in by_object:
        return by_object[key]
    subject = specifics_subject(specifics)
    folded = fold(subject)
    if folded and folded in by_fold:
        return by_fold[folded]
    if key == GROUPED_OBJECT:
        return {"id": UNSPECIFIED_ID}
    if _is_window_object(key):
        return {"id": f"extra:{key}", "chapelObject": key, "extra": True}
    if folded:
        return {"id": UNSPECIFIED_ID}
    return None


def _gift_payload(
    gift: dict[str, Any],
    raw: str | None,
    specifics: str | None,
    project: str | None,
    anonymous_ids: frozenset[str] | None,
) -> dict[str, Any]:
    from common.anonymous_donors import gift_contact_ids, is_anonymous_donor

    cid = gift.get("contactId")
    return {
        "id": gift.get("id"),
        "contactId": cid,
        "donorName": _donor_name(gift),
        "anonymousDonor": is_anonymous_donor(gift_contact_ids(gift), anonymous_ids),
        "contactUrl": _contact_url(cid),
        "amount": round(_num(gift.get("amount")), 2),
        "giftDate": _gift_date(gift),
        "project": project,
        "specifics": specifics,
        "namingOpportunity": raw,
    }


def _window_payload(
    row: dict[str, Any],
    gifts: list[dict[str, Any]],
    *,
    from_inventory: bool,
) -> dict[str, Any]:
    received = round(sum(g["amount"] for g in gifts), 2)
    funding = row.get("fundingRequest")
    pct = round(100.0 * received / funding, 1) if funding else None
    remaining = round(funding - received, 2) if funding is not None else None
    donors = {g.get("contactId") for g in gifts if g.get("contactId") is not None}
    group = row["group"]
    item = row["item"]
    return {
        "id": row["id"],
        "group": group,
        "groupLabel": GROUP_META.get(group, {}).get("label") or group,
        "item": item,
        "chapelObject": row.get("chapelObject"),
        "quantity": row.get("quantity") or 1,
        "itemAmount": row.get("itemAmount"),
        "fundingRequest": funding,
        "fromInventory": from_inventory,
        "amountReceived": received,
        "remaining": remaining,
        "pctReceived": pct,
        "giftCount": len(gifts),
        "donorCount": len(donors),
        "gifts": sorted(gifts, key=lambda g: (g.get("giftDate") or ""), reverse=True),
    }


def _group_summary(windows: list[dict[str, Any]]) -> dict[str, Any]:
    inv = [w for w in windows if w["fromInventory"]]
    request = sum(w["fundingRequest"] or 0 for w in inv)
    received = sum(w["amountReceived"] for w in windows)
    funded = sum(
        1
        for w in inv
        if w["fundingRequest"] and w["amountReceived"] >= w["fundingRequest"] - 0.005
    )
    partial = sum(
        1
        for w in inv
        if w["amountReceived"] > 0
        and not (w["fundingRequest"] and w["amountReceived"] >= w["fundingRequest"] - 0.005)
    )
    unfunded = sum(1 for w in inv if w["amountReceived"] <= 0)
    return {
        "windowCount": len(inv),
        "extraWindowCount": len(windows) - len(inv),
        "fundingRequest": round(request, 2),
        "amountReceived": round(received, 2),
        "pctReceived": round(100.0 * received / request, 1) if request else 0,
        "fullyFunded": funded,
        "partial": partial,
        "unfunded": unfunded,
    }


def build_snapshot(
    gifts: list[dict[str, Any]],
    inventory: list[dict[str, Any]],
    *,
    anonymous_ids: frozenset[str] | None = None,
) -> dict[str, Any]:
    prepared: list[dict[str, Any]] = []
    by_object: dict[str, dict[str, Any]] = {}
    by_fold: dict[str, dict[str, Any]] = {}
    for raw_row in inventory:
        group = raw_row["group"]
        item = raw_row["item"]
        amount = _num(raw_row.get("itemAmount"))
        row = {
            "id": window_id(group, item),
            "group": group,
            "item": item,
            "chapelObject": (raw_row.get("chapelObject") or "").upper(),
            "quantity": 1,
            "itemAmount": amount,
            "fundingRequest": amount,
        }
        prepared.append(row)
        if row["chapelObject"]:
            by_object[row["chapelObject"]] = row
        folded = fold(item)
        if folded:
            by_fold[folded] = row

    by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    extras: dict[str, dict[str, Any]] = {}
    skipped_project = 0
    skipped_not_window = 0
    for gift in gifts:
        dens = gift.get("giftDesignations") or []
        chapel_des = [d for d in dens if (d.get("project") or "") in CHAPEL_PROJECTS]
        if not chapel_des:
            skipped_project += 1
            continue
        raw = _custom(gift, NAMING_FIELD)
        specifics = _custom(gift, SPECIFICS_FIELD)
        chapel_object = chapel_object_from_naming(raw)
        matched = match_window(chapel_object, specifics, by_object, by_fold)
        if matched is None:
            skipped_not_window += 1
            continue
        payload = _gift_payload(gift, raw, specifics, chapel_des[0].get("project"), anonymous_ids)
        mid = matched["id"]
        if matched.get("extra"):
            extras[mid] = matched
        by_id[mid].append(payload)

    windows: list[dict[str, Any]] = []
    for row in prepared:
        windows.append(_window_payload(row, by_id.get(row["id"], []), from_inventory=True))

    unspecified_gifts = by_id.get(UNSPECIFIED_ID, [])
    if unspecified_gifts:
        windows.append(
            _window_payload(
                {
                    "id": UNSPECIFIED_ID,
                    "group": "unspecified",
                    "item": "Unspecified small stained glass",
                    "chapelObject": GROUPED_OBJECT,
                    "quantity": None,
                    "itemAmount": None,
                    "fundingRequest": None,
                },
                unspecified_gifts,
                from_inventory=False,
            )
        )

    for extra_id, extra in extras.items():
        key = extra.get("chapelObject") or extra_id
        amount = None
        raw_name = None
        gift_rows = by_id.get(extra_id, [])
        if gift_rows:
            raw_name = gift_rows[0].get("namingOpportunity")
            amount = _parse_amount(raw_name)
        label = key
        if label.startswith("NAVE WINDOW - "):
            label = key[len("NAVE WINDOW - ") :].title()
            group = "nave"
        elif label.startswith("SANCTUARY WINDOW - "):
            label = key[len("SANCTUARY WINDOW - ") :].title()
            group = "sanctuary"
        else:
            group = "unspecified"
        windows.append(
            _window_payload(
                {
                    "id": extra_id,
                    "group": group,
                    "item": label.title() if label == label.upper() else label,
                    "chapelObject": key,
                    "quantity": 1,
                    "itemAmount": amount,
                    "fundingRequest": amount,
                },
                gift_rows,
                from_inventory=False,
            )
        )

    windows.sort(
        key=lambda w: (
            GROUP_META.get(w["group"], {}).get("sort", 50),
            0 if w["fromInventory"] else 1,
            (w["item"] or "").lower(),
        )
    )

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for w in windows:
        groups[w["group"]].append(w)

    group_rows = []
    for gid, meta in sorted(GROUP_META.items(), key=lambda kv: kv[1]["sort"]):
        members = groups.get(gid, [])
        if not members:
            continue
        stats = _group_summary(members)
        group_rows.append(
            {
                "id": gid,
                "label": meta["label"],
                **stats,
                "windows": members,
            }
        )

    all_inv = [w for w in windows if w["fromInventory"]]
    summary = _group_summary(windows)
    donors: set[Any] = set()
    gift_ids: set[Any] = set()
    for w in windows:
        for g in w["gifts"]:
            if g.get("contactId") is not None:
                donors.add(g["contactId"])
            if g.get("id") is not None:
                gift_ids.add(g["id"])
    summary["giftCount"] = len(gift_ids)
    summary["donorCount"] = len(donors)
    summary["windowCount"] = len(all_inv)

    print(
        f"  stained glass: inventory={len(inventory)} gifts_in={len(gifts)} "
        f"skipped_project={skipped_project} skipped_not_window={skipped_not_window} "
        f"windows={len(windows)} received={summary['amountReceived']:.2f}",
        flush=True,
    )

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "virtuous",
        "chapelProjects": sorted(CHAPEL_PROJECTS),
        "definition": DEFINITION,
        "summary": summary,
        "groups": group_rows,
        "windows": windows,
        "skipped": {
            "project": skipped_project,
            "notWindow": skipped_not_window,
        },
    }


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
    if not key:
        raise RuntimeError("VIRTUOUS_API_KEY is required")
    client = VirtuousClient(key, os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com")
    gifts = client.paged_query(
        FULL_GIFT_PATH,
        {"groups": [{"conditions": [{"parameter": NAMING_FIELD, "operator": "IsKnown"}]}]},
        page_size=100,
    )
    print(f"  stained glass gifts fetched: {len(gifts)}", flush=True)
    from common.anonymous_donors import anonymous_contact_ids

    snapshot = build_snapshot(gifts, load_inventory(), anonymous_ids=anonymous_contact_ids(client))
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
