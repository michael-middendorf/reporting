"""Chancellor's Gala report publisher (DST-3095).

Pulls the gala revenue feed from the giving admin and publishes it for
/advancement/gala:

* ``gala/latest.json``: the feed payload plus ``publishedAt``.
* ``gala/snapshots/YYYY-MM-DD.json``: the same document, overwritten on each
  run so the file holds that Eastern day's last snapshot.
* ``gala/snapshots/index.json``: one small row per day (gross, committed
  expenses, net) used for the daily trend and day over day deltas.

The feed needs a bearer token. It is read from Secrets Manager (secret id in
GALA_REPORT_FEED_SECRET_ID; the SecretString is the raw token, or JSON with a
"token" key) and is never logged. An invalid payload raises before anything is
written, so the last good latest.json stays in place.

CLI (reads a local JSON file, never touches the network or S3):
  python3 handler.py --dry-run --file fixtures/gala-feed-fixture.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Protocol
from zoneinfo import ZoneInfo

DEFAULT_FEED_URL = "https://giving.avemaria.edu/api/internal/gala-report"
DEFAULT_SECRET_ID = "amu/giving/gala-report-feed"
LATEST_KEY = "gala/latest.json"
SNAPSHOT_PREFIX = "gala/snapshots/"
INDEX_KEY = "gala/snapshots/index.json"
SCHEMA_VERSION = 1
EASTERN = ZoneInfo("America/New_York")
TIMEOUT_S = 30
ATTEMPTS = 3
CATEGORY_KEYS = (
    "sponsorship",
    "underwriting",
    "tickets",
    "match",
    "paddleRaise",
    "otherGifts",
)


class InvalidFeed(ValueError):
    """The feed payload does not match schema version 1."""


class Store(Protocol):
    def get_json(self, key: str) -> Any | None: ...
    def put_json(self, key: str, payload: Any) -> str: ...


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


def _num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _need_obj(parent: dict[str, Any], key: str, path: str) -> dict[str, Any]:
    value = parent.get(key)
    if not isinstance(value, dict):
        raise InvalidFeed(f"{path}{key} must be an object")
    return value


def _need_nums(obj: dict[str, Any], keys: tuple[str, ...], path: str) -> None:
    for key in keys:
        if not _num(obj.get(key)):
            raise InvalidFeed(f"{path}.{key} must be a number")


def validate_feed(payload: Any) -> dict[str, Any]:
    """Return the payload when it matches schema version 1, else raise InvalidFeed."""
    if not isinstance(payload, dict):
        raise InvalidFeed("payload must be an object")
    if payload.get("schemaVersion") != SCHEMA_VERSION or isinstance(payload.get("schemaVersion"), bool):
        raise InvalidFeed(f"schemaVersion must be {SCHEMA_VERSION}")
    as_of = payload.get("asOf")
    if not isinstance(as_of, str) or not as_of:
        raise InvalidFeed("asOf must be a string")
    try:
        parse_iso(as_of)
    except ValueError:
        raise InvalidFeed("asOf must be an ISO timestamp") from None
    event = _need_obj(payload, "event", "")
    for key in ("key", "segmentCode", "eventDate"):
        if not isinstance(event.get(key), str):
            raise InvalidFeed(f"event.{key} must be a string")

    categories = _need_obj(payload, "categories", "")
    for name in CATEGORY_KEYS:
        cat = _need_obj(categories, name, "categories.")
        _need_nums(cat, ("actual", "commitment", "actualPlusCommitment", "giftCount", "askCount"), f"categories.{name}")

    gross = _need_obj(payload, "gross", "")
    _need_nums(gross, ("actual", "actualPlusCommitment"), "gross")

    expenses = _need_obj(payload, "expenses", "")
    _need_nums(expenses, ("committed", "paid", "lineCount"), "expenses")
    if not isinstance(expenses.get("byCategory"), list):
        raise InvalidFeed("expenses.byCategory must be an array")

    net = _need_obj(payload, "netAfterExpenses", "")
    _need_nums(net, ("actual", "actualPlusCommitment"), "netAfterExpenses")

    seats = _need_obj(payload, "seats", "")
    _need_nums(seats, ("sold", "comp", "reserved"), "seats")

    quality = payload.get("dataQuality")
    if not isinstance(quality, list):
        raise InvalidFeed("dataQuality must be an array")
    for i, item in enumerate(quality):
        if not isinstance(item, dict) or not isinstance(item.get("code"), str) or not isinstance(item.get("message"), str):
            raise InvalidFeed(f"dataQuality[{i}] needs string code and message")
    return payload


def parse_iso(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


# --------------------------------------------------------------------------
# Document building
# --------------------------------------------------------------------------


def eastern_date(now: dt.datetime) -> str:
    return now.astimezone(EASTERN).date().isoformat()


def iso_utc(now: dt.datetime) -> str:
    return now.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_latest(payload: dict[str, Any], now: dt.datetime) -> dict[str, Any]:
    doc = dict(payload)
    doc["publishedAt"] = iso_utc(now)
    return doc


def index_row(payload: dict[str, Any], date: str) -> dict[str, Any]:
    return {
        "date": date,
        "gross": {
            "actual": payload["gross"]["actual"],
            "actualPlusCommitment": payload["gross"]["actualPlusCommitment"],
        },
        "expenses": {"committed": payload["expenses"]["committed"]},
        "netAfterExpenses": {
            "actual": payload["netAfterExpenses"]["actual"],
            "actualPlusCommitment": payload["netAfterExpenses"]["actualPlusCommitment"],
        },
    }


def upsert_index(existing: Any, payload: dict[str, Any], date: str) -> list[dict[str, Any]]:
    rows = [r for r in existing if isinstance(r, dict) and isinstance(r.get("date"), str)] if isinstance(existing, list) else []
    rows = [r for r in rows if r["date"] != date]
    rows.append(index_row(payload, date))
    rows.sort(key=lambda r: r["date"])
    return rows


def publish(payload: Any, store: Store, now: dt.datetime) -> dict[str, Any]:
    """Validate, then write the day snapshot, the index and latest.json (in that order)."""
    validate_feed(payload)
    date = eastern_date(now)
    doc = build_latest(payload, now)
    index = upsert_index(store.get_json(INDEX_KEY), payload, date)
    snapshot_uri = store.put_json(f"{SNAPSHOT_PREFIX}{date}.json", doc)
    index_uri = store.put_json(INDEX_KEY, index)
    latest_uri = store.put_json(LATEST_KEY, doc)
    return {
        "latest": latest_uri,
        "snapshot": snapshot_uri,
        "index": index_uri,
        "date": date,
        "asOf": doc["asOf"],
        "publishedAt": doc["publishedAt"],
        "historyDays": len(index),
    }


# --------------------------------------------------------------------------
# Feed fetch and token
# --------------------------------------------------------------------------


def parse_token(secret_string: str) -> str:
    raw = (secret_string or "").strip()
    if raw.startswith("{"):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            raw = str(data.get("token") or "").strip()
    if not raw:
        raise RuntimeError("gala report feed token is empty")
    return raw


def read_token() -> str:
    import boto3

    secret_id = os.environ.get("GALA_REPORT_FEED_SECRET_ID") or DEFAULT_SECRET_ID
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-2"
    out = boto3.client("secretsmanager", region_name=region).get_secret_value(SecretId=secret_id)
    return parse_token(out.get("SecretString") or "")


def fetch_feed(
    url: str,
    token: str,
    *,
    urlopen: Callable[..., Any] = urllib.request.urlopen,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    """GET the feed. Retries 5xx and timeouts (ATTEMPTS tries); 4xx fails at once. Never logs the token."""
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            # CloudFront may not forward Authorization to the origin; the
            # feed accepts the same token in this header.
            "X-Gala-Feed-Token": token,
            "Accept": "application/json",
        },
    )
    last = "unknown error"
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urlopen(request, timeout=TIMEOUT_S) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise RuntimeError(f"gala report feed returned HTTP {exc.code}") from None
            last = f"HTTP {exc.code}"
        except (TimeoutError, socket.timeout):
            last = "timeout"
        except urllib.error.URLError as exc:
            if not isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise RuntimeError("gala report feed request failed") from None
            last = "timeout"
        except json.JSONDecodeError:
            raise RuntimeError("gala report feed did not return JSON") from None
        log(f"  gala-report feed attempt {attempt}/{ATTEMPTS} failed: {last}")
        if attempt < ATTEMPTS:
            sleep(2.0 * attempt)
    raise RuntimeError(f"gala report feed failed after {ATTEMPTS} attempts: {last}")


# --------------------------------------------------------------------------
# S3 store and entry points
# --------------------------------------------------------------------------


class S3Store:
    def get_json(self, key: str) -> Any | None:
        from common.s3util import data_bucket, s3

        client = s3()
        try:
            obj = client.get_object(Bucket=data_bucket(), Key=key)
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
            if code in {"NoSuchKey", "404", "NotFound"}:
                return None
            raise
        return json.loads(obj["Body"].read().decode("utf-8"))

    def put_json(self, key: str, payload: Any) -> str:
        from common.s3util import put_json

        return put_json(key, payload)


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    url = os.environ.get("GALA_REPORT_FEED_URL") or DEFAULT_FEED_URL
    payload = fetch_feed(url, read_token())
    validate_feed(payload)
    summary = publish(payload, S3Store(), dt.datetime.now(dt.timezone.utc))
    log(f"  gala-report published date={summary['date']} historyDays={summary['historyDays']}")
    return summary


class _PrintStore:
    """Dry-run store: reads nothing, prints each write's key and size."""

    def get_json(self, key: str) -> Any | None:
        return None

    def put_json(self, key: str, payload: Any) -> str:
        size = len(json.dumps(payload, separators=(",", ":")))
        print(f"would write {key} ({size} bytes)")
        return f"dry-run://{key}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gala report publisher")
    parser.add_argument("--dry-run", action="store_true", required=True, help="read --file instead of fetching; write nothing")
    parser.add_argument("--file", required=True, help="local feed JSON file")
    args = parser.parse_args(argv)
    with open(args.file, encoding="utf-8") as fh:
        payload = json.load(fh)
    summary = publish(payload, _PrintStore(), dt.datetime.now(dt.timezone.utc))
    doc = build_latest(payload, dt.datetime.now(dt.timezone.utc))
    print(json.dumps({"summary": summary, "indexRow": index_row(payload, summary["date"]), "latestKeys": sorted(doc)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
