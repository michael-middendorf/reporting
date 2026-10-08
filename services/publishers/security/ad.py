"""AD security counts feed for the cybersecurity dashboard (IT-3, PR 2).

PR 4 builds the campus PowerShell script (Publish-AdSecurityCounts.ps1) that
drops counts-only JSON at cybersecurity/inbox/ad/*.json in the ReportData
bucket. This module only *reads* the newest of those files: it never talks
to AD directly.

Two defenses, both required by the plan:
  * Allowlist: only a fixed set of numeric keys is ever passed through. Any
    other field in the inbox file is dropped. If an allowlisted key is
    present with a non-numeric (e.g. string) value, the whole file is
    rejected rather than silently dropping just that field, since a stray
    string under a numeric key is exactly the shape a name/UPN leak would
    take.
  * Freshness: status is "stale" (not "ok") when the newest file is more
    than 48 hours old, so a broken scheduled task shows up on the dashboard
    instead of silently going quiet.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from common.s3util import data_bucket
from common.s3util import s3 as s3_client_factory

INBOX_PREFIX = "cybersecurity/inbox/ad/"
STALE_AFTER_HOURS = 48

# Only these keys ever leave this module. Names/UPNs/SIDs are never in this
# list on purpose; this is a counts-only feed.
ALLOWED_AD_KEYS: frozenset[str] = frozenset(
    {
        "domainAdminsCount",
        "dnsAdminsCount",
        "protectedUsersCount",
        "passwordNotRequiredCount",
        "unconstrainedDelegationCount",
        "staleEnabledAccountsCount",
        "staleComputersCount",
        "enabledAccountsCount",
        "staleComputerAccountsCount",
    }
)


def log(message: str) -> None:
    print(f"  [ad] {message}", file=sys.stderr, flush=True)


def sanitize_payload(payload: Any) -> tuple[dict[str, int], list[str]]:
    """Return (clean numeric fields, rejected allowlisted keys with a bad type)."""
    if not isinstance(payload, dict):
        return {}, ["<root is not an object>"]
    clean: dict[str, int] = {}
    rejected: list[str] = []
    for key in sorted(ALLOWED_AD_KEYS):
        if key not in payload:
            continue
        value = payload[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            rejected.append(key)
            continue
        clean[key] = int(value)
    return clean, rejected


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def is_stale(reference: datetime, now: datetime) -> bool:
    return (now - reference) > timedelta(hours=STALE_AFTER_HOURS)


def _list_inbox_objects(client: Any, bucket: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=INBOX_PREFIX):
        for obj in page.get("Contents") or []:
            if obj.get("Key", "").endswith(".json"):
                objects.append(obj)
    return objects


def newest_object(objects: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not objects:
        return None
    return max(objects, key=lambda o: o["LastModified"])


def collect(*, bucket: str | None = None, client: Any = None, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    try:
        dest = bucket or data_bucket()
        s3 = client or s3_client_factory()
        objects = _list_inbox_objects(s3, dest)
        newest = newest_object(objects)
        if newest is None:
            return {"status": "not_configured"}
        body = s3.get_object(Bucket=dest, Key=newest["Key"])["Body"].read()
        payload = json.loads(body.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - this source must not fail the whole run
        log(f"error: {type(exc).__name__}: {exc}")
        return {"status": "error", "error": f"{type(exc).__name__}"[:300]}

    clean, rejected = sanitize_payload(payload)
    if rejected:
        log(f"rejected non-numeric allowlisted key(s): {', '.join(rejected)}")
        return {"status": "error", "error": f"non-numeric value(s) for: {', '.join(rejected)}"}

    reference = _parse_dt(payload.get("generatedAt")) if isinstance(payload, dict) else None
    reference = reference or newest["LastModified"]
    stale = is_stale(reference, now)
    if stale:
        log(f"inbox file is stale (asOf={reference.isoformat()})")
    return {
        "status": "stale" if stale else "ok",
        "data": clean,
        "asOf": reference.isoformat(),
        "sourceKey": newest["Key"],
    }
