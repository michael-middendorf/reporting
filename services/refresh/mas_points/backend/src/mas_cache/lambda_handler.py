"""AWS Lambda entrypoint for the mas-points refresh.

Fetches the Virtuous API key from Secrets Manager **at runtime** using the
function's execution role, then runs the raw-only refresh and publishes to the
S3 cache bucket (no local write in Lambda).

The secret value is read only inside the running function; it is injected into
the process env and never leaves AWS.
"""
from __future__ import annotations

import os

import boto3

from .config import load_config
from .refresh import refresh

# Plain-string secret holding the Virtuous API key (no JSON envelope).
SECRET_ID = os.environ.get("VIRTUOUS_API_KEY_SECRET_ID", "mas-report/virtuous-api-key")


def _load_api_key(region: str) -> str:
    client = boto3.client("secretsmanager", region_name=region)
    resp = client.get_secret_value(SecretId=SECRET_ID)
    secret = resp.get("SecretString")
    if not secret:
        raise RuntimeError(f"Secret {SECRET_ID} has no SecretString")
    return secret.strip()


def lambda_handler(event, context):  # noqa: ANN001 - AWS signature
    region = os.environ.get("AWS_REGION", "us-east-2")
    # Inject the key so load_config() picks it up like any other env var.
    if not os.environ.get("API_KEY"):
        os.environ["API_KEY"] = _load_api_key(region)

    # In Lambda the package root has no .env; all settings come from env vars.
    cfg = load_config(root_dir="/tmp")
    meta = refresh(cfg, publish=True, local=False)
    counts = meta["record_counts"]
    print(
        f"Refresh complete: {counts['notes']} notes, {counts['events']} events "
        f"→ s3://{cfg.s3_bucket}/{cfg.s3_prefix.rstrip('/')}/",
        flush=True,
    )
    return {"ok": True, "record_counts": counts, "generated_at": meta["generated_at"]}
