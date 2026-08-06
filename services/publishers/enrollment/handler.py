"""Enrollment publisher: fetch Slate query URLs → ReportData/enrollment/."""

from __future__ import annotations

import gzip
import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from common.s3util import data_bucket, put_bytes, put_json

KEY_ALIASES = {
    "admissions": "admissions",
    "psw": "psw",
    "messages": "messages",
    "campus_vists": "campus_visits",
    "app_decisions": "app_decisions",
    "Interactions": "interactions",
    "slc": "slc",
    "islc": "islc",
    "slc_stucents": "slc_students",
    "withdrawn": "withdrawn",
}

USER_AGENT = "amu-reporting-enrollment-publisher/1.0"
TIMEOUT = int(os.getenv("FETCH_TIMEOUT_SECONDS", "900"))


def _links_path() -> Path:
    env = os.getenv("QUERY_LINKS_FILE")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    for candidate in (
        here / "query_links.json",
        Path("/var/task/query_links.json"),
        Path.cwd() / "query_links.json",
    ):
        if candidate.exists():
            return candidate
    return here / "query_links.json"


def _load_links() -> list[tuple[str, str]]:
    raw = json.loads(_links_path().read_text(encoding="utf-8"))
    ordered: list[tuple[str, str]] = []
    for source_key, url in raw.items():
        if source_key not in KEY_ALIASES:
            raise RuntimeError(f"Unexpected query key: {source_key}")
        ordered.append((KEY_ALIASES[source_key], url.strip()))
    return ordered


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def handler(event, context):  # noqa: ANN001, ARG001
    bucket = data_bucket()
    prefix = "enrollment"
    reports_meta: dict[str, dict] = {}
    order: list[str] = []
    generated_at = datetime.now(timezone.utc).isoformat()

    for name, url in _load_links():
        order.append(name)
        body = _fetch(url)
        # sanity: JSON
        json.loads(body)
        gz = gzip.compress(body)
        put_bytes(
            f"{prefix}/reports/{name}.json",
            body,
            content_type="application/json",
            bucket=bucket,
        )
        put_bytes(
            f"{prefix}/reports/{name}.json.gz",
            gz,
            content_type="application/gzip",
            content_encoding="gzip",
            bucket=bucket,
        )
        reports_meta[name] = {
            "bytes": len(body),
            "gzip_bytes": len(gz),
            "ok": True,
        }
        print(f"published {name} ({len(body)} bytes)", flush=True)

    manifest = {
        "success": True,
        "generated_at": generated_at,
        "report_order": order,
        "reports": reports_meta,
    }
    put_json(f"{prefix}/slate-report-cache.json", manifest, bucket=bucket)
    put_bytes(
        f"{prefix}/slate-report-cache.json.gz",
        gzip.compress(json.dumps(manifest).encode("utf-8")),
        content_type="application/gzip",
        content_encoding="gzip",
        bucket=bucket,
    )
    return {"ok": True, "bucket": bucket, "reports": order, "generated_at": generated_at}
