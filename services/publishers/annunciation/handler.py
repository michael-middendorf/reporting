"""Annunciation Circle publisher.

Writes ``annunciation/latest.json`` to ReportData (feeds the ``/annunciation``
dashboard) and emails ``ANNUNCIATION_NOTIFY_EMAILS`` when new members are
detected.

Membership = the Virtuous tag "Annunciation Circle Member" (tag id 41). Virtuous
exposes no queryable "date this tag was applied", so new members are detected by
diffing member ids against the prior snapshot and stamping a ``firstSeen`` date.
The single ``annunciation/latest.json`` object is BOTH the frontend feed and the
diff state. The first run establishes a baseline (firstSeen = null, no emails);
detections only fire on later runs.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from common.s3util import data_bucket, put_json, s3

FULL_QUERY_PATH = "/api/Contact/Query/FullContact"
RECURRING_QUERY_PATH = "/api/RecurringGift/Query"
# The Annunciation Circle giving society is a recurring-gift project. A member's
# true "member since" date is the start date of their earliest recurring gift to
# this project (the tag itself was mass-applied on one day, so it is useless as a
# join date).
AC_PROJECT_NAME = "Annunciation Circle"
# Recurring-gift statuses that mean the commitment is no longer live.
INACTIVE_RECURRING = {"cancelled", "fulfilled"}
RETRYABLE = {429, 500, 502, 503, 504}


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
                raise RuntimeError(f"Virtuous {path} → {exc.code}: {detail}") from exc
        raise RuntimeError(f"Virtuous {path} failed after retries")


# ── member projection ────────────────────────────────────────────────────────

def _query_body(tag: str) -> dict[str, Any]:
    return {
        "groups": [
            {"conditions": [{"parameter": "Tag", "operator": "IsAnyOf", "values": [tag]}]}
        ]
    }


def _parse_money(value: Any) -> float | None:
    if value is None:
        return None
    s = str(value).replace("$", "").replace(",", "").strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def _pick_method(individuals: list[dict[str, Any]], keyword: str) -> str | None:
    """First matching contact-method value, preferring the primary individual + primary method."""
    best: str | None = None
    for indiv in sorted(individuals, key=lambda i: not i.get("isPrimary")):
        for m in indiv.get("contactMethods") or []:
            if keyword in str(m.get("type", "")).lower() and m.get("value"):
                if m.get("isPrimary"):
                    return m["value"]
                best = best or m["value"]
    return best


def _format_location(addr: dict[str, Any]) -> str | None:
    city = (addr.get("city") or "").strip()
    state = (addr.get("state") or "").strip()
    if city and state:
        return f"{city}, {state}"
    return city or state or None


def _format_address(addr: dict[str, Any]) -> str | None:
    line1 = (addr.get("address1") or "").strip()
    loc = _format_location(addr) or ""
    postal = (addr.get("postal") or "").strip()
    tail = " ".join(p for p in [loc, postal] if p)
    full = ", ".join(p for p in [line1, tail] if p)
    return full or None


def project_member(c: dict[str, Any]) -> dict[str, Any]:
    individuals = c.get("contactIndividuals") or []
    addr = c.get("address") or {}
    cid = c.get("id")
    return {
        "id": cid,
        "name": c.get("name") or c.get("formalContactName"),
        "contactType": c.get("contactType"),
        "email": _pick_method(individuals, "email"),
        "phone": _pick_method(individuals, "phone"),
        "location": _format_location(addr),
        "address": _format_address(addr),
        "lifeToDateGiving": c.get("lifeToDateGiving"),
        "lifeToDateGivingNum": _parse_money(c.get("lifeToDateGiving")),
        "yearToDateGiving": c.get("yearToDateGiving"),
        "yearToDateGivingNum": _parse_money(c.get("yearToDateGiving")),
        "lastGiftAmount": c.get("lastGiftAmount"),
        "lastGiftDate": c.get("lastGiftDate"),
        "giftAskAmount": c.get("giftAskAmount"),
        "createDateUtc": c.get("createDateTimeUtc"),
        "contactUrl": f"https://app.virtuoussoftware.com/Generosity/Contact/View/{cid}",
    }


# ── recurring-gift "member since" enrichment ─────────────────────────────────

def _recurring_query_body(project_name: str) -> dict[str, Any]:
    return {
        "groups": [
            {"conditions": [{"parameter": "Project Name", "operator": "Is", "value": project_name}]}
        ]
    }


def _is_active_recurring(status: Any) -> bool:
    return (str(status or "")).strip().lower() not in INACTIVE_RECURRING


def recurring_by_contact(
    client: VirtuousClient, project_name: str, page_size: int
) -> dict[str, dict[str, Any]]:
    """Map contactId(str) -> {startDate (earliest), recurring amount/frequency/status
    of the member's most relevant gift (active preferred, else latest)}."""
    rows = client.paged_query(RECURRING_QUERY_PATH, _recurring_query_body(project_name), page_size)
    agg: dict[str, dict[str, Any]] = {}
    for r in rows:
        cid = r.get("contactId")
        if cid is None:
            continue
        key = str(cid)
        start = ((r.get("startDate") or r.get("recurringGiftDate") or "")[:10]) or None
        cand = {
            "amount": r.get("amount"),
            "frequency": r.get("frequency"),
            "status": r.get("status"),
            "start": start,
        }
        entry = agg.get(key)
        if entry is None:
            agg[key] = {"startDate": start, "current": cand}
            continue
        # earliest start = member-since
        if start and (entry["startDate"] is None or start < entry["startDate"]):
            entry["startDate"] = start
        # current gift = active beats inactive, then later start wins
        cur = entry["current"]
        cand_active, cur_active = _is_active_recurring(cand["status"]), _is_active_recurring(cur["status"])
        if cand_active != cur_active:
            better = cand_active
        else:
            better = (cand["start"] or "") > (cur["start"] or "")
        if better:
            entry["current"] = cand
    out: dict[str, dict[str, Any]] = {}
    for key, e in agg.items():
        c = e["current"] or {}
        out[key] = {
            "startDate": e["startDate"],
            "recurringAmount": c.get("amount"),
            "recurringFrequency": c.get("frequency"),
            "recurringStatus": c.get("status"),
        }
    return out


# ── snapshot diff ────────────────────────────────────────────────────────────

def _read_prior(bucket: str, key: str) -> dict[str, Any] | None:
    client = s3()
    try:
        out = client.get_object(Bucket=bucket, Key=key)
    except client.exceptions.NoSuchKey:
        return None
    except Exception as exc:  # noqa: BLE001 - treat a missing/unreadable object as "no prior"
        if "NoSuchKey" in type(exc).__name__ or "NoSuchKey" in str(exc) or "404" in str(exc):
            return None
        raise
    return json.loads(out["Body"].read().decode("utf-8"))


def reconcile(
    current: list[dict[str, Any]],
    prior: dict[str, Any] | None,
    today: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    """Assign firstSeen on each current member; return (members, new_members, baseline)."""
    prior_index = {
        str(m["id"]): m for m in (prior or {}).get("members", []) if m.get("id") is not None
    }
    baseline = not prior_index
    new_members: list[dict[str, Any]] = []
    for m in current:
        mid = str(m["id"])
        if mid in prior_index:
            m["firstSeen"] = prior_index[mid].get("firstSeen")
        elif baseline:
            m["firstSeen"] = None
        else:
            m["firstSeen"] = today
            new_members.append(m)
    return current, new_members, baseline


# ── notification (Resend) ────────────────────────────────────────────────────

def _fmt_member(m: dict[str, Any]) -> str:
    parts = [m.get("name") or f"Contact {m.get('id')}"]
    if m.get("email"):
        parts.append(m["email"])
    if m.get("location"):
        parts.append(m["location"])
    if m.get("startDate"):
        parts.append(f"member since {m['startDate']}")
    return " — ".join(parts)


def notify_new_members(new_members: list[dict[str, Any]]) -> dict[str, Any]:
    if not new_members:
        return {"sent": False, "reason": "no-new-members"}

    api_key = (os.environ.get("RESEND_API_KEY") or "").strip()
    recipients = [
        e.strip()
        for e in (os.environ.get("ANNUNCIATION_NOTIFY_EMAILS") or "").split(",")
        if e.strip()
    ]
    email_from = os.environ.get(
        "EMAIL_FROM", "AMU Project Manager <noreply@notifications.avemaria.edu>"
    )
    base = (os.environ.get("APP_BASE_URL") or "").rstrip("/")
    n = len(new_members)
    noun = "member" if n == 1 else "members"

    lines = [_fmt_member(m) for m in new_members]
    text = (
        f"{n} new Annunciation Circle {noun} just joined:\n\n"
        + "\n".join(f"- {ln}" for ln in lines)
        + (f"\n\nView the member dashboard: {base}/annunciation\n" if base else "\n")
    )

    if not api_key or not recipients:
        print(
            "Annunciation notify (not sent — no API key or no recipients configured):\n" + text,
            flush=True,
        )
        return {"sent": False, "reason": "not-configured", "count": n}

    items = "".join(f"<li>{_fmt_member(m)}</li>" for m in new_members)
    link = f'<p><a href="{base}/annunciation">Open the member dashboard</a></p>' if base else ""
    html = f"<p><strong>{n} new Annunciation Circle {noun}</strong> just joined:</p><ul>{items}</ul>{link}"

    body = json.dumps(
        {
            "from": email_from,
            "to": recipients,
            "subject": f"Annunciation Circle: {n} new {noun}",
            "html": html,
            "text": text,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        print(f"Annunciation notify FAILED: Resend {exc.code}: {detail}", flush=True)
        return {"sent": False, "reason": f"resend-{exc.code}", "count": n}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"Annunciation notify FAILED: {exc}", flush=True)
        return {"sent": False, "reason": "network", "count": n}

    print(f"Annunciation notify sent to {len(recipients)} recipient(s): {n} new {noun}.", flush=True)
    return {"sent": True, "count": n, "recipients": len(recipients)}


# ── entrypoint ───────────────────────────────────────────────────────────────

def handler(event, context):  # noqa: ANN001, ARG001 - AWS signature
    api_key = os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        raise RuntimeError("VIRTUOUS_API_KEY required")
    base = os.environ.get("VIRTUOUS_BASE_URL", "https://api.virtuoussoftware.com")
    tag = os.environ.get("ANNUNCIATION_MEMBER_TAG", "Annunciation Circle Member")
    key = os.environ.get("ANNUNCIATION_CACHE_KEY", "annunciation/latest.json")
    page_size = int(os.environ.get("PAGE_SIZE", "1000"))
    bucket = data_bucket()

    client = VirtuousClient(api_key, base)
    print(f"Fetching contacts tagged '{tag}' (full detail)...", flush=True)
    rows = client.paged_query(FULL_QUERY_PATH, _query_body(tag), page_size)
    members = [project_member(r) for r in rows if r.get("id") is not None]
    print(f"  members fetched: {len(members)}", flush=True)

    # Enrich with the real "member since" date = earliest Annunciation Circle
    # recurring-gift start date (plus current recurring amount/frequency/status).
    print("Fetching Annunciation Circle recurring gifts...", flush=True)
    recurring = recurring_by_contact(client, AC_PROJECT_NAME, page_size)
    matched = 0
    for m in members:
        info = recurring.get(str(m["id"]))
        m["startDate"] = info["startDate"] if info else None
        m["recurringAmount"] = info["recurringAmount"] if info else None
        m["recurringFrequency"] = info["recurringFrequency"] if info else None
        m["recurringStatus"] = info["recurringStatus"] if info else None
        if info:
            matched += 1
    print(f"  recurring gifts matched to {matched}/{len(members)} members", flush=True)

    prior = _read_prior(bucket, key)
    today = dt.date.today().isoformat()
    members, new_members, baseline = reconcile(members, prior, today)

    snapshot = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "tag": tag,
        "total": len(members),
        "baseline": baseline,
        "members": members,
    }
    uri = put_json(key, snapshot, bucket=bucket)
    print(f"  put {uri}", flush=True)

    if new_members:
        print(f"  NEW members detected: {len(new_members)}", flush=True)
        notify = notify_new_members(new_members)
    else:
        notify = {"sent": False, "reason": "baseline" if baseline else "no-new-members"}
        print("  no new members" + (" (baseline run)" if baseline else ""), flush=True)

    return {
        "ok": True,
        "source": "annunciation",
        "total": len(members),
        "baseline": baseline,
        "new_member_count": len(new_members),
        "notify": notify,
    }
