"""GitHub org-level security telemetry for AMU-Marketing (IT-3, PR 2).

Authenticates as a GitHub App (RS256 JWT -> installation access token) using
a secret shaped {app_id, installation_id, private_key_pem} whose name/ARN
comes from env SECURITY_GITHUB_SECRET. The secret is only ever resolved at
runtime inside the deployed Lambda via boto3 secretsmanager.get_secret_value;
when that env var is unset (every local/dry-run invocation), this module
never touches Secrets Manager and reports status "not_configured".

RS256 signing uses the `cryptography` package, imported lazily so unit tests
(and CI, which only installs boto3) never need it: the pure JWT-construction
logic (header/payload encoding, expiry math) is unit tested with an injected
fake signer, and the HTTP layer is unit tested with an injected transport.
Only counts/booleans are returned: no alert titles, repo names, usernames,
or URLs leave this module.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

ORG = "AMU-Marketing"
API_BASE = "https://api.github.com"
CRITICAL_SLA_DAYS = 7
HIGH_SLA_DAYS = 30
FIX_WINDOW_DAYS = 90
REQUEST_TIMEOUT_S = 30
JWT_CLOCK_SKEW_S = 60
JWT_TTL_S = 540  # 9 minutes; GitHub caps App JWTs at 10


def log(message: str) -> None:
    print(f"  [github] {message}", file=sys.stderr, flush=True)


class GithubHttpError(RuntimeError):
    def __init__(self, url: str, code: int, detail: str):
        super().__init__(f"GitHub {url} -> {code}: {detail}")
        self.url = url
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------------------
# RS256 App JWT (pure construction; crypto import is lazy and swappable)
# ---------------------------------------------------------------------------


def _b64url(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _default_rs256_signer(signing_input: bytes, private_key_pem: str) -> bytes:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key = serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)
    return key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())


def app_jwt_payload(app_id: str, *, now: int) -> dict[str, Any]:
    return {"iat": now - JWT_CLOCK_SKEW_S, "exp": now + JWT_TTL_S, "iss": str(app_id)}


def encode_jwt_rs256(
    payload: dict[str, Any],
    private_key_pem: str,
    *,
    signer: Callable[[bytes, str], bytes] | None = None,
) -> str:
    signer = signer or _default_rs256_signer
    header = {"alg": "RS256", "typ": "JWT"}
    segments = [
        _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ]
    signing_input = ".".join(segments).encode("ascii")
    signature = signer(signing_input, private_key_pem)
    segments.append(_b64url(signature))
    return ".".join(segments)


# ---------------------------------------------------------------------------
# HTTP transport (real urllib implementation; injectable for tests)
# ---------------------------------------------------------------------------


def _headers(token: str | None) -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _urllib_post_json(url: str, jwt_token: str) -> dict[str, Any]:
    req = urllib.request.Request(url, method="POST", headers=_headers(jwt_token), data=b"")
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise GithubHttpError(url, exc.code, exc.read().decode("utf-8", "replace")[:300]) from exc


_LINK_NEXT_RE = re.compile(r'<([^>]+)>;\s*rel="next"')


def _urllib_get_page(url: str, token: str) -> tuple[list[dict[str, Any]], str | None]:
    req = urllib.request.Request(url, headers=_headers(token))
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            link = resp.headers.get("Link") or ""
            match = _LINK_NEXT_RE.search(link)
            rows = body if isinstance(body, list) else []
            return rows, (match.group(1) if match else None)
    except urllib.error.HTTPError as exc:
        raise GithubHttpError(url, exc.code, exc.read().decode("utf-8", "replace")[:300]) from exc


def installation_token(
    app_id: str,
    installation_id: str,
    private_key_pem: str,
    *,
    now: int | None = None,
    signer: Callable[[bytes, str], bytes] | None = None,
    post_json: Callable[[str, str], dict[str, Any]] | None = None,
) -> str:
    now = now if now is not None else int(time.time())
    jwt_token = encode_jwt_rs256(app_jwt_payload(app_id, now=now), private_key_pem, signer=signer)
    post_json = post_json or _urllib_post_json
    url = f"{API_BASE}/app/installations/{installation_id}/access_tokens"
    body = post_json(url, jwt_token)
    token = body.get("token")
    if not token:
        raise GithubHttpError(url, 0, "no token in response")
    return str(token)


class GithubClient:
    def __init__(
        self,
        token: str,
        *,
        base_url: str = API_BASE,
        get_page: Callable[[str, str], tuple[list[dict[str, Any]], str | None]] | None = None,
        max_pages: int = 50,
    ):
        self.token = token
        self.base_url = base_url.rstrip("/")
        self._get_page = get_page or _urllib_get_page
        self.max_pages = max_pages

    def paged_get(self, path: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
        qs = urllib.parse.urlencode(params or {})
        url = f"{self.base_url}{path}?{qs}" if qs else f"{self.base_url}{path}"
        out: list[dict[str, Any]] = []
        for _ in range(self.max_pages):
            rows, next_url = self._get_page(url, self.token)
            out.extend(rows)
            if not next_url:
                break
            url = next_url
        return out


# ---------------------------------------------------------------------------
# Secret resolution (Lambda only: boto3 is imported lazily and only reached
# when SECURITY_GITHUB_SECRET is set)
# ---------------------------------------------------------------------------


def load_secret(env: dict[str, str] | None = None) -> dict[str, Any] | None:
    env = os.environ if env is None else env
    ref = (env.get("SECURITY_GITHUB_SECRET") or "").strip()
    if not ref:
        return None
    import boto3  # lazy: only reached inside the Lambda, never in local/test runs

    region = (env.get("AWS_REGION") or env.get("AWS_DEFAULT_REGION") or "us-east-2").strip()
    client = boto3.client("secretsmanager", region_name=region)
    resp = client.get_secret_value(SecretId=ref)
    return json.loads(resp["SecretString"])


# ---------------------------------------------------------------------------
# Pure alert classification (severity, SLA aging, mean time to fix)
# ---------------------------------------------------------------------------


def severity_of_dependabot(alert: dict[str, Any]) -> str:
    sev = (
        (alert.get("security_advisory") or {}).get("severity")
        or (alert.get("security_vulnerability") or {}).get("severity")
        or "unknown"
    )
    return str(sev).lower()


def severity_of_code_scanning(alert: dict[str, Any]) -> str:
    rule = alert.get("rule") or {}
    sev = rule.get("security_severity_level") or rule.get("severity") or "unknown"
    return str(sev).lower()


def count_by_severity(alerts: list[dict[str, Any]], severity_fn: Callable[[dict[str, Any]], str]) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for alert in alerts:
        out[severity_fn(alert)] += 1
    return dict(out)


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


def over_sla_count(
    alerts: list[dict[str, Any]],
    severity_fn: Callable[[dict[str, Any]], str],
    *,
    now: datetime | None = None,
) -> int:
    now = now or datetime.now(timezone.utc)
    count = 0
    for alert in alerts:
        sev = severity_fn(alert)
        created = _parse_dt(alert.get("created_at"))
        if created is None:
            continue
        if sev == "critical" and now - created > timedelta(days=CRITICAL_SLA_DAYS):
            count += 1
        elif sev == "high" and now - created > timedelta(days=HIGH_SLA_DAYS):
            count += 1
    return count


def mean_days_to_fix(
    alerts: list[dict[str, Any]],
    *,
    now: datetime | None = None,
    window_days: int = FIX_WINDOW_DAYS,
) -> float | None:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=window_days)
    durations: list[float] = []
    for alert in alerts:
        created = _parse_dt(alert.get("created_at"))
        fixed = _parse_dt(alert.get("fixed_at") or alert.get("closed_at"))
        if created is None or fixed is None or fixed < cutoff:
            continue
        durations.append((fixed - created).total_seconds() / 86400.0)
    if not durations:
        return None
    return round(sum(durations) / len(durations), 1)


# ---------------------------------------------------------------------------
# Top-level collect
# ---------------------------------------------------------------------------


def collect() -> dict[str, Any]:
    try:
        secret = load_secret()
    except Exception as exc:  # noqa: BLE001 - secret load failure must not crash the run
        log(f"secret load failed: {type(exc).__name__}: {exc}")
        return {"status": "error", "error": f"secret load failed: {type(exc).__name__}"}
    if not secret:
        return {"status": "not_configured"}
    missing = [k for k in ("app_id", "installation_id", "private_key_pem") if not secret.get(k)]
    if missing:
        return {"status": "error", "error": f"secret missing key(s): {', '.join(missing)}"}
    try:
        token = installation_token(secret["app_id"], secret["installation_id"], secret["private_key_pem"])
        client = GithubClient(token)
        dependabot_open = client.paged_get(f"/orgs/{ORG}/dependabot/alerts", {"state": "open", "per_page": "100"})
        code_scanning_open = client.paged_get(
            f"/orgs/{ORG}/code-scanning/alerts", {"state": "open", "per_page": "100"}
        )
        secret_scanning_open = client.paged_get(
            f"/orgs/{ORG}/secret-scanning/alerts", {"state": "open", "per_page": "100"}
        )
        dependabot_fixed = client.paged_get(f"/orgs/{ORG}/dependabot/alerts", {"state": "fixed", "per_page": "100"})
    except GithubHttpError as exc:
        log(f"api error: {exc.code}")
        return {"status": "error", "error": f"GitHub API HTTP {exc.code}"}
    except Exception as exc:  # noqa: BLE001
        log(f"unexpected error: {type(exc).__name__}: {exc}")
        return {"status": "error", "error": f"{type(exc).__name__}"[:300]}

    over_sla = over_sla_count(dependabot_open, severity_of_dependabot) + over_sla_count(
        code_scanning_open, severity_of_code_scanning
    )
    return {
        "status": "ok",
        "data": {
            "dependabotOpenBySeverity": count_by_severity(dependabot_open, severity_of_dependabot),
            "codeScanningOpenBySeverity": count_by_severity(code_scanning_open, severity_of_code_scanning),
            "secretScanningOpenCount": len(secret_scanning_open),
            "criticalHighOverSla": over_sla,
            "meanDaysToFixLast90d": mean_days_to_fix(dependabot_fixed),
        },
    }
