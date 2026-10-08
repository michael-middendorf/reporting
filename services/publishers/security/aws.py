"""AWS read-only security telemetry for the cybersecurity dashboard (IT-3, PR 2).

Every public function in this module returns a plain dict with at least a
``status`` key (``ok`` | ``error`` | ``not_configured`` | ``not_licensed``)
and never raises: a disabled service, a region where a service was never
turned on, or an AccessDenied on one API call shows up as a status on that
one source, so it never fails the whole publisher run (handler.py composes
each source independently).

Only counts and booleans are returned. No account ids, ARNs, hostnames, IPs,
or usernames leave this module (guard.py double-checks the final composed
document before anything is written to S3).

All calls here are read-only (Describe/Get/List). Nothing here creates,
modifies, or deletes an AWS resource.
"""
from __future__ import annotations

import csv
import io
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

REGIONS: tuple[str, ...] = ("us-east-2", "us-east-1")
ACM_REGIONS: tuple[str, ...] = ("us-east-1", "us-east-2")

CRITICAL_SLA_DAYS = 7
HIGH_SLA_DAYS = 30

_ACCESS_DENIED_CODES = {
    "AccessDenied",
    "AccessDeniedException",
    "UnauthorizedOperation",
    "AuthorizationErrorException",
    "AuthorizationError",
    "UnrecognizedClientException",
}
# These mean "the service/standard was never turned on here", not a hard error.
_NOT_CONFIGURED_CODES = {
    "InvalidAccessException",  # Security Hub: account not subscribed in this region
    "ResourceNotFoundException",
    "BadRequestException",
}
_NOT_LICENSED_CODES = {
    "OptInRequired",
    "SubscriptionRequiredException",
}


def log(message: str) -> None:
    print(f"  [aws] {message}", file=sys.stderr, flush=True)


def _client(service: str, region: str):
    import boto3

    return boto3.client(service, region_name=region)


def _classify(exc: BaseException) -> tuple[str, str]:
    """Map an exception to (status, detail). ``detail`` is a bounded, code-only
    string (e.g. "AccessDenied: AccessDenied", "Throttling") that is safe to
    put in the written document: a botocore error ``Message`` can embed an
    ARN, account id, or resource name, so it never goes into the return
    value here. Call ``_full_message`` separately to log the real message to
    CloudWatch only.
    """
    from botocore.exceptions import ClientError

    if isinstance(exc, ClientError):
        code = str((exc.response or {}).get("Error", {}).get("Code") or type(exc).__name__)
    else:
        code = type(exc).__name__
    if code in _ACCESS_DENIED_CODES:
        return "error", f"AccessDenied: {code}"
    if code in _NOT_LICENSED_CODES:
        return "not_licensed", code
    if code in _NOT_CONFIGURED_CODES:
        return "not_configured", code
    return "error", code


def _full_message(exc: BaseException) -> str:
    """The real error message, for CloudWatch logging only. Never return or
    store this; a botocore ``Message`` can contain an ARN/account id/etc."""
    from botocore.exceptions import ClientError

    if isinstance(exc, ClientError):
        return str((exc.response or {}).get("Error", {}).get("Message") or str(exc))
    return str(exc)


