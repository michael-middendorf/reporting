"""Composes cybersecurity/latest.json from the aws/github/graph/ad sources
(IT-3, PR 2).

Every KPI matches the ``CyberKpi`` contract the web app reads
(apps/web-next/src/lib/cyber/shape.ts): {id, label, section, headline,
value, unit, target, rag, delta, lowerIsBetter, source, asOf, status,
note}. ``section`` is one of shape.ts's CYBER_SECTIONS (identity, endpoints,
cloud, resilience, program; never "overview" on an individual KPI: the
Overview page is assembled client-side from the ``headline`` flag).
``status`` is shape.ts's KpiStatus ("ok" | "not_licensed" | "stale" |
"missing"); ``rag`` is always one of shape.ts's RAGS ("red" | "amber" |
"green" | "grey") and is "grey" whenever status isn't "ok" (missing or
not-ok source data is never a fabricated red/amber/green; a KPI that
silently read 0 because the API call failed would be worse than no KPI at
all on a board report).

``value_fn`` closures read straight out of the already-collected sources
dict (no network calls happen here), which keeps this module pure and unit
testable with fixture dicts.
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import guard

HISTORY_PREFIX = "cybersecurity/history/"
LATEST_KEY = "cybersecurity/latest.json"
# The page labels the delta "vs last month"; pick the history snapshot
# closest to this many days before generatedAt.
DELTA_WINDOW_DAYS = 30
# A comparison snapshot closer than this to generatedAt is not a usable
# month-over-month baseline (e.g. a re-run a few hours or days later would
# otherwise show a tiny, misleading "change"); the delta is null instead.
MIN_DELTA_BASELINE_AGE_DAYS = 25
GENERATED_AT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def log(message: str) -> None:
    print(f"  [compose] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Source accessors: each returns (raw_source_status, value_or_None).
# raw_source_status is one of "ok" | "error" | "not_configured" |
# "not_licensed" | "stale" | "missing" (missing = the source key wasn't
# present in the sources dict at all, which should not happen in practice
# but must never crash composition).
# ---------------------------------------------------------------------------


def _aws_value(sub_source: str, key: str) -> Callable[[dict[str, Any]], tuple[str, Any]]:
    def fn(sources: dict[str, Any]) -> tuple[str, Any]:
        aws = sources.get("aws") or {}
        node = (aws.get("data") or {}).get(sub_source) or {}
        status = node.get("status") or "missing"
        if status != "ok":
            return status, None
        return status, (node.get("data") or {}).get(key)

    # Tags this closure with the narrow sources.aws.data.<sub_source> node it
    # reads, so compose can (a) flag the KPI when that sub-source reports
    # truncated pagination and (b) target redaction at the same narrow node
    # instead of the whole "aws" source.
    fn.aws_sub_source = sub_source  # type: ignore[attr-defined]
    return fn


def _github_value(key: str) -> Callable[[dict[str, Any]], tuple[str, Any]]:
    def fn(sources: dict[str, Any]) -> tuple[str, Any]:
        gh = sources.get("github") or {}
        status = gh.get("status") or "missing"
        if status != "ok":
            return status, None
        return status, (gh.get("data") or {}).get(key)

    return fn


def _ad_value(key: str) -> Callable[[dict[str, Any]], tuple[str, Any]]:
    def fn(sources: dict[str, Any]) -> tuple[str, Any]:
        ad = sources.get("ad") or {}
        status = ad.get("status") or "missing"
        if status not in ("ok", "stale"):
            return status, None
        return status, (ad.get("data") or {}).get(key)

    return fn


# ---------------------------------------------------------------------------
# KPI table (proposed targets; finalized with the cybersecurity board per the plan)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class KpiDef:
    id: str
    label: str
    unit: str
    target: str
    lower_is_better: bool
    green: float
    amber: float
    section: str  # one of shape.ts's CYBER_SECTIONS, excluding "overview"
    headline: bool
    source_label: str  # human string, e.g. "Security Hub FSBP", "AD LDAP"
    value_fn: Callable[[dict[str, Any]], tuple[str, Any]]


KPI_DEFS: tuple[KpiDef, ...] = (
    KpiDef(
        "fsbp_pass_rate", "FSBP control checks passing %", "percent",
        ">=95% green, 85-95% amber, else red", False, 95, 85,
        "cloud", True, "Security Hub FSBP", _aws_value("securityhub", "fsbpPassRatePercent"),
    ),
    KpiDef(
        "securityhub_active_critical_high", "Security Hub active critical/high findings", "count",
        "0 green, <=5 amber, else red", True, 0, 5,
        "cloud", False, "Security Hub", _aws_value("securityhub", "activeCriticalHigh"),
    ),
    KpiDef(
        "guardduty_critical_high", "GuardDuty critical/high findings (non-archived)", "count",
        "0 green, <=5 amber, else red", True, 0, 5,
        "cloud", False, "GuardDuty", _aws_value("guardduty", "criticalHigh"),
    ),
    KpiDef(
        "inspector_critical_high_over_sla", "Inspector critical/high vulnerabilities over SLA (7d/30d)", "count",
        "0 green, <=3 amber, else red", True, 0, 3,
        "cloud", True, "Inspector2", _aws_value("inspector2", "criticalHighOverSla"),
    ),
    KpiDef(
        "console_users_without_mfa", "Console users without MFA", "count",
        "0 green, <=2 amber, else red", True, 0, 2,
        "identity", True, "IAM credential report", _aws_value("iam", "consoleUsersWithoutMfa"),
    ),
    KpiDef(
        "iam_keys_over_90d", "Active access keys older than 90 days", "count",
        "0 green, <=3 amber, else red", True, 0, 3,
        "identity", False, "IAM credential report", _aws_value("iam", "activeKeysOver90d"),
    ),
    KpiDef(
        "root_mfa_enabled", "Root account MFA enabled", "boolean",
        "true", False, 1, 1,
        "identity", True, "IAM credential report", _aws_value("iam", "rootMfaEnabledValue"),
    ),
    KpiDef(
        "root_access_keys_present", "Root access keys present", "boolean",
        "false", True, 0, 0,
        "identity", False, "IAM credential report", _aws_value("iam", "rootAccessKeysPresentValue"),
    ),
    KpiDef(
        "cloudtrail_not_logging", "Multi-region CloudTrail trails not logging", "count",
        "0", True, 0, 0,
        "cloud", False, "CloudTrail", _aws_value("cloudtrail", "multiRegionTrailsNotLogging"),
    ),
    KpiDef(
        "backup_success_pct", "AWS Backup success rate (30d)", "percent",
        ">=99% green, 95-99% amber, else red", False, 99, 95,
        "resilience", True, "AWS Backup", _aws_value("backup", "successPercent"),
    ),
    KpiDef(
        "certs_expiring_30d", "Certificates expiring within 30 days", "count",
        "0", True, 0, 0,
        "cloud", True, "ACM", _aws_value("acm", "expiring30"),
    ),
    KpiDef(
        "rds_publicly_accessible_instances", "RDS instances publicly accessible", "count",
        "0", True, 0, 0,
        "cloud", True, "RDS", _aws_value("rds", "publiclyAccessibleCount"),
    ),
    KpiDef(
        "vpn_tunnels_down", "Site-to-Site VPN tunnels down", "count",
        "0 (all tunnels up)", True, 0, 0,
        "resilience", True, "EC2 Site-to-Site VPN", _aws_value("vpn", "tunnelsDown"),
    ),
    KpiDef(
        "github_critical_high_over_sla", "GitHub critical/high alerts over SLA (7d/30d)", "count",
        "0 green, <=3 amber, else red", True, 0, 3,
        "cloud", True, "GitHub", _github_value("criticalHighOverSla"),
    ),
    KpiDef(
        "github_secret_scanning_open", "GitHub open secret scanning alerts", "count",
        "0", True, 0, 0,
        "cloud", False, "GitHub", _github_value("secretScanningOpenCount"),
    ),
    KpiDef(
        "ad_domain_admins", "AD Domain Admins members", "count",
        "<=10 green, <=20 amber, else red", True, 10, 20,
        "identity", True, "AD LDAP", _ad_value("domainAdminsCount"),
    ),
    KpiDef(
        "ad_password_not_required", "AD enabled accounts with password not required", "count",
        "0 green, <=50 amber, else red", True, 0, 50,
        "identity", False, "AD LDAP", _ad_value("passwordNotRequiredCount"),
    ),
    KpiDef(
        "ad_unconstrained_delegation", "AD accounts with unconstrained delegation", "count",
        "0", True, 0, 0,
        "identity", False, "AD LDAP", _ad_value("unconstrainedDelegationCount"),
    ),
)

# KPI_DEFS must mark at most 10 headline=True entries (shape.ts: "Shown on
# the Overview board scorecard (10 headline KPIs)").
assert sum(1 for d in KPI_DEFS if d.headline) <= 10

# shape.ts KpiStatus: "ok" | "not_licensed" | "stale" | "missing". Any raw
# source status not in this map (error, not_configured, or anything else)
# becomes "missing" rather than inventing a new enum value the page doesn't
# understand.
_STATUS_MAP: dict[str, str] = {"ok": "ok", "stale": "stale", "not_licensed": "not_licensed"}


def _kpi_status(raw_status: str) -> str:
    return _STATUS_MAP.get(raw_status, "missing")


def _rag(value: Any, lower_is_better: bool, green: float, amber: float) -> str:
    """shape.ts RAGS: "red" | "amber" | "green" | "grey". Callers only reach
    this when status == "ok"; everything else is "grey" (see _build_kpi)."""
    if value is None:
        return "grey"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "grey"
    if lower_is_better:
        if v <= green:
            return "green"
        if v <= amber:
            return "amber"
        return "red"
    if v >= green:
        return "green"
    if v >= amber:
        return "amber"
    return "red"


def _truncation_note(d: KpiDef, sources: dict[str, Any], status: str) -> str | None:
    """"Lower bound: result limit reached" when the specific AWS sub-source
    this KPI reads (e.g. sources.aws.data.securityhub) hit a pagination cap
    (aws.py's ``truncated`` flag), so the board doesn't read a capped count
    as the real, complete number."""
    if status != "ok":
        return None
    sub_source = getattr(d.value_fn, "aws_sub_source", None)
    if not sub_source:
        return None
    node = ((sources.get("aws") or {}).get("data") or {}).get(sub_source) or {}
    if (node.get("data") or {}).get("truncated"):
        return "Lower bound: result limit reached"
    return None


def _build_kpi(d: KpiDef, sources: dict[str, Any], previous_by_id: dict[str, Any], generated_at: str) -> dict[str, Any]:
    raw_status, value = d.value_fn(sources)
    status = _kpi_status(raw_status)
    if status not in ("ok", "stale"):
        value = None
    rag = _rag(value, d.lower_is_better, d.green, d.amber) if status == "ok" else "grey"
    prev = previous_by_id.get(d.id)
    delta = None
    if value is not None and isinstance(prev, (int, float)) and not isinstance(prev, bool):
        delta = value - prev
        if isinstance(delta, float):
            delta = round(delta, 2)
    return {
        "id": d.id,
        "label": d.label,
        "section": d.section,
        "headline": d.headline,
        "value": value,
        "unit": d.unit,
        "target": d.target,
        "rag": rag,
        "delta": delta,
        "lowerIsBetter": d.lower_is_better,
        "source": d.source_label,
        "asOf": generated_at,
        "status": status,
        "note": _truncation_note(d, sources, status),
    }


# ---------------------------------------------------------------------------
# Document assembly (pure)
# ---------------------------------------------------------------------------


def _usable_delta_baseline(previous: dict[str, Any] | None, now: datetime) -> dict[str, Any] | None:
    """``previous`` only if it is at least MIN_DELTA_BASELINE_AGE_DAYS (25)
    older than ``now``. A too-recent snapshot (a same-day re-run, a retry a
    few days later) is not a real month-over-month baseline, so the delta
    must be null rather than a misleading tiny "change"."""
    if not previous:
        return None
    raw = previous.get("generatedAt")
    if not isinstance(raw, str):
        return None
    try:
        prev_dt = datetime.strptime(raw, GENERATED_AT_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    if (now - prev_dt).days < MIN_DELTA_BASELINE_AGE_DAYS:
        return None
    return previous


def build_document(
    sources: dict[str, Any],
    *,
    now: datetime | None = None,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    generated_at = now.strftime(GENERATED_AT_FORMAT)
    baseline = _usable_delta_baseline(previous, now)
    previous_by_id = {k.get("id"): k.get("value") for k in (baseline or {}).get("kpis", []) if k.get("id")}
    kpis = [_build_kpi(d, sources, previous_by_id, generated_at) for d in KPI_DEFS]
    return {
        "generatedAt": generated_at,
        "sources": sources,
        "kpis": kpis,
    }


# ---------------------------------------------------------------------------
# S3 history read (delta baseline) + publish
# ---------------------------------------------------------------------------

_HISTORY_KEY_RE = re.compile(r"^cybersecurity/history/(\d{4}-\d{2}-\d{2})\.json$")


def _history_key_for(day: str) -> str:
    return f"{HISTORY_PREFIX}{day}.json"


def _history_dated_keys(client: Any, bucket: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=HISTORY_PREFIX):
        for obj in page.get("Contents") or []:
            match = _HISTORY_KEY_RE.match(obj.get("Key") or "")
            if match:
                out.append((match.group(1), obj["Key"]))
    return out


def load_previous_for_delta(
    *, now: datetime | None = None, bucket: str | None = None, client: Any = None
) -> dict[str, Any] | None:
    """The cybersecurity/history/*.json snapshot whose date is closest to
    DELTA_WINDOW_DAYS (30) before ``now`` (the page labels the delta "vs
    last month"). If every available snapshot is newer than that target,
    the oldest one is by definition the closest, so this naturally falls
    back to "oldest available" without special-casing it. None only when
    history is empty or unreadable (first run, or a permissions problem
    that must never block writing today's snapshot)."""
    from common.s3util import data_bucket
    from common.s3util import s3 as s3_client_factory

    now = now or datetime.now(timezone.utc)
    dest = bucket or data_bucket()
    s3c = client or s3_client_factory()
    try:
        dated_keys = _history_dated_keys(s3c, dest)
        if not dated_keys:
            return None
        target = (now - timedelta(days=DELTA_WINDOW_DAYS)).date()

        def _distance_days(item: tuple[str, str]) -> int:
            day = datetime.strptime(item[0], "%Y-%m-%d").date()
            return abs((day - target).days)

        _best_date, best_key = min(dated_keys, key=_distance_days)
        body = s3c.get_object(Bucket=dest, Key=best_key)["Body"].read()
        return json.loads(body.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - no usable delta baseline must never block today's write
        log(f"no usable history for delta ({type(exc).__name__})")
        return None


# Top sources whose sources.<top>.data.<sub> is itself a status-bearing
# sub-source node (aws.py's collect(): {"status": ..., "data": {"securityhub":
# {...}, "guardduty": {...}, ...}}). github/graph/ad have no such nesting, so
# a violation under them always redacts the whole top-level source.
_NESTED_SOURCE_NAMES = {"aws"}

_SUB_SOURCE_PATH_RE = re.compile(r"^\$\.sources\.([^.\[]+)\.data\.([^.\[]+)")
_SOURCE_PATH_RE = re.compile(r"^\$\.sources\.([^.\[]+)")

# A redaction target is either ("top",) for a whole top-level source, or
# ("top", "sub") for the narrower sources.<top>.data.<sub> node.
RedactionTarget = tuple[str] | tuple[str, str]


def _offending_sources(violations: list[tuple[str, str]], sources: dict[str, Any]) -> set[RedactionTarget]:
    """The narrowest redaction target for each guard violation's JSON path:
    a known sub-source node (e.g. sources.aws.data.iam) when the path is
    under one, otherwise the whole top-level source. Redacting the narrowest
    offending sub-source keeps every other sub-source (and the KPIs fed by
    them) intact instead of blanking an entire top-level source over one
    bad field."""
    out: set[RedactionTarget] = set()
    for path, _pattern_name in violations:
        sub_match = _SUB_SOURCE_PATH_RE.match(path)
        if sub_match:
            top, sub = sub_match.group(1), sub_match.group(2)
            data = (sources.get(top) or {}).get("data") or {}
            if top in _NESTED_SOURCE_NAMES and isinstance(data.get(sub), dict):
                out.add((top, sub))
                continue
        match = _SOURCE_PATH_RE.match(path)
        if match:
            out.add((match.group(1),))
    return out


def _redacted_sources(sources: dict[str, Any], targets: set[RedactionTarget]) -> dict[str, Any]:
    """Applies each redaction target, narrowest first, without disturbing
    any sub-source not named by a violation."""
    redacted = dict(sources)
    for target in targets:
        if len(target) == 2:
            top, sub = target
            top_node = dict(redacted.get(top) or {})
            data_node = dict(top_node.get("data") or {})
            log(f"redacting source '{top}.data.{sub}' and rebuilding (a value there matched a PII/ARN/secret pattern)")
            data_node[sub] = {"status": "error", "error": "redacted"}
            top_node["data"] = data_node
            redacted[top] = top_node
        else:
            (top,) = target
            log(f"redacting source '{top}' and rebuilding (a value there matched a PII/ARN/secret pattern)")
            redacted[top] = {"status": "error", "error": "redacted"}
    return redacted


def _describe_targets(targets: set[RedactionTarget]) -> str:
    described = (f"{t[0]}.data.{t[1]}" if len(t) == 2 else t[0] for t in targets)
    return ", ".join(sorted(described)) or "(none under sources.*)"


def build_and_publish(
    sources: dict[str, Any],
    *,
    write: bool,
    now: datetime | None = None,
    bucket: str | None = None,
    client: Any = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    previous = load_previous_for_delta(now=now, bucket=bucket, client=client)
    doc = build_document(sources, now=now, previous=previous)

    violations = guard.scan(doc)
    if violations:
        targets = _offending_sources(violations, sources)
        log(f"guard found {len(violations)} violation(s) in source(s): {_describe_targets(targets)}")
        if targets:
            redacted_sources = _redacted_sources(sources, targets)
            doc = build_document(redacted_sources, now=now, previous=previous)
            violations = guard.scan(doc)

    if violations:
        where = "; ".join(f"{p} ({n})" for p, n in violations)
        raise guard.GuardViolation(f"refusing to write even after redacting offending source(s): {where}")

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
