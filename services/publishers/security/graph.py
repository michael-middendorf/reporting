"""Microsoft Graph security telemetry stub (IT-3, PR 3 implements this).

The Entra app registration (amu-reporting-security-ro), certificate auth, and
Secrets Manager entry (amu-reporting/production/security-graph) are built in
PR 3, after the exact Graph permission list is approved. Until then this
module always reports "not_configured" so the Overview page has a stable
place to render Secure Score / MFA / Defender / Intune KPIs (as rag "grey",
status "missing") without the publisher run ever failing on a source that
does not exist yet.

Each function signature below is the PR 3 contract: once the cert-based
Graph client exists, these bodies get replaced with real calls behind the
same env SECURITY_GRAPH_SECRET gate that github.py uses for its own secret.
"""
from __future__ import annotations

import os
from typing import Any

NOT_CONFIGURED: dict[str, Any] = {"status": "not_configured"}


def is_configured(env: dict[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return bool((env.get("SECURITY_GRAPH_SECRET") or "").strip())


def subscribed_skus() -> dict[str, Any]:
    """PR 3 TODO: GET /subscribedSkus - which licenses (E5/A5/P2) are present,
    so a KPI whose feature the license doesn't cover reports not_licensed
    instead of a fake zero."""
    return dict(NOT_CONFIGURED)


def secure_score() -> dict[str, Any]:
    """PR 3 TODO: GET /security/secureScores (latest) -> currentScore/maxScore percent + trend."""
    return dict(NOT_CONFIGURED)


def mfa_registration() -> dict[str, Any]:
    """PR 3 TODO: GET /reports/authenticationMethods/userRegistrationDetails
    (or credentialUserRegistrationDetails) -> registration % by population
    (staff, students, admins), counts only, no UPNs."""
    return dict(NOT_CONFIGURED)


def defender_incidents_alerts() -> dict[str, Any]:
    """PR 3 TODO: GET /security/incidents and /security/alerts_v2 -> open
    counts by severity + mean time to resolve. Requires Defender for
    Endpoint (not_licensed if the tenant lacks it)."""
    return dict(NOT_CONFIGURED)


def intune_compliance() -> dict[str, Any]:
    """PR 3 TODO: GET /deviceManagement/managedDevices -> compliance %,
    encryption %, counts only."""
    return dict(NOT_CONFIGURED)


def collect() -> dict[str, Any]:
    """Always not_configured in PR 2. PR 3 wires the cert client and fans out
    to the functions above the same way aws.collect() / github.collect() do,
    each sub-call isolated so one Graph endpoint failing (or not_licensed)
    never fails the others."""
    if not is_configured():
        return dict(NOT_CONFIGURED)
    # SECURITY_GRAPH_SECRET is set but PR 3 has not landed yet: still report
    # not_configured rather than guessing at an implementation.
    return {"status": "not_configured", "note": "Graph publisher not implemented yet (PR 3)"}
