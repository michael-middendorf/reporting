from __future__ import annotations

import json
import os
from http import HTTPStatus
from typing import Any

import boto3


DEFAULT_AUTH_SECRET_ID = "mas-report/auth-passphrase"
DEFAULT_COOKIE_NAME = "mas_report_auth"
DEFAULT_MAX_AGE_SECONDS = 43_200


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    }


def _response(status: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": _headers(),
        "body": json.dumps(payload),
    }


def _secrets_client():
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-2"
    return boto3.Session(region_name=region).client("secretsmanager", region_name=region)


def _load_auth_secret(secret_text: str) -> tuple[str, str]:
    stripped = secret_text.strip()
    if not stripped:
        raise RuntimeError("Auth secret is empty.")
    if stripped.startswith("{"):
        payload = json.loads(stripped)
        passphrase = str(payload.get("passphrase") or "")
        cookie_token = str(payload.get("cookie_token") or "")
        if passphrase and cookie_token:
            return passphrase, cookie_token
        raise RuntimeError("Auth secret JSON must include passphrase and cookie_token.")
    raise RuntimeError("Auth secret must be stored as JSON.")


def _read_expected_values() -> tuple[str, str]:
    secret_id = os.environ.get("MAS_REPORT_AUTH_SECRET_ID", DEFAULT_AUTH_SECRET_ID)
    payload = _secrets_client().get_secret_value(SecretId=secret_id)
    secret_text = payload.get("SecretString")
    if not secret_text:
        raise RuntimeError(f"Secret {secret_id} did not contain SecretString.")
    return _load_auth_secret(secret_text)


def _parse_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body")
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        import base64

        body = base64.b64decode(body).decode("utf-8")
    return json.loads(body)


def lambda_handler(event: dict[str, Any] | None, context: Any) -> dict[str, Any]:
    payload = event or {}
    method = str(payload.get("requestContext", {}).get("http", {}).get("method") or payload.get("httpMethod") or "POST").upper()
    if method == "OPTIONS":
        return _response(HTTPStatus.OK, {"ok": True})
    if method != "POST":
        return _response(HTTPStatus.METHOD_NOT_ALLOWED, {"ok": False, "error": "method_not_allowed"})

    submitted = str(_parse_body(payload).get("passphrase") or "").strip()
    expected_passphrase, cookie_token = _read_expected_values()
    expected_passphrase = expected_passphrase.strip()
    if not submitted or submitted != expected_passphrase:
        return _response(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "invalid_passphrase"})

    return _response(
        HTTPStatus.OK,
        {
            "ok": True,
            "cookie_name": os.environ.get("MAS_REPORT_AUTH_COOKIE_NAME", DEFAULT_COOKIE_NAME),
            "cookie_token": cookie_token,
            "max_age_seconds": int(os.environ.get("MAS_REPORT_AUTH_MAX_AGE", str(DEFAULT_MAX_AGE_SECONDS))),
        },
    )
