"""Refresh "The Institute" dashboard data into DATA_BUCKET/INSTITUTE_DATA_KEY.

Fetches the six Slate "run as service" queries concurrently (two of them - q1
and q2 - can each take up to ~600s, so sequential fetching would blow past the
Lambda 15-minute ceiling; concurrent fetching fits), builds the dashboard JSON
payload via build.payload(), and writes it to the shared SST ReportData bucket.

The Slate query definitions (id + auth token + read timeout per query) are read
from the INSTITUTE_SLATE_QUERIES environment variable - a JSON string with the
same shape as the standalone project's slate_queries.json.
"""

from __future__ import annotations

import json
import os
import ssl
import threading
from urllib.request import Request, urlopen

import boto3

import build

REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
DEFAULT_DATA_KEY = "institute/latest.json"
USER_AGENT = "amu-institute-dashboard"


class ConfigError(Exception):
    """Raised when required configuration (env vars) is missing or invalid."""


class RefreshError(Exception):
    """Raised when the refresh cannot produce a usable payload."""


def _log(**fields) -> None:
    """Structured log line, matching the other refresh lambdas."""
    print(json.dumps(fields))


def _load_query_config() -> dict:
    """Parse INSTITUTE_SLATE_QUERIES into name -> (query_id, token, timeout).

    Expects a JSON object of the shape:
      {"queries": [{"name","query_id","token","timeout"}, ...], "base_url": ...}
    base_url is optional (build.BASE is used regardless). Raises ConfigError if
    the env var is missing/blank or contains no usable queries.
    """
    raw = (os.environ.get("INSTITUTE_SLATE_QUERIES") or "").strip()
    if not raw:
        raise ConfigError(
            "INSTITUTE_SLATE_QUERIES is missing or blank - set it to the "
            "slate_queries.json JSON (a {\"queries\":[...]} object)."
        )
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise ConfigError(f"INSTITUTE_SLATE_QUERIES is not valid JSON: {exc}") from exc

    out = {}
    for q in data.get("queries", []):
        name, qid, token = q.get("name"), q.get("query_id"), q.get("token")
        if name and qid and token:
            out[name] = (qid, token, int(q.get("timeout", 180)))
    if not out:
        raise ConfigError(
            "INSTITUTE_SLATE_QUERIES contained no usable queries "
            "(each needs name, query_id, and token)."
        )
    return out


def _fetch(qid: str, token: str, timeout: int) -> str:
    """Fetch one Slate query, using its own read timeout. Returns raw JSON text.

    URL and headers mirror build.fetch_one / datastore._fetch.
    """
    url = f"{build.BASE}?id={qid}&cmd=service&output=json&h={token}"
    ctx = ssl.create_default_context()
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, context=ctx, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
    build.rows_of(raw)  # validate JSON / expected shape
    return raw


def handler(event, context):  # noqa: ANN001, ARG001
    bucket = os.environ.get("DATA_BUCKET")
    if not bucket:
        raise ConfigError("DATA_BUCKET env var is required.")
    key = os.getenv("INSTITUTE_DATA_KEY", DEFAULT_DATA_KEY)

    queries = _load_query_config()
    _log(event="config_loaded", queries=sorted(queries), bucket=bucket, key=key)

    raws: dict = {}
    errors: dict = {}
    lock = threading.Lock()

    def worker(name: str) -> None:
        qid, token, timeout = queries[name]
        with lock:
            _log(event="fetch_start", query=name, timeout=timeout)
        try:
            raw = _fetch(qid, token, timeout)
            rows = len(build.rows_of(raw))
            with lock:
                raws[name] = raw
                _log(event="fetch_done", query=name, rows=rows)
        except Exception as exc:  # noqa: BLE001 - degrade gracefully per query
            with lock:
                raws[name] = None
                errors[name] = str(exc)
                _log(event="fetch_error", query=name, error=str(exc))

    threads = [
        threading.Thread(target=worker, args=(name,), name=f"load-{name}", daemon=True)
        for name in queries
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # q4 (Institute applicants) is required - mirror refresh_data.py, which
    # sys.exits when q4 is unavailable.
    if raws.get("q4") is None:
        raise RefreshError(
            "q4 (Institute applicants) is required and unavailable - cannot "
            f"build payload. error: {errors.get('q4', 'not configured')}"
        )

    data = build.payload(raws)

    body = json.dumps(data).encode("utf-8")
    boto3.client("s3", region_name=REGION).put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="no-store",
    )

    fetched = sorted(k for k, v in raws.items() if v is not None)
    _log(
        event="published",
        bucket=bucket,
        key=key,
        bytes=len(body),
        counts=data["counts"],
        fetched=fetched,
        errors=errors,
    )
    return {
        "ok": True,
        "bucket": bucket,
        "key": key,
        "counts": data["counts"],
        "fetched": fetched,
        "errors": errors,
    }
