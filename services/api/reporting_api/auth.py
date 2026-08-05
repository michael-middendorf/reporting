"""HMAC-signed magic-link and session tokens (housing-dashboard pattern)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional, Set


def normalize_email(raw: str) -> str:
    return raw.strip().lower()


def is_valid_email(email: str) -> bool:
    if not email or len(email) > 320 or any(ch.isspace() for ch in email):
        return False
    local, sep, domain = email.partition("@")
    if not sep or not local or not domain:
        return False
    if "." not in domain or domain.startswith(".") or domain.endswith("."):
        return False
    return True


def parse_allowed_emails(value: Optional[str] = None) -> Set[str]:
    source = value if value is not None else os.getenv("ALLOWED_EMAILS", "")
    return {
        normalize_email(item)
        for item in source.split(",")
        if normalize_email(item)
    }


def is_email_allowed(email: str, allowed_emails: Optional[Set[str]] = None) -> bool:
    allowed = allowed_emails if allowed_emails is not None else parse_allowed_emails()
    return normalize_email(email) in allowed


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign(secret: str, payload_b64: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64url_encode(digest)


def create_signed_token(payload: dict, secret: str) -> str:
    if not secret:
        raise ValueError("AUTH_SECRET is required")
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(body)
    signature = _sign(secret, payload_b64)
    return f"{payload_b64}.{signature}"


def verify_signed_token(token: str, secret: str) -> dict:
    if not secret:
        raise ValueError("AUTH_SECRET is required")
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError as exc:
        raise ValueError("Malformed token") from exc

    expected = _sign(secret, payload_b64)
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid token signature")

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception as exc:
        raise ValueError("Invalid token payload") from exc

    exp = payload.get("exp")
    if not isinstance(exp, int):
        raise ValueError("Missing token expiration")
    if exp <= int(time.time()):
        raise ValueError("Token expired")
    return payload


def create_magic_token(email: str, secret: str, ttl_minutes: int) -> str:
    normalized = normalize_email(email)
    payload = {
        "email": normalized,
        "exp": int(time.time()) + max(ttl_minutes, 1) * 60,
        "nonce": secrets.token_urlsafe(16),
        "type": "magic",
    }
    return create_signed_token(payload, secret)


def verify_magic_token(token: str, secret: str) -> dict:
    payload = verify_signed_token(token, secret)
    if payload.get("type") != "magic":
        raise ValueError("Invalid token type")
    email = normalize_email(str(payload.get("email", "")))
    if not is_valid_email(email):
        raise ValueError("Invalid token email")
    payload["email"] = email
    return payload


def create_session_token(email: str, secret: str, ttl_days: int) -> str:
    normalized = normalize_email(email)
    payload = {
        "email": normalized,
        "exp": int(time.time()) + max(ttl_days, 1) * 86400,
        "type": "session",
    }
    return create_signed_token(payload, secret)


def verify_session_token(token: str, secret: str) -> dict:
    payload = verify_signed_token(token, secret)
    if payload.get("type") != "session":
        raise ValueError("Invalid session type")
    email = normalize_email(str(payload.get("email", "")))
    if not is_valid_email(email):
        raise ValueError("Invalid session email")
    payload["email"] = email
    return payload