def _wrap(source: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        data = fn()
        return {"status": "ok", "data": data}
    except Exception as exc:  # noqa: BLE001 - one source failing must not fail the run
        status, detail = _classify(exc)
        log(f"{source}: {status} ({detail}): {_full_message(exc)}")
        return {"status": status, "error": detail}


def _merge_region_results(
    source: str, region_fn: Callable[[str], dict[str, Any]], regions: tuple[str, ...] | None = None
) -> dict[str, Any]:
    """Run region_fn(region) for every region; merge successes, report the rest.

    Returns {"status": ..., "data": {...}, "byRegion": {region: status}} so a
    service disabled in one region doesn't hide a real result from another.

    ``regions`` defaults to the module-level REGIONS, looked up at call time
    (not bound as a default argument) so tests can monkeypatch aws.REGIONS.
    """
    if regions is None:
        regions = REGIONS
    per_region: dict[str, dict[str, Any]] = {}
    statuses: dict[str, str] = {}
    oks: list[dict[str, Any]] = []
    for region in regions:
        try:
            data = region_fn(region)
            per_region[region] = data
            statuses[region] = "ok"
            oks.append(data)
        except Exception as exc:  # noqa: BLE001
            status, detail = _classify(exc)
            statuses[region] = status
            log(f"{source}/{region}: {status} ({detail}): {_full_message(exc)}")
    if not oks:
        # Every region failed the same way (commonly not_configured / not_licensed).
        worst = "error"
        for s in statuses.values():
            if s == "error":
                worst = "error"
                break
            worst = s
        return {"status": worst, "byRegion": statuses}
    return {"status": "ok", "byRegion": statuses, "regions": per_region}


# ---------------------------------------------------------------------------
# Security Hub
# ---------------------------------------------------------------------------

FSBP_NAME_FRAGMENT = "aws-foundational-security-best-practices"

# A generous page cap (each page is MaxResults=100 findings) plus a shared
# per-region wall-clock budget. Every GetFindings pass this module runs for
# a given region (FSBP pass/fail tally, active-findings-by-severity tally)
# counts against the SAME budget/deadline for that region, so Security Hub
# work in one region can never run unbounded: it stops and reports
# truncated=True instead of silently under-counting forever.
SECURITYHUB_MAX_PAGES = 500
SECURITYHUB_TIME_BUDGET_S = 240.0


def _scan_findings(
    client,
    filters: dict[str, Any],
    on_finding: Callable[[dict[str, Any]], None],
    *,
    deadline: float,
    max_pages: int = SECURITYHUB_MAX_PAGES,
    page_size: int = 100,
) -> bool:
    """One paginated GetFindings pass over ``filters``, calling
    ``on_finding`` for every finding returned so the caller can tally
    whatever it needs (severity, compliance status, ...) in memory instead
    of running a separate paginated call per bucket.

    Returns ``truncated``: True only when pagination stopped because the
    page cap or the wall-clock ``deadline`` was hit while the API still had
    more pages (NextToken present), never because pagination legitimately
    ran out. The caller passes the SAME ``deadline`` into every scan for a
    region so the budget is per-region, not per-call.
    """
    kwargs: dict[str, Any] = {"Filters": filters, "MaxResults": page_size}
    token: str | None = None
    for _ in range(max_pages):
        resp = client.get_findings(**kwargs)
        for finding in resp.get("Findings") or []:
            on_finding(finding)
        token = resp.get("NextToken")
        if not token:
            return False
        if time.monotonic() > deadline:
            return True
        kwargs["NextToken"] = token
    return bool(token)


def _standards_id_from_arn(arn: str) -> str:
    """'arn:aws:securityhub:<region>::standards/<name>/v/<version>' -> 'standards/<name>/v/<version>'.

    Matches exactly the value get_findings' ComplianceAssociatedStandardsId
    filter expects (confirmed live: accounts with Security Hub's
    consolidated control findings no longer tag a per-standard GeneratorId,
    so filtering FSBP by GeneratorId prefix silently returns zero rows).
    """
    return arn.split(":")[-1]


def _securityhub_region(region: str) -> dict[str, Any]:
    client = _client("securityhub", region)
    # One shared deadline for every GetFindings pass below: the region's
    # total Security Hub time budget, not a fresh budget per tally.
    deadline = time.monotonic() + SECURITYHUB_TIME_BUDGET_S
    standards = client.get_enabled_standards().get("StandardsSubscriptions", [])
    enabled_standards = sorted(
        {_standards_id_from_arn(s.get("StandardsArn") or "") for s in standards if s.get("StandardsArn")}
    )
    fsbp_standards_id = next((sid for sid in enabled_standards if FSBP_NAME_FRAGMENT in sid), None)
    truncated = False
    if fsbp_standards_id:
        fsbp_counts: dict[str, int] = defaultdict(int)

        def _tally_fsbp(finding: dict[str, Any]) -> None:
            status = (finding.get("Compliance") or {}).get("Status")
            if status in ("PASSED", "FAILED"):
                fsbp_counts[status] += 1

        fsbp_truncated = _scan_findings(
            client,
            {
                "RecordState": [{"Value": "ACTIVE", "Comparison": "EQUALS"}],
                "ComplianceAssociatedStandardsId": [{"Value": fsbp_standards_id, "Comparison": "EQUALS"}],
            },
            _tally_fsbp,
            deadline=deadline,
        )
        fsbp_passed, fsbp_failed = fsbp_counts["PASSED"], fsbp_counts["FAILED"]
        truncated = truncated or fsbp_truncated
    else:
        # FSBP is not enabled in this region: 0/0 so the caller's pass-rate
        # math yields None (unknown), not a fabricated 0%.
        fsbp_passed = fsbp_failed = 0

    active_counts: dict[str, int] = defaultdict(int)

    def _tally_active(finding: dict[str, Any]) -> None:
        sev = str((finding.get("Severity") or {}).get("Label") or "UNKNOWN").lower()
        active_counts[sev] += 1

    active_truncated = _scan_findings(
        client,
        {
            "RecordState": [{"Value": "ACTIVE", "Comparison": "EQUALS"}],
            "WorkflowStatus": [
                {"Value": "NEW", "Comparison": "EQUALS"},
                {"Value": "NOTIFIED", "Comparison": "EQUALS"},
            ],
        },
        _tally_active,
        deadline=deadline,
    )
    truncated = truncated or active_truncated

    if truncated:
        log(
            f"securityhub/{region}: hit the page cap or the {SECURITYHUB_TIME_BUDGET_S:.0f}s time budget "
            "with more pages remaining (counts are a lower bound)"
        )
    return {
        "enabledStandards": enabled_standards,
        "fsbpPassed": fsbp_passed,
        "fsbpFailed": fsbp_failed,
        "activeFindingsBySeverity": dict(active_counts),
        "truncated": truncated,
    }


def securityhub() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        merged = _merge_region_results("securityhub", _securityhub_region)
        if merged["status"] != "ok":
            raise RuntimeError(merged["status"])
        total_passed = sum(r["fsbpPassed"] for r in merged["regions"].values())
        total_failed = sum(r["fsbpFailed"] for r in merged["regions"].values())
        total_controls = total_passed + total_failed
        pass_rate = round(100.0 * total_passed / total_controls, 1) if total_controls else None
        active_total: dict[str, int] = defaultdict(int)
        for r in merged["regions"].values():
            for sev, count in r["activeFindingsBySeverity"].items():
                active_total[sev] += count
        enabled_standards = sorted({s for r in merged["regions"].values() for s in r["enabledStandards"]})
        truncated = any(r.get("truncated") for r in merged["regions"].values())
        return {
            "byRegion": merged["byRegion"],
            "truncated": truncated,
            "enabledStandards": enabled_standards,
            "fsbpPassRatePercent": pass_rate,
            "fsbpControlsEvaluated": total_controls,
            "activeCriticalHigh": active_total.get("critical", 0) + active_total.get("high", 0),
            "activeFindingsBySeverity": dict(active_total),
        }

    return _wrap("securityhub", fetch)


# ---------------------------------------------------------------------------
# GuardDuty
# ---------------------------------------------------------------------------


def _guardduty_region(region: str) -> dict[str, Any]:
    client = _client("guardduty", region)
    detector_ids = client.list_detectors().get("DetectorIds", [])
    if not detector_ids:
        return {"enabled": False, "countBySeverity": {}}
    detector_id = detector_ids[0]
    stats = client.get_findings_statistics(
        DetectorId=detector_id,
        FindingStatisticTypes=["COUNT_BY_SEVERITY"],
        FindingCriteria={"Criterion": {"service.archived": {"Eq": ["false"]}}},
    )
    counts = stats.get("FindingStatistics", {}).get("CountBySeverity", {}) or {}
    return {"enabled": True, "countBySeverity": {str(k).lower(): int(v) for k, v in counts.items()}}


def guardduty() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        merged = _merge_region_results("guardduty", _guardduty_region)
        if merged["status"] != "ok":
            raise RuntimeError(merged["status"])
        any_enabled = any(r["enabled"] for r in merged["regions"].values())
        if not any_enabled:
            return {"byRegion": merged["byRegion"], "enabledAnyRegion": False, "criticalHigh": None}
        total: dict[str, int] = defaultdict(int)
        for r in merged["regions"].values():
            for sev, count in r["countBySeverity"].items():
                total[sev] += count
        # GuardDuty severity buckets: numeric strings ("8.0") or labels depending
        # on API version; treat anything starting 7-8/"high"/"critical" as high+.
        critical_high = 0
        for sev, count in total.items():
            try:
                score = float(sev)
                if score >= 7.0:
                    critical_high += count
            except ValueError:
                if sev in ("high", "critical"):
                    critical_high += count
        return {
            "byRegion": merged["byRegion"],
            "enabledAnyRegion": True,
            "countBySeverity": dict(total),
            "criticalHigh": critical_high,
        }

    return _wrap("guardduty", fetch)


# ---------------------------------------------------------------------------
# Inspector2
# ---------------------------------------------------------------------------


def _account_id() -> str:
    client = _client("sts", REGIONS[0])
    return str(client.get_caller_identity()["Account"])


def _inspector2_findings(client) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    crit_cutoff = now - timedelta(days=CRITICAL_SLA_DAYS)
    high_cutoff = now - timedelta(days=HIGH_SLA_DAYS)
    by_sev: dict[str, int] = defaultdict(int)
    over_sla = 0
    kwargs: dict[str, Any] = {
        "filterCriteria": {
            "findingStatus": [{"comparison": "EQUALS", "value": "ACTIVE"}],
            "severity": [
                {"comparison": "EQUALS", "value": "CRITICAL"},
                {"comparison": "EQUALS", "value": "HIGH"},
                {"comparison": "EQUALS", "value": "MEDIUM"},
                {"comparison": "EQUALS", "value": "LOW"},
            ],
        },
        "maxResults": 100,
    }
    for _ in range(50):
        resp = client.list_findings(**kwargs)
        for finding in resp.get("findings") or []:
            sev = str(finding.get("severity") or "UNKNOWN").lower()
            by_sev[sev] += 1
            observed = finding.get("firstObservedAt")
            if sev == "critical" and observed and observed <= crit_cutoff:
                over_sla += 1
            elif sev == "high" and observed and observed <= high_cutoff:
                over_sla += 1
        token = resp.get("nextToken")
        if not token:
            break
        kwargs["nextToken"] = token
    return {"activeBySeverity": dict(by_sev), "criticalHighOverSla": over_sla}


def inspector2() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        account_id = _account_id()
        by_region: dict[str, str] = {}
        enabled_any = False
        findings: dict[str, Any] | None = None
        for region in REGIONS:
            client = _client("inspector2", region)
            try:
                status_resp = client.batch_get_account_status(accountIds=[account_id])
                states = status_resp.get("accounts") or []
                state = (states[0].get("state") or {}).get("status") if states else "DISABLED"
                by_region[region] = state or "DISABLED"
                if state == "ENABLED":
                    enabled_any = True
                    if findings is None:
                        findings = _inspector2_findings(client)
            except Exception as exc:  # noqa: BLE001
                status, detail = _classify(exc)
                by_region[region] = status
                log(f"inspector2/{region}: {status} ({detail})")
        if not enabled_any:
            return {"byRegion": by_region, "enabledAnyRegion": False}
        result = {"byRegion": by_region, "enabledAnyRegion": True}
        result.update(findings or {"activeBySeverity": {}, "criticalHighOverSla": 0})
        return result

    return _wrap("inspector2", fetch)


# ---------------------------------------------------------------------------
# IAM credential report (counts only; never a username)
# ---------------------------------------------------------------------------

CREDENTIAL_KEY_AGE_DAYS = 90


def _poll_credential_report(client, attempts: int = 6, delay_s: float = 2.0) -> bytes:
    for attempt in range(attempts):
        try:
            resp = client.get_credential_report()
            return resp["Content"]
        except Exception as exc:  # noqa: BLE001
            code = type(exc).__name__
            if hasattr(exc, "response"):
                code = exc.response.get("Error", {}).get("Code", code)
            if code in ("CredentialReportNotPresentException", "CredentialReportExpiredException"):
                client.generate_credential_report()
            elif code != "CredentialReportInProgressException":
                raise
            if attempt < attempts - 1:
                time.sleep(delay_s)
    raise RuntimeError("credential report not ready after polling")


def _older_than(value: str, days: int) -> bool:
    if not value or value.upper() == "N/A":
        return False
    try:
        rotated = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    if rotated.tzinfo is None:
        rotated = rotated.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - rotated) > timedelta(days=days)


