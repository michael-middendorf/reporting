#!/usr/bin/env python3
"""Local API server for AMU reporting (port 8000)."""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from reporting_api.handler import dispatch_http  # noqa: E402


def _load_env() -> None:
    for candidate in (ROOT / ".env", ROOT.parent.parent / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()
os.environ.setdefault("AUTH_SECRET", "local-dev-secret")
os.environ.setdefault("APP_BASE_URL", "http://127.0.0.1:5173")
os.environ.setdefault(
    "ALLOWED_EMAILS",
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu",
)
if not os.getenv("AUTH_SECRET"):
    print("WARNING: AUTH_SECRET unset")


class Handler(BaseHTTPRequestHandler):
    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        headers = {k: v for k, v in self.headers.items()}
        resp = dispatch_http(self.command, self.path, headers, body)
        self.send_response(resp.status)
        for k, v in resp.headers.items():
            self.send_header(k, v)
        for k, v in resp.multi_headers:
            self.send_header(k, v)
        self.end_headers()
        if resp.body:
            self.wfile.write(resp.body)

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._handle()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"AMU reporting API on http://127.0.0.1:{port}")
    print("  Health: /api/health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
