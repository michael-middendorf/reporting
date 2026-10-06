"""Daily Chancellor's Gala ticket pull for MA Points.

Stripe checkouts on portal chancellors-gala are not posted to Virtuous.
This publisher writes points/gala-site-tickets.json. The Points gifts API
reads that object and falls back to the committed September snapshot.

The Stripe key stays in Secrets Manager (giving/app-iu1cSf). This module
never logs it.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

OUTPUT_KEY = "points/gala-site-tickets.json"
PORTAL = "chancellors-gala"
SEGMENT = "FYE27_GALA_1EV"
SEGMENT_NAME = "26-27 Chancellor's Gala"
STATUSES = {"succeeded", "processing"}
EASTERN = ZoneInfo("America/New_York")
KEEP_FIELDS = ("contactId", "contactName", "emailMatch", "giftId", "inVirtuous")


def stripe_secret() -> str:
    secret_id = os.environ.get("GIVING_STRIPE_SECRET_ID", "giving/app-iu1cSf")
    raw = s3_secrets().get_secret_value(SecretId=secret_id)["SecretString"]
    data = json.loads(raw)
    key = str(data.get("MAIN_STRIPE_KEY_SECRET") or "").strip()
    if not key:
        raise RuntimeError("MAIN_STRIPE_KEY_SECRET is missing")
    return key


def s3_secrets():
    import boto3

    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
    return boto3.client("secretsmanager", region_name=region)


def search_payment_intents(secret: str) -> list[dict[str, Any]]:
    query = f"metadata['portal']:'{PORTAL}'"
    page: str | None = None
    found: list[dict[str, Any]] = []
    while True:
        params = {"query": query, "limit": "100"}
        if page:
            params["page"] = page
        url = "https://api.stripe.com/v1/payment_intents/search?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {secret}"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
        found.extend(payload.get("data") or [])
        if not payload.get("has_more") or not payload.get("next_page"):
            return found
        page = payload["next_page"]


def ticket_from_intent(intent: dict[str, Any]) -> dict[str, Any] | None:
    status = str(intent.get("status") or "")
    if status not in STATUSES:
        return None
    received = int(intent.get("amount_received") or 0)
    amount = int(intent.get("amount") or 0)
    cents = received or (amount if status == "processing" else 0)
    if cents <= 0:
        return None
    meta = intent.get("metadata") or {}
    if str(meta.get("portal") or "") != PORTAL:
        return None
    created = int(intent.get("created") or 0)
    if created <= 0:
        return None
    day = datetime.fromtimestamp(created, EASTERN).date().isoformat()
    first = str(meta.get("first_name") or "").strip()
    last = str(meta.get("last_name") or "").strip()
    email = str(meta.get("email") or "").strip().lower()
    return {
        "paymentIntentId": intent["id"],
        "day": day,
        "firstName": first,
        "lastName": last,
        "email": email,
        "amountCents": cents,
        "inVirtuous": False,
        "status": status,
        "stripeName": f"{first} {last}".strip(),
    }


def index_known(tickets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    known: dict[str, dict[str, Any]] = {}
    for ticket in tickets:
        payment_id = str(ticket.get("paymentIntentId") or "")
        if payment_id:
            known[payment_id] = ticket
    return known


def apply_known_contacts(tickets: list[dict[str, Any]], prior: list[dict[str, Any]]) -> list[dict[str, Any]]:
    known = index_known(prior)
    for ticket in tickets:
        old = known.get(ticket["paymentIntentId"])
        if not old:
            continue
        for field in KEEP_FIELDS:
            if field not in old or old[field] in (None, ""):
                continue
            if field == "inVirtuous" and not old[field]:
                continue
            ticket[field] = old[field]
    return tickets


def load_seed() -> list[dict[str, Any]]:
    path = Path(__file__).with_name("gala-site-tickets.seed.json")
    if not path.exists():
        path = Path("gala-site-tickets.seed.json")
    if not path.exists():
        return []
    doc = json.loads(path.read_text())
    tickets = doc.get("tickets") if isinstance(doc, dict) else None
    return tickets if isinstance(tickets, list) else []


def load_previous() -> list[dict[str, Any]]:
    from common.s3util import data_bucket, s3

    try:
        obj = s3().get_object(Bucket=data_bucket(), Key=OUTPUT_KEY)
    except Exception as exc:
        code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
        if code in {"NoSuchKey", "404", "NotFound"}:
            return []
        raise
    doc = json.loads(obj["Body"].read().decode("utf-8"))
    tickets = doc.get("tickets") if isinstance(doc, dict) else None
    return tickets if isinstance(tickets, list) else []


def build_snapshot(intents: list[dict[str, Any]], prior: list[dict[str, Any]], pulled_at: str) -> dict[str, Any]:
    tickets = [row for row in (ticket_from_intent(intent) for intent in intents) if row]
    tickets.sort(key=lambda row: (row["day"], row["paymentIntentId"]))
    apply_known_contacts(tickets, prior)
    return {
        "pulledAt": pulled_at,
        "segment": SEGMENT,
        "segmentName": SEGMENT_NAME,
        "source": "stripe search metadata portal chancellors-gala",
        "tickets": tickets,
    }


def handler(_event: dict[str, Any], _context: Any) -> dict[str, Any]:
    prior = index_known(load_seed())
    prior.update(index_known(load_previous()))
    snapshot = build_snapshot(
        search_payment_intents(stripe_secret()),
        list(prior.values()),
        datetime.now(EASTERN).isoformat(),
    )
    from common.s3util import put_json

    put_json(OUTPUT_KEY, snapshot)
    fresh = {row["paymentIntentId"] for row in snapshot["tickets"]} - set(prior)
    return {"ok": True, "key": OUTPUT_KEY, "tickets": len(snapshot["tickets"]), "new": len(fresh)}