def iam_credential_report() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        client = _client("iam", "us-east-1")
        try:
            client.generate_credential_report()
        except Exception:  # noqa: BLE001 - fine, get_credential_report polling handles state
            pass
        content = _poll_credential_report(client)
        rows = list(csv.DictReader(io.StringIO(content.decode("utf-8"))))
        root_row = next((r for r in rows if r.get("user") == "<root_account>"), None)
        non_root = [r for r in rows if r.get("user") != "<root_account>"]

        console_without_mfa = sum(
            1 for r in non_root if r.get("password_enabled") == "true" and r.get("mfa_active") == "false"
        )
        active_keys_over_90d = 0
        for r in non_root:
            for n in (1, 2):
                if r.get(f"access_key_{n}_active") == "true" and _older_than(
                    r.get(f"access_key_{n}_last_rotated", ""), CREDENTIAL_KEY_AGE_DAYS
                ):
                    active_keys_over_90d += 1
        root_mfa_enabled = (root_row or {}).get("mfa_active") == "true"
        root_access_keys_present = (root_row or {}).get("access_key_1_active") == "true" or (
            root_row or {}
        ).get("access_key_2_active") == "true"
        return {
            "usersTotal": len(non_root),
            "consoleUsersWithoutMfa": console_without_mfa,
            "activeKeysOver90d": active_keys_over_90d,
            "rootMfaEnabled": root_mfa_enabled,
            "rootMfaEnabledValue": 1 if root_mfa_enabled else 0,
            "rootAccessKeysPresent": root_access_keys_present,
            "rootAccessKeysPresentValue": 1 if root_access_keys_present else 0,
        }

    return _wrap("iam", fetch)


