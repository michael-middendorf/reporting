"""Canonical sources/ writer for ReportData.

Layout:
  sources/{source}/{dataset}/dt=YYYY-MM-DD/data.jsonl.gz
  sources/{source}/{dataset}/dt=YYYY-MM-DD/meta.json
  sources/{source}/{dataset}/_latest.json
  sources/_catalog.json
"""

from __future__ import annotations

import gzip
import json
import os
from datetime import date, datetime, timezone
from typing import Any, Iterable

from .s3util import data_bucket, put_bytes, put_json, s3

RETAIN_DAYS = int(os.getenv("SOURCES_RETAIN_DAYS", "3"))
SCHEMA_VERSION = 1


def utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def dataset_prefix(source: str, dataset: str) -> str:
    return f"sources/{source}/{dataset}"


def day_prefix(source: str, dataset: str, dt: str) -> str:
    return f"{dataset_prefix(source, dataset)}/dt={dt}"


def _jsonl_gz(rows: Iterable[Any]) -> bytes:
    buf = bytearray()
    for row in rows:
        line = json.dumps(row, separators=(",", ":"), default=str)
        buf.extend(line.encode("utf-8"))
        buf.extend(b"\n")
    return gzip.compress(bytes(buf))


def publish_dataset(
    *,
    source: str,
    dataset: str,
    rows: list[Any],
    provenance: dict[str, Any] | None = None,
    dt: str | None = None,
    bucket: str | None = None,
    retain_days: int | None = None,
) -> dict[str, Any]:
    """Write one dataset snapshot + _latest pointer; prune old days; refresh catalog."""
    dest = bucket or data_bucket()
    day = dt or utc_today()
    retain = retain_days if retain_days is not None else RETAIN_DAYS
    prefix = day_prefix(source, dataset, day)
    pulled_at = datetime.now(timezone.utc).isoformat()

    body = _jsonl_gz(rows)
    put_bytes(
        f"{prefix}/data.jsonl.gz",
        body,
        content_type="application/gzip",
        content_encoding="gzip",
        bucket=dest,
    )

    meta = {
        "schema_version": SCHEMA_VERSION,
        "source": source,
        "dataset": dataset,
        "dt": day,
        "pulled_at": pulled_at,
        "record_count": len(rows),
        "content_type": "jsonl+gzip",
        "provenance": provenance or {},
    }
    put_json(f"{prefix}/meta.json", meta, bucket=dest)

    latest = {
        "schema_version": SCHEMA_VERSION,
        "source": source,
        "dataset": dataset,
        "dt": day,
        "prefix": prefix,
        "pulled_at": pulled_at,
        "record_count": len(rows),
    }
    put_json(f"{dataset_prefix(source, dataset)}/_latest.json", latest, bucket=dest)

    prune_old_days(source, dataset, keep=retain, bucket=dest)
    refresh_catalog(bucket=dest)
    return latest


def list_day_prefixes(source: str, dataset: str, *, bucket: str | None = None) -> list[str]:
    dest = bucket or data_bucket()
    base = f"{dataset_prefix(source, dataset)}/"
    paginator = s3().get_paginator("list_objects_v2")
    days: set[str] = set()
    for page in paginator.paginate(Bucket=dest, Prefix=base, Delimiter="/"):
        for entry in page.get("CommonPrefixes") or []:
            p = entry.get("Prefix") or ""
            # sources/slate/admissions/dt=2026-08-06/
            name = p[len(base) :].strip("/")
            if name.startswith("dt="):
                days.add(name[3:])
    return sorted(days)


def prune_old_days(
    source: str,
    dataset: str,
    *,
    keep: int = 3,
    bucket: str | None = None,
) -> list[str]:
    dest = bucket or data_bucket()
    days = list_day_prefixes(source, dataset, bucket=dest)
    if len(days) <= keep:
        return []
    drop = days[: max(0, len(days) - keep)]
    client = s3()
    deleted: list[str] = []
    for day in drop:
        prefix = f"{day_prefix(source, dataset, day)}/"
        for page in client.get_paginator("list_objects_v2").paginate(Bucket=dest, Prefix=prefix):
            objs = page.get("Contents") or []
            if not objs:
                continue
            client.delete_objects(
                Bucket=dest,
                Delete={"Objects": [{"Key": o["Key"]} for o in objs], "Quiet": True},
            )
            deleted.extend(o["Key"] for o in objs)
    return deleted


def refresh_catalog(*, bucket: str | None = None) -> dict[str, Any]:
    """Rebuild sources/_catalog.json by scanning sources/*/ */_latest.json."""
    dest = bucket or data_bucket()
    client = s3()
    entries: list[dict[str, Any]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=dest, Prefix="sources/"):
        for obj in page.get("Contents") or []:
            key = obj["Key"]
            if not key.endswith("/_latest.json"):
                continue
            if key.count("/") < 3:
                continue
            try:
                body = client.get_object(Bucket=dest, Key=key)["Body"].read()
                latest = json.loads(body)
                entries.append(
                    {
                        "source": latest.get("source"),
                        "dataset": latest.get("dataset"),
                        "dt": latest.get("dt"),
                        "pulled_at": latest.get("pulled_at"),
                        "record_count": latest.get("record_count"),
                        "latest_key": key,
                        "prefix": latest.get("prefix"),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                entries.append({"latest_key": key, "error": str(exc)})

    entries.sort(key=lambda e: (str(e.get("source") or ""), str(e.get("dataset") or "")))
    catalog = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "datasets": entries,
    }
    put_json("sources/_catalog.json", catalog, bucket=dest)
    return catalog


def rows_from_slate_payload(payload: Any) -> list[Any]:
    """Normalize Slate query JSON to a list of row objects."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if isinstance(payload.get("row"), list):
            return payload["row"]
        if isinstance(payload.get("rows"), list):
            return payload["rows"]
        if isinstance(payload.get("data"), list):
            return payload["data"]
    return []
