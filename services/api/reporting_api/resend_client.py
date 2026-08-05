"""Send magic-link emails via Resend (console fallback when RESEND_API_KEY is unset)."""

from __future__ import annotations

import json
import os
import urllib.error
from html import escape
from typing import Optional, Tuple
from urllib.request import Request, urlopen

RESEND_API_URL = "https://api.resend.com/emails"
DEFAULT_EMAIL_FROM = "AMU Project Manager <noreply@notifications.avemaria.edu>"
DEFAULT_USER_AGENT = "amu-reporting/1.0"


def send_magic_link_email(email: str, magic_link: str, ttl_minutes: int) -> Tuple[bool, Optional[str]]:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    email_from = os.getenv("EMAIL_FROM", DEFAULT_EMAIL_FROM).strip() or DEFAULT_EMAIL_FROM
    user_agent = os.getenv("RESEND_USER_AGENT", DEFAULT_USER_AGENT).strip() or DEFAULT_USER_AGENT
    subject = "Your AMU Reporting sign-in link"
    text = (
        "Use the link below to sign in to AMU Reporting.\n\n"
        f"{magic_link}\n\n"
        f"This link expires in {ttl_minutes} minutes. "
        "If you did not request this email, you can ignore it."
    )
    html = (
        "<p>Use the link below to sign in to AMU Reporting.</p>"
        f'<p><a href="{escape(magic_link, quote=True)}">Open sign-in link</a></p>'
        f"<p>This link expires in {ttl_minutes} minutes.</p>"
        "<p>If you did not request this email, you can ignore it.</p>"
    )

    if not api_key:
        print("\n==========================================")
        print("EMAIL (Development Mode)")
        print(f"From: {email_from}")
        print(f"To: {email}")
        print(f"Subject: {subject}")
        print("------------------------------------------")
        print(text)
        print("==========================================\n")
        return True, None

    payload = {
        "from": email_from,
        "to": [email],
        "subject": subject,
        "html": html,
        "text": text,
    }
    data = json.dumps(payload).encode("utf-8")
    request = Request(
        RESEND_API_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": user_agent,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            if response.status >= 400:
                return False, f"Resend returned HTTP {response.status}"
        return True, None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return False, f"Resend error {exc.code}: {detail}"
    except Exception as exc:
        return False, str(exc)