# ---------------------------------------------------------------------------
# CloudTrail
# ---------------------------------------------------------------------------


def cloudtrail() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        # Multi-region trails are visible from any region's endpoint.
        client = _client("cloudtrail", REGIONS[0])
        trails = client.describe_trails(includeShadowTrails=False).get("trailList", [])
        multi_region = [t for t in trails if t.get("IsMultiRegionTrail")]
        logging_count = 0
        validation_count = 0
        for t in multi_region:
            arn = t.get("TrailARN")
            if not arn:
                continue
            status = client.get_trail_status(Name=arn)
            if status.get("IsLogging"):
                logging_count += 1
            if t.get("LogFileValidationEnabled"):
                validation_count += 1
        return {
            "multiRegionTrailsCount": len(multi_region),
            "multiRegionTrailsLogging": logging_count,
            "multiRegionTrailsNotLogging": len(multi_region) - logging_count,
            "logFileValidationEnabledCount": validation_count,
        }

    return _wrap("cloudtrail", fetch)


# ---------------------------------------------------------------------------
# AWS Backup
# ---------------------------------------------------------------------------

BACKUP_WINDOW_DAYS = 30


def _backup_region(region: str) -> dict[str, int]:
    client = _client("backup", region)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=BACKUP_WINDOW_DAYS)
    counts: dict[str, int] = defaultdict(int)
    paginator = client.get_paginator("list_backup_jobs")
    for page in paginator.paginate(ByCreatedAfter=start, ByCreatedBefore=end):
        for job in page.get("BackupJobs") or []:
            counts[str(job.get("State") or "UNKNOWN")] += 1
    return dict(counts)


