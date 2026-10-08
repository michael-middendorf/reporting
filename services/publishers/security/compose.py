"""Composes cybersecurity/latest.json from the aws/github/graph/ad sources
(IT-3, PR 2).

Every KPI gets {id, label, unit, target, direction, value, rag, delta,
source, asOf}. ``rag`` is computed from fixed green/amber thresholds per
KPI; missing or not-ok source data always yields ``"unknown"``, never a
fabricated zero (a KPI that silently read 0 because the API call failed
would be worse than no KPI at all on a board report).

``value_fn`` closures read straight out of the already-collected sources
dict (no network calls happen here), which keeps this module pure and unit
testable with fixture dicts.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import guard

HISTORY_PREFIX = "cybersecurity/history/"
LATEST_KEY = "cybersecurity/latest.json"


def log(message: str) -> None:
    print(f"  [compose] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Source accessors
# ---------------------------------------------------------------------------


def _aws_sub(sources: dict[str, Any], sub_source: str) -> dict[str, Any] | None:
    aws = sources.get("aws") or {}
    node = (aws.get("data") or {}).get(sub_source)
    if not isinstance(node, dict) or node.get("status") != "ok":
        return None
    return node.get("data") or {}


def _github_data(sources: dict[str, Any]) -> dict[str, Any] | None:
    gh = sources.get("github") or {}
    if gh.get("status") != "ok":
        return None
    return gh.get("data") or {}


def _ad_entry(sources: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    ad = sources.get("ad") or {}
    status = ad.get("status")
    if status not in ("ok", "stale"):
        return None, status
    return (ad.get("data") or {}), status


def _val(getter: Callable[[dict[str, Any]], dict[str, Any] | None], key: str) -> Callable[[dict[str, Any]], Any]:
    def fn(sources: dict[str, Any]) -> Any:
        node = getter(sources)
        return None if node is None else node.get(key)

    return fn


def _ad_val(key: str) -> Callable[[dict[str, Any]], Any]:
    def fn(sources: dict[str, Any]) -> Any:
        data, _status = _ad_entry(sources)
        return None if data is None else data.get(key)

    return fn


def _ad_force_red(sources: dict[str, Any]) -> bool:
    _data, status = _ad_entry(sources)
    return status == "stale"


def _gh_val(key: str) -> Callable[[dict[str, Any]], Any]:
    def fn(sources: dict[str, Any]) -> Any:
        node = _github_data(sources)
        return None if node is None else node.get(key)

    return fn


def _sh(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "securityhub")


def _gd(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "guardduty")


def _insp(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "inspector2")


def _iam(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "iam")


def _ct(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "cloudtrail")


def _bk(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "backup")


def _rds(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "rds")


def _acm(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "acm")


def _vpn(sources: dict[str, Any]) -> dict[str, Any] | None:
    return _aws_sub(sources, "vpn")


# ---------------------------------------------------------------------------
# KPI table (proposed targets; finalized with Keith in week 3 per the plan)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class KpiDef:
    id: str
    label: str
    unit: str
    target: str
    direction: str  # "higher_is_better" | "lower_is_better"
    green: float
    amber: float
    source: str
    value_fn: Callable[[dict[str, Any]], Any]
    force_red_fn: Callable[[dict[str, Any]], bool] | None = None


KPI_DEFS: tuple[KpiDef, ...] = (
    KpiDef(
        "fsbp_pass_rate", "Security Hub FSBP pass rate", "percent",
        ">=95% green, 85-95% amber, else red", "higher_is_better", 95, 85,
        "aws", _val(_sh, "fsbpPassRatePercent"),
    ),
    KpiDef(
        "securityhub_active_critical_high", "Security Hub active critical/high findings", "count",
        "0 green, <=5 amber, else red", "lower_is_better", 0, 5,
        "aws", _val(_sh, "activeCriticalHigh"),
    ),
    KpiDef(
        "guardduty_critical_high", "GuardDuty critical/high findings (non-archived)", "count",
        "0 green, <=5 amber, else red", "lower_is_better", 0, 5,
        "aws", _val(_gd, "criticalHigh"),
    ),
    KpiDef(
        "inspector_critical_high_over_sla", "Inspector critical/high vulnerabilities over SLA (7d/30d)", "count",
        "0 green, <=3 amber, else red", "lower_is_better", 0, 3,
        "aws", _val(_insp, "criticalHighOverSla"),
    ),
    KpiDef(
        "console_users_without_mfa", "Console users without MFA", "count",
        "0 green, <=2 amber, else red", "lower_is_better", 0, 2,
        "aws", _val(_iam, "consoleUsersWithoutMfa"),
    ),
    KpiDef(
        "iam_keys_over_90d", "Active access keys older than 90 days", "count",
        "0 green, <=3 amber, else red", "lower_is_better", 0, 3,
        "aws", _val(_iam, "activeKeysOver90d"),
    ),
    KpiDef(
        "root_mfa_enabled", "Root account MFA enabled", "boolean",
        "true", "higher_is_better", 1, 1,
        "aws", _val(_iam, "rootMfaEnabledValue"),
    ),
    KpiDef(
        "root_access_keys_present", "Root access keys present", "boolean",
        "false", "lower_is_better", 0, 0,
        "aws", _val(_iam, "rootAccessKeysPresentValue"),
    ),
    KpiDef(
        "cloudtrail_not_logging", "Multi-region CloudTrail trails not logging", "count",
        "0", "lower_is_better", 0, 0,
        "aws", _val(_ct, "multiRegionTrailsNotLogging"),
    ),
    KpiDef(
        "backup_success_pct", "AWS Backup success rate (30d)", "percent",
        ">=99% green, 95-99% amber, else red", "higher_is_better", 99, 95,
        "aws", _val(_bk, "successPercent"),
    ),
    KpiDef(
        "certs_expiring_30d", "Certificates expiring within 30 days", "count",
        "0", "lower_is_better", 0, 0,
        "aws", _val(_acm, "expiring30"),
    ),
    KpiDef(
        "rds_publicly_accessible_instances", "RDS instances publicly accessible", "count",
        "0", "lower_is_better", 0, 0,
        "aws", _val(_rds, "publiclyAccessibleCount"),
    ),
    KpiDef(
        "vpn_tunnels_down", "Site-to-Site VPN tunnels down", "count",
        "0 (all tunnels up)", "lower_is_better", 0, 0,
        "aws", _val(_vpn, "tunnelsDown"),
    ),
    KpiDef(
        "github_critical_high_over_sla", "GitHub critical/high alerts over SLA (7d/30d)", "count",
        "0 green, <=3 amber, else red", "lower_is_better", 0, 3,
        "github", _gh_val("criticalHighOverSla"),
    ),
    KpiDef(
        "github_secret_scanning_open", "GitHub open secret scanning alerts", "count",
        "0", "lower_is_better", 0, 0,
        "github", _gh_val("secretScanningOpenCount"),
    ),
    KpiDef(
        "ad_domain_admins", "AD Domain Admins members", "count",
        "<=10 green, <=20 amber, else red", "lower_is_better", 10, 20,
        "ad", _ad_val("domainAdminsCount"), _ad_force_red,
    ),
    KpiDef(
        "ad_password_not_required", "AD enabled accounts with password not required", "count",
        "0 green, <=50 amber, else red", "lower_is_better", 0, 50,
        "ad", _ad_val("passwordNotRequiredCount"), _ad_force_red,
    ),
    KpiDef(
        "ad_unconstrained_delegation", "AD accounts with unconstrained delegation", "count",
        "0", "lower_is_better", 0, 0,
        "ad", _ad_val("unconstrainedDelegationCount"), _ad_force_red,
    ),
)


def _rag(value: Any, direction: str, green: float, amber: float) -> str:
    if value is None:
        return "unknown"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "unknown"
    if direction == "higher_is_better":
        if v >= green:
            return "green"
        if v >= amber:
            return "amber"
        return "red"
    if v <= green:
        return "green"
    if v <= amber:
        return "amber"
    return "red"


def _build_kpi(d: KpiDef, sources: dict[str, Any], previous_by_id: dict[str, Any], generated_at: str) -> dict[str, Any]:
    value = d.value_fn(sources)
    rag = _rag(value, d.direction, d.green, d.amber)
    if value is not None and d.force_red_fn is not None and d.force_red_fn(sources):
        rag = "red"
    prev = previous_by_id.get(d.id)
    delta = None
    if value is not None and isinstance(prev, (int, float)) and not isinstance(prev, bool):
        delta = value - prev
        delta = round(delta, 2) if isinstance(delta, float) else delta
    return {
        "id": d.id,
        "label": d.label,
        "unit": d.unit,
        "target": d.target,
        "direction": d.direction,
        "value": value,
        "rag": rag,
        "delta": delta,
        "source": d.source,
        "asOf": generated_at,
    }


# ---------------------------------------------------------------------------
# Document assembly (pure)
# ---------------------------------------------------------------------------


def build_document(
    sources: dict[str, Any],
    *,
    now: datetime | None = None,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    generated_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    previous_by_id = {k.get("id"): k.get("value") for k in (previous or {}).get("kpis", []) if k.get("id")}
    kpis = [_build_kpi(d, sources, previous_by_id, generated_at) for d in KPI_DEFS]
    return {
        "generatedAt": generated_at,
        "sources": sources,
        "kpis": kpis,
    }


# ---------------------------------------------------------------------------
# S3 history read + publish
# ---------------------------------------------------------------------------


def _history_key_for(day: str) -> str:
    return f"{HISTORY_PREFIX}{day}.json"


def load_latest_previous(*, bucket: str | None = None, client: Any = None) -> dict[str, Any] | None:
    """Newest cybersecurity/history/*.json. File names are YYYY-MM-DD.json, so
    the lexicographically-largest key is also the most recent date. None if
    the prefix is empty or unreadable (first run, or a permissions problem
    that must not block writing today's snapshot)."""
    from common.s3util import data_bucket
    from common.s3util import s3 as s3_client_factory

    dest = bucket or data_bucket()
    s3c = client or s3_client_factory()
    try:
        keys: list[str] = []
        paginator = s3c.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=dest, Prefix=HISTORY_PREFIX):
            for obj in page.get("Contents") or []:
                if obj["Key"].endswith(".json"):
                    keys.append(obj["Key"])
        if not keys:
            return None
        newest_key = max(keys)
        body = s3c.get_object(Bucket=dest, Key=newest_key)["Body"].read()
        return json.loads(body.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - no history is fine; this must never block today's write
        log(f"no usable previous history ({type(exc).__name__}: {exc})")
        return None


def build_and_publish(
    sources: dict[str, Any],
    *,
    write: bool,
    now: datetime | None = None,
    bucket: str | None = None,
    client: Any = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    previous = load_latest_previous(bucket=bucket, client=client)
    doc = build_document(sources, now=now, previous=previous)
    guard.assert_clean(doc)
    if write:
        from common.s3util import put_json

        # The bucket policy denies any cybersecurity/ write that is not SSE-KMS.
        kms_key_id = os.environ.get("CYBER_KMS_KEY_ID") or None
        put_json(LATEST_KEY, doc, bucket=bucket, kms_key_id=kms_key_id)
        day = doc["generatedAt"][:10]
        put_json(_history_key_for(day), doc, bucket=bucket, kms_key_id=kms_key_id)
        log(f"wrote {LATEST_KEY} and {_history_key_for(day)}")
    else:
        log("dry run: not written to S3")
    return doc
