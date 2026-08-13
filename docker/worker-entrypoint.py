"""ECS task dispatcher for the reporting publishers and processors."""
from __future__ import annotations

import base64
import hashlib
import hmac
import importlib
import json
import os
import secrets
import sys
import time
import urllib.request
from typing import Any

HANDLERS = {
    "enrollment": "services.publishers.enrollment.handler",
    "virtuous": "services.publishers.virtuous.handler",
    "housing": "services.publishers.housing.handler",
    "institute": "services.publishers.institute.handler",
    "mas": "services.publishers.mas.handler",
    "alumni": "services.publishers.alumni.handler",
    "institute-process": "services.publishers.institute.process_handler",
}


def send_daily_magic_links() -> dict[str, Any]:
    """Container equivalent of the legacy daily magic-link Lambda."""
    secret = os.environ.get("AUTH_SECRET", "")
    api_key = os.environ.get("RESEND_API_KEY", "")
    base = os.environ.get("APP_BASE_URL", "").rstrip("/")
    if not secret or not base:
        raise RuntimeError("AUTH_SECRET and APP_BASE_URL are required")
    emails: set[str] = {"cole.j.cantu@avemaria.edu", "regina.m.pirolli@avemaria.edu"}
    for key in ("ALLOWED_EMAILS", "ENROLLMENT_ALLOWED_EMAILS", "HOUSING_ALLOWED_EMAILS", "INSTITUTE_ALLOWED_EMAILS", "MAS_ALLOWED_EMAILS", "POINTS_ALLOWED_EMAILS", "ALUMNI_ALLOWED_EMAILS"):
        emails.update(e.strip().lower() for e in os.environ.get(key, "").split(",") if e.strip())
    sent = 0
    for email in sorted(emails):
        payload = {"email": email, "exp": int(time.time()) + 900, "nonce": secrets.token_urlsafe(16), "type": "magic"}
        encoded = base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).rstrip(b"=").decode()
        signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
        link = f"{base}/auth/magic?token={encoded}.{signature}"
        if api_key:
            request = urllib.request.Request("https://api.resend.com/emails", data=json.dumps({"from": os.environ.get("EMAIL_FROM", "AMU Project Manager <noreply@notifications.avemaria.edu>"), "to": [email], "subject": "Your AMU Reporting sign-in link", "text": f"Sign in: {link}\\nExpires in 15 minutes."}).encode(), headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=30):
                pass
        sent += 1
    return {"ok": True, "sent": sent}

def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "daily-magic":
        print(json.dumps(send_daily_magic_links()), flush=True)
        return 0
    module_name = HANDLERS.get(action)
    if not module_name:
        raise SystemExit(f"unknown worker action: {action}")
    event: dict[str, Any] = json.loads(os.environ.get("REPORT_EVENT", "{}"))
    if action == "virtuous":
        # The ECS replacement builds the MAS cache in the same task after raw refresh.
        result = importlib.import_module(module_name).handler(event, None)
        importlib.import_module(HANDLERS["mas"]).handler({"warm_only": True}, None)
    elif action == "institute":
        result = importlib.import_module(module_name).handler(event, None)
        importlib.import_module(HANDLERS["institute-process"]).handler({}, None)
    else:
        result = importlib.import_module(module_name).handler(event, None)
    print(json.dumps(result, default=str), flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