def backup() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        merged = _merge_region_results("backup", _backup_region)
        if merged["status"] != "ok":
            raise RuntimeError(merged["status"])
        total: dict[str, int] = defaultdict(int)
        for r in merged["regions"].values():
            for state, count in r.items():
                total[state] += count
        completed = total.get("COMPLETED", 0)
        all_jobs = sum(total.values())
        success_pct = round(100.0 * completed / all_jobs, 1) if all_jobs else None
        return {
            "byRegion": merged["byRegion"],
            "windowDays": BACKUP_WINDOW_DAYS,
            "jobsByState": dict(total),
            "jobsTotal": all_jobs,
            "successPercent": success_pct,
        }

    return _wrap("backup", fetch)


# ---------------------------------------------------------------------------
# RDS public exposure
#
# Which instance identifiers (if any) are tracked individually is a runtime
# config choice, not something this code hardcodes: it comes from
# SECURITY_WATCH_RDS_IDS (comma-separated DBInstanceIdentifiers), with no
# default. Unset means "no individually-watched instance"; the general
# publicly-accessible count is still always reported.
# ---------------------------------------------------------------------------


def _watched_rds_ids(env: dict[str, str] | None = None) -> frozenset[str]:
    import os

    env = os.environ if env is None else env
    raw = (env.get("SECURITY_WATCH_RDS_IDS") or "").strip()
    if not raw:
        return frozenset()
    return frozenset(i.strip() for i in raw.split(",") if i.strip())


def _rds_region(region: str, watched_ids: frozenset[str]) -> dict[str, Any]:
    client = _client("rds", region)
    total = 0
    public_count = 0
    watched_public_count = 0
    paginator = client.get_paginator("describe_db_instances")
    for page in paginator.paginate():
        for inst in page.get("DBInstances") or []:
            total += 1
            if inst.get("PubliclyAccessible"):
                public_count += 1
                if watched_ids and inst.get("DBInstanceIdentifier") in watched_ids:
                    watched_public_count += 1
    return {
        "instancesTotal": total,
        "publiclyAccessibleCount": public_count,
        "watchedPublicCount": watched_public_count,
    }


