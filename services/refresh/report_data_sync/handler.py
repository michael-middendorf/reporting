"""Copy legacy enrollment/MAS/points caches into DATA_BUCKET prefixes (read-only on sources)."""

from __future__ import annotations

import os
from typing import Any

import boto3

REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"

# Source buckets are legacy publishers — never modified by this job.
ENROLLMENT_SOURCE = os.getenv(
    "ENROLLMENT_SOURCE_BUCKET",
    "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
)
MAS_SOURCE = os.getenv(
    "MAS_SOURCE_BUCKET",
    "mas-report-cache-905418447941-us-east-2",
)

# (source_bucket, source_prefix, dest_prefix)
SYNCS = [
    (ENROLLMENT_SOURCE, "dashboard/", "enrollment/"),
    (MAS_SOURCE, "data/", "mas/data/"),
    (MAS_SOURCE, "points/data/", "points/data/"),
]


def _sync_prefix(s3: Any, src_bucket: str, src_prefix: str, dest_bucket: str, dest_prefix: str) -> int:
    paginator = s3.get_paginator("list_objects_v2")
    copied = 0
    for page in paginator.paginate(Bucket=src_bucket, Prefix=src_prefix):
        for obj in page.get("Contents") or []:
            key = obj["Key"]
            if key.endswith("/"):
                continue
            rel = key[len(src_prefix) :] if key.startswith(src_prefix) else key
            dest_key = f"{dest_prefix}{rel}"
            s3.copy_object(
                Bucket=dest_bucket,
                Key=dest_key,
                CopySource={"Bucket": src_bucket, "Key": key},
            )
            copied += 1
    return copied


def handler(event, context):  # noqa: ANN001, ARG001
    dest = os.environ["DATA_BUCKET"]
    s3 = boto3.client("s3", region_name=REGION)
    results = []
    for src_bucket, src_prefix, dest_prefix in SYNCS:
        n = _sync_prefix(s3, src_bucket, src_prefix, dest, dest_prefix)
        results.append(
            {
                "from": f"s3://{src_bucket}/{src_prefix}",
                "to": f"s3://{dest}/{dest_prefix}",
                "copied": n,
            }
        )
    return {"ok": True, "dest": dest, "syncs": results}
