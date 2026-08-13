"""Institute publisher → sources/institute/{query}/ raw only.

Fetches Slate queries concurrently, writes each as canonical JSONL under
sources/institute/{name}/. Derived dashboard payload is built on-read by
InstituteProcess (no derived S3 object).
"""

from __future__ import annotations

import json
import os
import ssl
import threading
from urllib.request import Request, urlopen

import build
from common.sources import publish_dataset, rows_from_slate_payload

USER_AGENT = "amu-institute-dashboard"


class ConfigError(Exception):
    pass


class RefreshError(Exception):
    pass


def _log(**fields) -> None:
    print(json.dumps(fields), flush=True)


def _load_query_config() -> dict:
    raw = (os.environ.get("INSTITUTE_SLATE_QUERIES") or "").strip()
    if not raw:
        raise ConfigError("INSTITUTE_SLATE_QUERIES is missing or blank")
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
        raise ConfigError("INSTITUTE_SLATE_QUERIES contained no usable queries")
    return out


def _fetch(qid: str, token: str, timeout: int) -> object:
    url = f"{build.BASE}?id={qid}&cmd=service&output=json&h={token}"
    ctx = ssl.create_default_context()
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, context=ctx, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def handler(event, context):  # noqa: ANN001, ARG001
    queries = _load_query_config()
    _log(event="config_loaded", queries=sorted(queries))

    raws: dict = {}
    errors: dict = {}
    lock = threading.Lock()

    def worker(name: str) -> None:
        qid, token, timeout = queries[name]
        with lock:
            _log(event="fetch_start", query=name, timeout=timeout)
        try:
            payload = _fetch(qid, token, timeout)
            rows = rows_from_slate_payload(payload)
            # Also keep original row extraction from build for compatibility
            if not rows:
                rows = build.rows_of(json.dumps(payload))
            publish_dataset(
                source="institute",
                dataset=name,
                rows=rows if isinstance(rows, list) else [],
                provenance={
                    "system": "slate",
                    "query_id": qid,
                    "query_name": name,
                },
            )
            with lock:
                raws[name] = payload
                _log(event="fetch_done", query=name, rows=len(rows) if isinstance(rows, list) else 0)
        except Exception as exc:  # noqa: BLE001
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

    if raws.get("q4") is None and "q4" in queries:
        raise RefreshError(
            "q4 (Institute applicants) is required and unavailable - "
            f"error: {errors.get('q4', 'not configured')}"
        )

    fetched = sorted(k for k, v in raws.items() if v is not None)
    return {"ok": True, "source": "institute", "fetched": fetched, "errors": errors}

def _fetch_all(queries: dict) -> tuple[dict, dict]:
    """Fetch every configured query concurrently. Returns (raws, errors).

    Each query gets its own thread + read timeout; q1/q2 (~600s ceiling, ~15s
    in practice) run alongside the faster ones so wall-clock is the slowest
    single query, not the sum. A failed query degrades to None (logged in
    errors) rather than aborting the whole run.
    """
    raws: dict = {}
    errors: dict = {}
    lock = threading.Lock()

    def worker(name: str) -> None:
        qid, token, timeout = queries[name]
        try:
            raw = _fetch(qid, token, timeout)
            with lock:
                raws[name] = raw
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
    return raws, errors


def invoke_handler(event, context):  # noqa: ANN001, ARG001
    """On-demand entrypoint for the web app (synchronous Lambda invoke).

    Runs the six Slate queries live and RETURNS the built dashboard payload
    instead of writing it to S3. The /api/institute-data route invokes this
    per page load, so the dashboard always reflects current Slate data with no
    cron or S3 cache. No DATA_BUCKET / S3 permissions needed.
    """
    queries = _load_query_config()
    _log(event="ondemand_start", queries=sorted(queries))

    raws, errors = _fetch_all(queries)

    # q4 (Institute applicants) is the core dataset - without it there is no
    # payload to render, so surface a clear failure to the caller.
    if raws.get("q4") is None:
        raise RefreshError(
            "q4 (Institute applicants) is required and unavailable - cannot "
            f"build payload. error: {errors.get('q4', 'not configured')}"
        )

    data = build.payload(raws)
    data["source"] = "slate-live"
    data["errors"] = errors

    _log(
        event="ondemand_done",
        counts=data["counts"],
        fetched=sorted(k for k, v in raws.items() if v is not None),
        errors=errors,
    )
    return data