def rds() -> dict[str, Any]:
    watched_ids = _watched_rds_ids()

    def fetch() -> dict[str, Any]:
        merged = _merge_region_results("rds", lambda region: _rds_region(region, watched_ids))
        if merged["status"] != "ok":
            raise RuntimeError(merged["status"])
        total = sum(r["instancesTotal"] for r in merged["regions"].values())
        public = sum(r["publiclyAccessibleCount"] for r in merged["regions"].values())
        result: dict[str, Any] = {
            "byRegion": merged["byRegion"],
            "instancesTotal": total,
            "publiclyAccessibleCount": public,
        }
        if watched_ids:
            watched_public = sum(r["watchedPublicCount"] for r in merged["regions"].values())
            result["watchedInstancesConfigured"] = len(watched_ids)
            result["watchedPubliclyAccessibleCount"] = watched_public
        return result

    return _wrap("rds", fetch)


# ---------------------------------------------------------------------------
# ACM certificate expiry
# ---------------------------------------------------------------------------


def _acm_region(region: str) -> dict[str, int]:
    client = _client("acm", region)
    now = datetime.now(timezone.utc)
    exp30 = exp60 = exp90 = 0
    paginator = client.get_paginator("list_certificates")
    for page in paginator.paginate(CertificateStatuses=["ISSUED"]):
        for cert in page.get("CertificateSummaryList") or []:
            not_after = cert.get("NotAfter")
            if not_after is None:
                desc = client.describe_certificate(CertificateArn=cert["CertificateArn"]).get("Certificate", {})
                not_after = desc.get("NotAfter")
            if not_after is None:
                continue
            days = (not_after - now).days
            if days <= 30:
                exp30 += 1
            if days <= 60:
                exp60 += 1
            if days <= 90:
                exp90 += 1
    return {"expiring30": exp30, "expiring60": exp60, "expiring90": exp90}


def acm() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        merged = _merge_region_results("acm", _acm_region, ACM_REGIONS)
        if merged["status"] != "ok":
            raise RuntimeError(merged["status"])
        total = {"expiring30": 0, "expiring60": 0, "expiring90": 0}
        for r in merged["regions"].values():
            for k in total:
                total[k] += r[k]
        return {"byRegion": merged["byRegion"], **total}

    return _wrap("acm", fetch)


# ---------------------------------------------------------------------------
# EC2 Site-to-Site VPN tunnels
# ---------------------------------------------------------------------------


def _vpn_region(region: str) -> dict[str, int]:
    client = _client("ec2", region)
    resp = client.describe_vpn_connections(Filters=[{"Name": "state", "Values": ["available"]}])
    up = 0
    total = 0
    connections = 0
    for conn in resp.get("VpnConnections") or []:
        connections += 1
        for tunnel in conn.get("VgwTelemetry") or []:
            total += 1
            if tunnel.get("Status") == "UP":
                up += 1
    return {"connections": connections, "tunnelsUp": up, "tunnelsTotal": total}


def vpn() -> dict[str, Any]:
    def fetch() -> dict[str, Any]:
        merged = _merge_region_results("vpn", _vpn_region)
        if merged["status"] != "ok":
            raise RuntimeError(merged["status"])
        connections = sum(r["connections"] for r in merged["regions"].values())
        up = sum(r["tunnelsUp"] for r in merged["regions"].values())
        total = sum(r["tunnelsTotal"] for r in merged["regions"].values())
        return {
            "byRegion": merged["byRegion"],
            "connections": connections,
            "tunnelsUp": up,
            "tunnelsTotal": total,
            "tunnelsDown": total - up,
        }

    return _wrap("vpn", fetch)


# ---------------------------------------------------------------------------
# Top-level collect
# ---------------------------------------------------------------------------


def collect() -> dict[str, Any]:
    """Run every AWS sub-source. Never raises; each sub-source carries its own status."""
    subsources = {
        "securityhub": securityhub,
        "guardduty": guardduty,
        "inspector2": inspector2,
        "iam": iam_credential_report,
        "cloudtrail": cloudtrail,
        "backup": backup,
        "rds": rds,
        "acm": acm,
        "vpn": vpn,
    }
    data: dict[str, Any] = {}
    statuses: dict[str, str] = {}
    for name, fn in subsources.items():
        result = fn()
        data[name] = result
        statuses[name] = result["status"]
        log(f"{name}: {result['status']}")
    overall = "ok" if any(s == "ok" for s in statuses.values()) else "error"
    return {"status": overall, "subStatus": statuses, "data": data}
