"""Enrollment publisher: fetch Slate query URLs → ReportData/enrollment/."""

from __future__ import annotations

import gzip
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from common.s3util import data_bucket, put_bytes, put_json, s3

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
    if env and Path(env).exists():
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


def _fetch_to_file(url: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp, dest.open("wb") as out:
        first = resp.read(1)
        if not first or first not in (b"{", b"["):
            raise RuntimeError(f"Non-JSON payload from {url[:80]}")
        out.write(first)
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    return dest.stat().st_size


def _upload_file(bucket: str, key: str, path: Path, content_type: str, encoding: str | None = None) -> None:
    extra = {"ContentType": content_type, "CacheControl": "no-cache"}
    if encoding:
        extra["ContentEncoding"] = encoding
    s3().upload_file(str(path), bucket, key, ExtraArgs=extra)


def handler(event, context):  # noqa: ANN001, ARG001
    bucket = data_bucket()
    prefix = "enrollment"
    reports_meta: dict[str, dict] = {}
    order: list[str] = []
    generated_at = datetime.now(timezone.utc).isoformat()

    with tempfile.TemporaryDirectory(prefix="enrollment-") as tmp:
        tmpdir = Path(tmp)
        for name, url in _load_links():
            order.append(name)
            raw_path = tmpdir / f"{name}.json"
            gz_path = tmpdir / f"{name}.json.gz"
            size = _fetch_to_file(url, raw_path)
            with raw_path.open("rb") as src, gzip.open(gz_path, "wb") as gz:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    gz.write(chunk)
            gz_size = gz_path.stat().st_size
            _upload_file(bucket, f"{prefix}/reports/{name}.json", raw_path, "application/json")
            _upload_file(
                bucket,
                f"{prefix}/reports/{name}.json.gz",
                gz_path,
                "application/gzip",
                encoding="gzip",
            )
            reports_meta[name] = {"bytes": size, "gzip_bytes": gz_size, "ok": True}
            raw_path.unlink(missing_ok=True)
            gz_path.unlink(missing_ok=True)
            print(f"published {name} ({size} bytes)", flush=True)

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
