"""
HTTP API for unified AMU reporting: auth, enrollment presigns, housing, report data.

Used by:
  - Lambda Function URL / EventBridge (lambda_handler)
  - Local serve_api.py (dispatch_http)
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from http.cookies import SimpleCookie
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlencode, urlparse

from reporting_api.auth import (
    create_magic_token,
    create_session_token,
    is_email_allowed,
    is_valid_email,
    normalize_email,
    parse_allowed_emails,
    verify_magic_token,
    verify_session_token,
)
from reporting_api.presign import enrollment_dashboard_payload, list_and_presign_prefix
from reporting_api.resend_client import send_magic_link_email

SESSION_COOKIE_NAME = "amu_reporting_session"
AUTH_SUCCESS_MESSAGE = "If your email is approved, you will receive a sign-in link shortly."
DEFAULT_ALLOWED = (
    "cole.j.cantu@avemaria.edu,"
    "regina.m.pirolli@avemaria.edu,"
    "michael.t.middendorf@avemaria.edu"
)


@dataclass
class HttpResponse:
    status: int
    body: bytes
    headers: Dict[str, str] = field(default_factory=dict)
    multi_headers: List[Tuple[str, str]] = field(default_factory=list)


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def auth_secret() -> str:
    return _env("AUTH_SECRET")


def app_base_url() -> str:
    return _env("APP_BASE_URL").rstrip("/")


def magic_ttl_minutes() -> int:
    return max(int(_env("AUTH_MAGIC_LINK_TTL_MINUTES", "15") or "15"), 1)


def session_ttl_days() -> int:
    return max(int(_env("AUTH_SESSION_TTL_DAYS", "14") or "14"), 1)


def allowed_emails_csv() -> str:
    return _env("ALLOWED_EMAILS", DEFAULT_ALLOWED) or DEFAULT_ALLOWED


def _json_body(data: Any, status: int = 200, cookie: Optional[str] = None) -> HttpResponse:
    body = json.dumps(data).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    }
    multi: List[Tuple[str, str]] = []
    if cookie:
        multi.append(("Set-Cookie", cookie))
    return HttpResponse(status=status, body=body, headers=headers, multi_headers=multi)


def _is_secure(headers: Dict[str, str]) -> bool:
    proto = (headers.get("x-forwarded-proto") or headers.get("X-Forwarded-Proto") or "").lower()
    if proto == "https":
        return True
    return app_base_url().startswith("https://")


def build_session_cookie(token: str, max_age: int, headers: Dict[str, str]) -> str:
    parts = [
        f"{SESSION_COOKIE_NAME}={token}",
        "Path=/",
        f"Max-Age={max_age}",
        "HttpOnly",
        "SameSite=Lax",
    ]
    if _is_secure(headers):
        parts.append("Secure")
    return "; ".join(parts)


def clear_session_cookie(headers: Dict[str, str]) -> str:
    parts = [
        f"{SESSION_COOKIE_NAME}=",
        "Path=/",
        "Max-Age=0",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "HttpOnly",
        "SameSite=Lax",
    ]
    if _is_secure(headers):
        parts.append("Secure")
    return "; ".join(parts)


def _header_get(headers: Dict[str, str], name: str) -> str:
    lower = name.lower()
    for key, value in headers.items():
        if key.lower() == lower:
            return value
    return ""


def extract_session_token(headers: Dict[str, str]) -> Optional[str]:
    auth = _header_get(headers, "Authorization")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token

    cookie_header = _header_get(headers, "Cookie")
    if not cookie_header:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return None
    morsel = cookie.get(SESSION_COOKIE_NAME)
    if morsel is None:
        # Accept legacy enrollment cookie during cutover
        morsel = cookie.get("enrollment_session") or cookie.get("dashboard_session")
    if morsel is None:
        return None
    return morsel.value or None


def current_user_email(headers: Dict[str, str]) -> Optional[str]:
    secret = auth_secret()
    if not secret:
        return None
    token = extract_session_token(headers)
    if not token:
        return None
    try:
        payload = verify_session_token(token, secret)
        return payload["email"]
    except Exception:
        return None


def cors_headers(request_headers: Dict[str, str]) -> Dict[str, str]:
    origin = _header_get(request_headers, "Origin")
    allowed = {
        app_base_url(),
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    }
    allowed = {o for o in allowed if o}
    headers: Dict[str, str] = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }
    if origin and origin in allowed:
        headers["Access-Control-Allow-Origin"] = origin
    elif app_base_url():
        headers["Access-Control-Allow-Origin"] = app_base_url()
    return headers


def _merge_cors(resp: HttpResponse, request_headers: Dict[str, str]) -> HttpResponse:
    resp.headers.update(cors_headers(request_headers))
    return resp


def _parse_json(body: bytes) -> Dict[str, Any]:
    if not body:
        return {}
    try:
        data = json.loads(body.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid JSON body") from exc
    if not isinstance(data, dict):
        raise ValueError("JSON body must be an object")
    return data


def magic_link_for(email: str) -> str:
    secret = auth_secret()
    base = app_base_url()
    if not secret:
        raise ValueError("AUTH_SECRET is not configured")
    if not base:
        raise ValueError("APP_BASE_URL is not configured")
    token = create_magic_token(email, secret, magic_ttl_minutes())
    return f"{base}/auth/magic?{urlencode({'token': token})}"


def send_daily_links() -> Dict[str, Any]:
    if not _env("ALLOWED_EMAILS"):
        os.environ["ALLOWED_EMAILS"] = allowed_emails_csv()

    emails = sorted(parse_allowed_emails(allowed_emails_csv()))
    results = []
    for email in emails:
        try:
            link = magic_link_for(email)
            ok, error = send_magic_link_email(email, link, magic_ttl_minutes())
            results.append({"email": email, "ok": ok, "error": error})
        except Exception as exc:
            results.append({"email": email, "ok": False, "error": str(exc)})
    return {
        "success": all(r["ok"] for r in results) if results else False,
        "mode": "send_daily_links",
        "sent": results,
        "ttl_minutes": magic_ttl_minutes(),
    }


def _require_auth(headers: Dict[str, str]) -> Optional[HttpResponse]:
    if current_user_email(headers):
        return None
    return _json_body(
        {"error": "Authentication required", "redirect": "/login"},
        status=401,
    )


def _s3_client(factory: Optional[Callable[[], Any]] = None) -> Any:
    if factory is not None:
        return factory()
    import boto3

    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
    return boto3.client("s3", region_name=region)


def dispatch_http(
    method: str,
    path: str,
    headers: Dict[str, str],
    body: bytes,
    s3_client_factory: Optional[Callable[[], Any]] = None,
) -> HttpResponse:
    method = method.upper()
    path = urlparse(path).path.rstrip("/") or "/"
    path = re.sub(r"^/prod", "", path) or "/"

    if method == "OPTIONS":
        return _merge_cors(
            HttpResponse(status=204, body=b"", headers={"Cache-Control": "no-store"}),
            headers,
        )

    if path in {"/health", "/api/health"} and method == "GET":
        return _merge_cors(
            _json_body({"ok": True, "service": "amu-reporting-api"}),
            headers,
        )

    if path == "/api/auth/me" and method == "GET":
        email = current_user_email(headers)
        if email:
            return _merge_cors(_json_body({"authenticated": True, "email": email}), headers)
        return _merge_cors(_json_body({"authenticated": False}, status=401), headers)

    if path == "/api/auth/request" and method == "POST":
        return _merge_cors(_auth_request(headers, body), headers)

    if path == "/api/auth/complete" and method == "POST":
        return _merge_cors(_auth_complete(headers, body), headers)

    if path == "/api/auth/logout" and method == "POST":
        cookie = clear_session_cookie(headers)
        return _merge_cors(_json_body({"ok": True}, cookie=cookie), headers)

    # Enrollment (legacy path + new path)
    if path in {"/api/dashboard", "/api/enrollment/dashboard"} and method == "GET":
        denied = _require_auth(headers)
        if denied:
            return _merge_cors(denied, headers)
        try:
            payload = enrollment_dashboard_payload(_s3_client(s3_client_factory))
            return _merge_cors(_json_body(payload), headers)
        except Exception as exc:
            return _merge_cors(
                _json_body({"success": False, "error": str(exc)}, status=500),
                headers,
            )

    # MAS / points / alumni data indexes
    m = re.match(r"^/api/reports/(enrollment|mas|points|alumni)/data$", path)
    if m and method == "GET":
        denied = _require_auth(headers)
        if denied:
            return _merge_cors(denied, headers)
        try:
            payload = list_and_presign_prefix(_s3_client(s3_client_factory), m.group(1))
            return _merge_cors(_json_body(payload), headers)
        except Exception as exc:
            return _merge_cors(
                _json_body({"success": False, "error": str(exc)}, status=500),
                headers,
            )

    # Housing
    if path == "/api/housing-data" and method == "GET":
        denied = _require_auth(headers)
        if denied:
            return _merge_cors(denied, headers)
        try:
            from reporting_api.housing_data import get_housing_data

            return _merge_cors(_json_body(get_housing_data()), headers)
        except Exception as exc:
            return _merge_cors(_json_body({"error": str(exc)}, status=502), headers)

    if path == "/api/refresh-housing" and method == "GET":
        denied = _require_auth(headers)
        if denied:
            return _merge_cors(denied, headers)
        try:
            from reporting_api.housing_data import get_housing_data

            return _merge_cors(_json_body(get_housing_data(force_refresh=True)), headers)
        except Exception as exc:
            return _merge_cors(_json_body({"error": str(exc)}, status=502), headers)

    if path == "/api/slate-data" and method == "GET":
        denied = _require_auth(headers)
        if denied:
            return _merge_cors(denied, headers)
        try:
            from reporting_api.housing_data import get_admissions_for_housing

            return _merge_cors(_json_body(get_admissions_for_housing()), headers)
        except Exception as exc:
            return _merge_cors(_json_body({"error": str(exc)}, status=502), headers)

    if path == "/api/slate-deposits" and method == "GET":
        denied = _require_auth(headers)
        if denied:
            return _merge_cors(denied, headers)
        try:
            from reporting_api.housing_data import get_deposits_for_housing

            return _merge_cors(_json_body(get_deposits_for_housing()), headers)
        except Exception as exc:
            return _merge_cors(_json_body({"error": str(exc)}, status=502), headers)

    return _merge_cors(_json_body({"error": "Not found"}, status=404), headers)


def _auth_request(headers: Dict[str, str], body: bytes) -> HttpResponse:
    try:
        payload = _parse_json(body)
    except ValueError as exc:
        return _json_body({"error": str(exc)}, status=400)

    email = normalize_email(str(payload.get("email", "")))
    if not is_valid_email(email):
        return _json_body({"error": "Enter a valid email address."}, status=400)
    if not auth_secret():
        return _json_body({"error": "Authentication is not configured."}, status=500)
    if not app_base_url():
        return _json_body({"error": "APP_BASE_URL is not configured."}, status=500)

    if not _env("ALLOWED_EMAILS"):
        os.environ["ALLOWED_EMAILS"] = allowed_emails_csv()

    if not is_email_allowed(email, parse_allowed_emails(allowed_emails_csv())):
        print(f"Auth request ignored for non-allowlisted email: {email}")
        return _json_body({"ok": True, "message": AUTH_SUCCESS_MESSAGE})

    try:
        link = magic_link_for(email)
    except ValueError as exc:
        return _json_body({"error": str(exc)}, status=500)

    ok, error = send_magic_link_email(email, link, magic_ttl_minutes())
    if not ok:
        print(f"Auth email send failed for {email}: {error}")
        return _json_body({"error": "Unable to send sign-in email right now."}, status=502)

    print(f"Magic link sent to {email}")
    return _json_body({"ok": True, "message": AUTH_SUCCESS_MESSAGE})


def _auth_complete(headers: Dict[str, str], body: bytes) -> HttpResponse:
    try:
        payload = _parse_json(body)
    except ValueError as exc:
        return _json_body({"error": str(exc)}, status=400)

    token = str(payload.get("token", "")).strip()
    if not token:
        return _json_body({"error": "Missing token."}, status=400)
    secret = auth_secret()
    if not secret:
        return _json_body({"error": "Authentication is not configured."}, status=500)

    try:
        token_payload = verify_magic_token(token, secret)
    except ValueError as exc:
        return _json_body({"error": str(exc)}, status=401)

    email = token_payload["email"]
    if not _env("ALLOWED_EMAILS"):
        os.environ["ALLOWED_EMAILS"] = allowed_emails_csv()
    if not is_email_allowed(email, parse_allowed_emails(allowed_emails_csv())):
        return _json_body({"error": "Email is not permitted."}, status=403)

    session_token = create_session_token(email, secret, session_ttl_days())
    max_age = session_ttl_days() * 86400
    cookie = build_session_cookie(session_token, max_age, headers)
    return _json_body(
        {
            "ok": True,
            "email": email,
            "redirect": "/",
            "session": session_token,
        },
        cookie=cookie,
    )


def _normalize_headers(raw: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for key, value in (raw or {}).items():
        if value is None:
            continue
        out[str(key)] = value if isinstance(value, str) else str(value)
    return out


def _event_body_bytes(event: Dict[str, Any]) -> bytes:
    body = event.get("body")
    if body is None:
        return b""
    if event.get("isBase64Encoded"):
        import base64

        return base64.b64decode(body)
    if isinstance(body, bytes):
        return body
    return str(body).encode("utf-8")


def _lambda_response(resp: HttpResponse) -> Dict[str, Any]:
    headers = dict(resp.headers)
    cookies = [v for k, v in resp.multi_headers if k.lower() == "set-cookie"]
    for k, v in resp.multi_headers:
        if k.lower() == "set-cookie":
            headers["Set-Cookie"] = v
        else:
            headers[k] = v
    out: Dict[str, Any] = {
        "statusCode": resp.status,
        "headers": headers,
        "body": resp.body.decode("utf-8") if resp.body else "",
    }
    if cookies:
        out["cookies"] = cookies
    return out


def lambda_handler(event: Dict[str, Any], context: Any = None) -> Dict[str, Any]:
    if isinstance(event, dict) and event.get("mode") == "send_daily_links":
        return send_daily_links()
    if isinstance(event, dict) and not event.get("requestContext") and not event.get("rawPath") and not event.get("path"):
        if event.get("source") == "aws.events" or event.get("detail-type") == "Scheduled Event":
            return send_daily_links()

    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    )
    path = event.get("rawPath") or event.get("path") or "/"
    headers = _normalize_headers(event.get("headers") or {})
    if event.get("cookies") and not _header_get(headers, "Cookie"):
        headers["Cookie"] = "; ".join(event["cookies"])

    resp = dispatch_http(method, path, headers, _event_body_bytes(event))
    return _lambda_response(resp)
