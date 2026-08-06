"""Load canonical sources/* datasets from ReportData."""

from __future__ import annotations

import gzip
import json
from typing import Any

from .s3util import data_bucket, s3
from .sources import dataset_prefix


def read_json(key: str, *, bucket: str | None = None) -> Any:
    dest = bucket or data_bucket()
    body = s3().get_object(Bucket=dest, Key=key)["Body"].read()
    return json.loads(body)


def latest_pointer(source: str, dataset: str, *, bucket: str | None = None) -> dict[str, Any]:
    return read_json(f"{dataset_prefix(source, dataset)}/_latest.json", bucket=bucket)


def load_jsonl_dataset(source: str, dataset: str, *, bucket: str | None = None) -> tuple[list[Any], dict[str, Any]]:
    """Return (rows, latest_meta) for sources/{source}/{dataset}/_latest."""
    dest = bucket or data_bucket()
    latest = latest_pointer(source, dataset, bucket=dest)
    prefix = latest.get("prefix") or f"{dataset_prefix(source, dataset)}/dt={latest['dt']}"
    meta = read_json(f"{prefix}/meta.json", bucket=dest)
    raw = s3().get_object(Bucket=dest, Key=f"{prefix}/data.jsonl.gz")["Body"].read()
    text = gzip.decompress(raw).decode("utf-8")
    rows: list[Any] = []
    for line in text.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows, meta
