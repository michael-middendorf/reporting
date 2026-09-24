"""Chapel naming-opportunities publisher.

Joins the Advancement naming-opportunity catalog (the 69 items from the Qlik
"Chapel Naming Opportunities" table) to Virtuous gifts whose custom field
"4 Naming Opportunity" is set, counting only designations to AMU Student Chapel
or Mary, Mother of the Eucharist Chapel — the same definition as the Qlik sheet.

Writes ``chapel-naming/latest.json`` and returns the snapshot so the reporting
API can invoke this function on a cache miss.
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

from common.anonymous_donors import anonymous_contact_ids, gift_contact_ids, is_anonymous_donor
from common.s3util import data_bucket, put_json

FULL_GIFT_PATH = "/api/Gift/Query/FullGift"
CHAPEL_PROJECTS = {"AMU Student Chapel", "Mary, Mother of the Eucharist Chapel"}
NAMING_FIELD = "4 Naming Opportunity"
SPECIFICS_FIELD = "5 Naming Opportunity Specifics"
CACHE_KEY = os.environ.get("CHAPEL_NAMING_CACHE_KEY") or "chapel-naming/latest.json"
RETRYABLE = {429, 500, 502, 503, 504}

# Gift chapel_object values that do not match the catalog string exactly.
OBJECT_ALIASES = {
    "ST. PETER STATUE & FOUNTAIN": "ST. PETER STATUS & FOUNTAIN",
    "AUDIO/VISUAL AND SOUND EQUIPMENT": "AUDIO/VIDEO AND SOUND EQUIPMENT",
    "ALTAR BELL": "ALTAR BELLS",
    "PROFESSIONAL CRUCIFIX & STAND": "PROCESSIONAL CRUCIFIX & STAND",
    "DEACON CHAIR": "DEACON'S CHAIR",
    "PRESIDERS CHAIR": "PRESIDER'S CHAIR",
}

_AMOUNT_RE = re.compile(r"\$\s*([\d,]+(?:\.\d+)?)")
_QTY_RE = re.compile(r"\((\d+)\)\s*$")


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
    return OBJECT_ALIASES.get(key, key) or None


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


def _parse_naming_meta(raw: str) -> tuple[float | None, int | None]:
    amount = None
    found = _AMOUNT_RE.search(raw or "")
    if found:
        amount = _num(found.group(1))
    qty = None
    found_qty = _QTY_RE.search(raw or "")
    if found_qty:
        qty = int(found_qty.group(1))
    return amount, qty


def _item_label_from_naming(raw: str, chapel_object: str) -> str:
    start = raw.find("- ")
    dollar = raw.find(" $")
    if start >= 0 and dollar > start + 2:
        return raw[start + 2 : dollar].strip()
    return chapel_object.title()


def load_catalog() -> list[dict[str, Any]]:
    env = (os.environ.get("CHAPEL_NAMING_CATALOG") or "").strip()
    candidates = []
    if env:
        candidates.append(Path(env))
    here = Path(__file__).resolve().parent
    candidates.extend(
        [
            here / "catalog.json",
            Path("/var/task/catalog.json"),
            Path.cwd() / "catalog.json",
        ]
    )
    for path in candidates:
        if path.is_file():
            return json.loads(path.read_text())
    tried = ", ".join(str(p) for p in candidates)
    raise FileNotFoundError(f"chapel naming catalog.json not found (tried {tried})")


def build_snapshot(
    gifts: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    *,
    anonymous_ids: frozenset[str] | None = None,
) -> dict[str, Any]:
    by_object: dict[str, list[dict[str, Any]]] = defaultdict(list)
    skipped_project = 0
    skipped_parse = 0
    for gift in gifts:
        dens = gift.get("giftDesignations") or []
        chapel_des = [d for d in dens if (d.get("project") or "") in CHAPEL_PROJECTS]
        if not chapel_des:
            skipped_project += 1
            continue
        raw = _custom(gift, NAMING_FIELD)
        key = chapel_object_from_naming(raw)
        if not key:
            skipped_parse += 1
            continue
        project = chapel_des[0].get("project")
        by_object[key].append(
            {
                "id": gift.get("id"),
                "contactId": gift.get("contactId"),
                "donorName": _donor_name(gift),
                "anonymousDonor": is_anonymous_donor(gift_contact_ids(gift), anonymous_ids),
                "amount": round(_num(gift.get("amount")), 2),
                "giftDate": _gift_date(gift),
                "project": project,
                "specifics": _custom(gift, SPECIFICS_FIELD),
                "namingOpportunity": raw,
            }
        )

    catalog_keys = {row["chapelObject"] for row in catalog}
    items: list[dict[str, Any]] = []
    for row in catalog:
        items.append(_item_payload(row, by_object.get(row["chapelObject"], []), from_catalog=True))

    for key, gift_rows in sorted(by_object.items()):
        if key in catalog_keys:
            continue
        raw = gift_rows[0].get("namingOpportunity") or key
        amount, qty = _parse_naming_meta(raw)
        funding = None
        if amount is not None and qty:
            funding = amount * qty
        elif amount is not None:
            funding = amount
        items.append(
            _item_payload(
                {
                    "item": _item_label_from_naming(raw, key),
                    "chapelObject": key,
                    "quantity": qty,
                    "itemAmount": amount,
                    "fundingRequest": funding,
                    "type": None,
                    "setNote": None,
                },
                gift_rows,
                from_catalog=False,
            )
        )

    items.sort(key=lambda r: (r["item"] or "").lower())

    funding = sum(i["fundingRequest"] or 0 for i in items if i["fromCatalog"])
    received = sum(i["amountReceived"] for i in items)
    fully = sum(1 for i in items if i["fundingRequest"] and i["amountReceived"] >= i["fundingRequest"] - 0.005)
    partial = sum(1 for i in items if i["amountReceived"] > 0 and not (i["fundingRequest"] and i["amountReceived"] >= i["fundingRequest"] - 0.005))
    unfunded = sum(1 for i in items if i["fromCatalog"] and i["amountReceived"] <= 0)
    donors: set[Any] = set()
    gift_ids: set[Any] = set()
    for i in items:
        for g in i["gifts"]:
            if g.get("contactId") is not None:
                donors.add(g["contactId"])
            if g.get("id") is not None:
                gift_ids.add(g["id"])

    print(
        f"  chapel naming: catalog={len(catalog)} gifts_in={len(gifts)} "
        f"skipped_project={skipped_project} skipped_parse={skipped_parse} "
        f"items={len(items)} received={received:.2f}",
        flush=True,
    )

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "virtuous",
        "chapelProjects": sorted(CHAPEL_PROJECTS),
        "summary": {
            "itemCount": len([i for i in items if i["fromCatalog"]]),
            "extraItemCount": len([i for i in items if not i["fromCatalog"]]),
            "fundingRequest": round(funding, 2),
            "amountReceived": round(received, 2),
            "pctReceived": round(100.0 * received / funding, 1) if funding else 0,
            "fullyFunded": fully,
            "partial": partial,
            "unfunded": unfunded,
            "giftCount": len(gift_ids),
            "donorCount": len(donors),
        },
        "items": items,
    }


def _item_payload(row: dict[str, Any], gifts: list[dict[str, Any]], *, from_catalog: bool) -> dict[str, Any]:
    received = round(sum(g["amount"] for g in gifts), 2)
    funding = row.get("fundingRequest")
    pct = round(100.0 * received / funding, 1) if funding else None
    donors = {g.get("contactId") for g in gifts if g.get("contactId") is not None}
    return {
        "item": row.get("item"),
        "chapelObject": row.get("chapelObject"),
        "quantity": row.get("quantity"),
        "itemAmount": row.get("itemAmount"),
        "fundingRequest": funding,
        "type": row.get("type"),
        "setNote": row.get("setNote"),
        "fromCatalog": from_catalog,
        "amountReceived": received,
        "pctReceived": pct,
        "giftCount": len(gifts),
        "donorCount": len(donors),
        "gifts": sorted(gifts, key=lambda g: (g.get("giftDate") or ""), reverse=True),
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
    print(f"  chapel naming gifts fetched: {len(gifts)}", flush=True)
    snapshot = build_snapshot(gifts, load_catalog(), anonymous_ids=anonymous_contact_ids(client))
    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
