#!/usr/bin/env python3
"""Cached Slate dashboard Lambda backed by service query URLs."""

from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import boto3


DEFAULT_REGION = "us-east-2"
DEFAULT_CACHE_BUCKET = "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2"
DEFAULT_CACHE_KEY = "dashboard/slate-report-cache.json"
DEFAULT_QUERY_LINKS_FILE = "real-query-links.json"
DEFAULT_MAX_INLINE_BYTES = 5_500_000
DEFAULT_PRESIGN_EXPIRATION_SECONDS = 3600
DEFAULT_FETCH_TIMEOUT_SECONDS = 900
DEFAULT_USER_AGENT = "Mozilla/5.0 enrollment-pipeline-slate-dashboard-cache"
AWS_SESSION = None

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


class ConfigError(RuntimeError):
    """Configuration-related failure."""


class RefreshError(RuntimeError):
    """Raised when the refresh process fails."""


@dataclass(frozen=True)
class Config:
    aws_region: str
    cache_bucket: str
    cache_key: str
    cache_gzip_key: str
    report_prefix: str
    query_links_file: Path
    max_inline_bytes: int
    presign_expiration_seconds: int
    fetch_timeout_seconds: int
    user_agent: str


def log(message: str, **metadata: Any) -> None:
    print(json.dumps({"message": message, **metadata}, sort_keys=True), flush=True)


def load_config() -> Config:
    aws_region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or DEFAULT_REGION
    cache_bucket = os.getenv("CACHE_BUCKET") or DEFAULT_CACHE_BUCKET
    cache_key = os.getenv("CACHE_KEY") or DEFAULT_CACHE_KEY
    if not cache_key.endswith(".json"):
        raise ConfigError("CACHE_KEY must end with .json")

    query_links_file = Path(
        os.getenv("QUERY_LINKS_FILE") or Path(__file__).resolve().parent / DEFAULT_QUERY_LINKS_FILE
    )
    if not query_links_file.exists():
        raise ConfigError(f"Query links file not found: {query_links_file}")

    return Config(
        aws_region=aws_region,
        cache_bucket=cache_bucket,
        cache_key=cache_key,
        cache_gzip_key=f"{cache_key}.gz",
        report_prefix=f"{cache_key.rsplit('/', 1)[0]}/reports",
        query_links_file=query_links_file,
        max_inline_bytes=int(os.getenv("MAX_INLINE_RESPONSE_BYTES", DEFAULT_MAX_INLINE_BYTES)),
        presign_expiration_seconds=int(
            os.getenv("PRESIGN_EXPIRATION_SECONDS", DEFAULT_PRESIGN_EXPIRATION_SECONDS)
        ),
        fetch_timeout_seconds=int(os.getenv("FETCH_TIMEOUT_SECONDS", DEFAULT_FETCH_TIMEOUT_SECONDS)),
        user_agent=os.getenv("QUERY_SERVICE_USER_AGENT", DEFAULT_USER_AGENT),
    )


def aws_session(config: Config) -> Any:
    global AWS_SESSION
    if AWS_SESSION is not None:
        return AWS_SESSION

    default_session = boto3.Session(region_name=config.aws_region)
    credentials = default_session.get_credentials()
    if credentials and credentials.access_key:
        AWS_SESSION = default_session
        return AWS_SESSION

    exported = subprocess.run(
        ["aws", "configure", "export-credentials", "--format", "process"],
        check=True,
        capture_output=True,
        text=True,
    )
    exported_credentials = json.loads(exported.stdout)
    AWS_SESSION = boto3.Session(
        aws_access_key_id=exported_credentials["AccessKeyId"],
        aws_secret_access_key=exported_credentials["SecretAccessKey"],
        aws_session_token=exported_credentials.get("SessionToken"),
        region_name=config.aws_region,
    )
    return AWS_SESSION


def s3_client(config: Config) -> Any:
    return aws_session(config).client("s3", region_name=config.aws_region)


def load_query_links(path: Path) -> Tuple[List[str], Dict[str, Dict[str, str]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RefreshError("real-query-links.json must contain an object of source_key -> url")

    ordered_names: List[str] = []
    normalized: Dict[str, Dict[str, str]] = {}
    for source_key, url in raw.items():
        if not isinstance(source_key, str) or not isinstance(url, str):
            raise RefreshError("real-query-links.json entries must be string -> string")
        if source_key not in KEY_ALIASES:
            raise RefreshError(f"Unexpected query service key: {source_key}")
        normalized_name = KEY_ALIASES[source_key]
        ordered_names.append(normalized_name)
        normalized[normalized_name] = {"source_key": source_key, "url": url.strip()}
    return ordered_names, normalized


def report_object_keys(config: Config, report_name: str) -> Tuple[str, str]:
    base = f"{config.report_prefix}/{report_name}.json"
    return base, f"{base}.gz"


def inspect_downloaded_payload(content_type: Optional[str], first_bytes: bytes) -> Tuple[bool, Optional[str]]:
    prefix = first_bytes.lstrip()
    if content_type and "json" not in content_type.lower():
        return False, f"Unexpected content type: {content_type}"
    if not prefix:
        return False, "Downloaded payload was empty"
    if prefix[:1] not in {b"{", b"["}:
        return False, f"Downloaded payload did not start with JSON: {prefix[:80]!r}"
    return True, None


def fetch_report_to_tempfile(config: Config, url: str) -> Tuple[int, Optional[str], str, int, bytes]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": config.user_agent,
        },
    )
    with urllib.request.urlopen(request, timeout=config.fetch_timeout_seconds) as response:
        status_code = getattr(response, "status", 200)
        content_type = response.headers.get("content-type")
        total_bytes = 0
        first_bytes = b""
        with tempfile.NamedTemporaryFile(prefix="slate-report-", suffix=".json", delete=False) as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                if len(first_bytes) < 256:
                    needed = 256 - len(first_bytes)
                    first_bytes += chunk[:needed]
                handle.write(chunk)
                total_bytes += len(chunk)
            temp_path = handle.name
        return status_code, content_type, temp_path, total_bytes, first_bytes


def summarize_json_file(path: str) -> Tuple[Optional[int], Optional[List[str]]]:
    if Path(path).stat().st_size > 2_000_000:
        return None, None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict) and isinstance(payload.get("row"), list):
        rows = payload["row"]
    elif isinstance(payload, list):
        rows = payload
    else:
        return None, None
    if rows and isinstance(rows[0], dict):
        return len(rows), list(rows[0].keys())
    return len(rows), None


def put_report_objects(
    config: Config,
    report_name: str,
    temp_json_path: str,
    content_type: Optional[str],
) -> Dict[str, Any]:
    client = s3_client(config)
    json_key, gzip_key = report_object_keys(config, report_name)
    client.upload_file(
        temp_json_path,
        config.cache_bucket,
        json_key,
        ExtraArgs={
            "ContentType": content_type or "application/json",
            "CacheControl": "no-store",
        },
    )

    with tempfile.NamedTemporaryFile(prefix=f"{report_name}-", suffix=".json.gz", delete=False) as gzip_file:
        with open(temp_json_path, "rb") as source_handle:
            with gzip.GzipFile(fileobj=gzip_file, mode="wb") as gzip_handle:
                shutil.copyfileobj(source_handle, gzip_handle)
        gzip_path = gzip_file.name

    client.upload_file(
        gzip_path,
        config.cache_bucket,
        gzip_key,
        ExtraArgs={
            "ContentType": content_type or "application/json",
            "ContentEncoding": "gzip",
            "CacheControl": "no-store",
        },
    )
    gzip_bytes = Path(gzip_path).stat().st_size
    os.unlink(gzip_path)
    return {"json_key": json_key, "gzip_key": gzip_key, "gzip_bytes": gzip_bytes}


def put_cache_payload(config: Config, payload: Dict[str, Any]) -> Dict[str, Any]:
    client = s3_client(config)
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    gzip_body = gzip.compress(body)

    client.put_object(
        Bucket=config.cache_bucket,
        Key=config.cache_key,
        Body=body,
        ContentType="application/json",
        CacheControl="no-store",
    )
    client.put_object(
        Bucket=config.cache_bucket,
        Key=config.cache_gzip_key,
        Body=gzip_body,
        ContentType="application/json",
        ContentEncoding="gzip",
        CacheControl="no-store",
    )
    return {
        "bucket": config.cache_bucket,
        "key": config.cache_key,
        "gzip_key": config.cache_gzip_key,
        "bytes": len(body),
        "gzip_bytes": len(gzip_body),
    }


def read_cached_payload(config: Config) -> Tuple[Dict[str, Any], int]:
    client = s3_client(config)
    response = client.get_object(Bucket=config.cache_bucket, Key=config.cache_key)
    body = response["Body"].read()
    return json.loads(body.decode("utf-8")), len(body)


def build_presigned_urls(config: Config) -> Dict[str, str]:
    client = s3_client(config)
    expires_in = config.presign_expiration_seconds
    return {
        "json": client.generate_presigned_url(
            "get_object",
            Params={"Bucket": config.cache_bucket, "Key": config.cache_key},
            ExpiresIn=expires_in,
        ),
        "json_gzip": client.generate_presigned_url(
            "get_object",
            Params={"Bucket": config.cache_bucket, "Key": config.cache_gzip_key},
            ExpiresIn=expires_in,
        ),
    }


def build_report_presigned_urls(config: Config, report_entries: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    client = s3_client(config)
    expires_in = config.presign_expiration_seconds
    urls: Dict[str, Dict[str, str]] = {}
    for report_name, report_entry in report_entries.items():
        json_key = report_entry.get("json_key")
        gzip_key = report_entry.get("gzip_key")
        if not json_key or not gzip_key:
            continue
        urls[report_name] = {
            "json": client.generate_presigned_url(
                "get_object",
                Params={"Bucket": config.cache_bucket, "Key": json_key},
                ExpiresIn=expires_in,
            ),
            "json_gzip": client.generate_presigned_url(
                "get_object",
                Params={"Bucket": config.cache_bucket, "Key": gzip_key},
                ExpiresIn=expires_in,
            ),
        }
    return urls


def refresh_all_reports(config: Config, ordered_names: List[str], query_links: Dict[str, Dict[str, str]]) -> Dict[str, Any]:
    refresh_started = time.time()
    reports: Dict[str, Any] = {}
    overall_success = True

    for report_name in ordered_names:
        source = query_links[report_name]
        report_started = time.time()
        temp_path: Optional[str] = None
        try:
            status_code, content_type, temp_path, payload_bytes, first_bytes = fetch_report_to_tempfile(
                config, source["url"]
            )
            json_valid, validation_error = inspect_downloaded_payload(content_type, first_bytes)
            row_count, columns = summarize_json_file(temp_path) if json_valid else (None, None)
            object_result = put_report_objects(config, report_name, temp_path, content_type)
            duration_ms = int(round((time.time() - report_started) * 1000))
            reports[report_name] = {
                "success": json_valid,
                "source_key": source["source_key"],
                "url": source["url"],
                "http_status": status_code,
                "row_count": row_count,
                "columns": columns,
                "duration_ms": duration_ms,
                "bytes": payload_bytes,
                "json_key": object_result["json_key"],
                "gzip_key": object_result["gzip_key"],
                "gzip_bytes": object_result["gzip_bytes"],
                "error": validation_error,
            }
            if not json_valid:
                overall_success = False
            log(
                "report_refreshed",
                report_name=report_name,
                source_key=source["source_key"],
                row_count=row_count,
                duration_ms=duration_ms,
                http_status=status_code,
                bytes=payload_bytes,
                json_key=object_result["json_key"],
                json_valid=json_valid,
            )
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, RefreshError, ValueError) as exc:
            overall_success = False
            duration_ms = int(round((time.time() - report_started) * 1000))
            reports[report_name] = {
                "success": False,
                "source_key": source["source_key"],
                "url": source["url"],
                "http_status": getattr(exc, "code", None),
                "row_count": None,
                "columns": None,
                "duration_ms": duration_ms,
                "bytes": None,
                "json_key": None,
                "gzip_key": None,
                "gzip_bytes": None,
                "error": str(exc),
            }
            log(
                "report_refresh_failed",
                report_name=report_name,
                source_key=source["source_key"],
                duration_ms=duration_ms,
                error=str(exc),
            )
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    generated_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    refresh_duration_ms = int(round((time.time() - refresh_started) * 1000))
    return {
        "success": overall_success,
        "source": "slate-query-service",
        "generated_at": generated_at,
        "refresh_duration_ms": refresh_duration_ms,
        "report_order": ordered_names,
        "reports": reports,
    }


def refresh_cache(config: Config) -> Dict[str, Any]:
    ordered_names, query_links = load_query_links(config.query_links_file)
    manifest_payload = refresh_all_reports(config, ordered_names, query_links)
    cache_result = put_cache_payload(config, manifest_payload)
    log("cache_written", **cache_result)
    return {
        "success": manifest_payload["success"],
        "mode": "refresh",
        "generated_at": manifest_payload["generated_at"],
        "refresh_duration_ms": manifest_payload["refresh_duration_ms"],
        "bucket": cache_result["bucket"],
        "key": cache_result["key"],
        "gzip_key": cache_result["gzip_key"],
        "bytes": cache_result["bytes"],
        "gzip_bytes": cache_result["gzip_bytes"],
        "reports": manifest_payload["reports"],
    }


def dashboard_response(config: Config, event: Dict[str, Any]) -> Dict[str, Any]:
    payload, payload_bytes = read_cached_payload(config)
    return_mode = (event.get("return_mode") or "auto").strip().lower()
    if return_mode in {"auto", "inline"} and payload_bytes <= config.max_inline_bytes:
        return {
            "success": True,
            "mode": "dashboard",
            "source": "s3-cache",
            "inline": True,
            "payload_bytes": payload_bytes,
            "bucket": config.cache_bucket,
            "key": config.cache_key,
            "data": payload,
        }

    return {
        "success": True,
        "mode": "dashboard",
        "source": "s3-cache",
        "inline": False,
        "payload_bytes": payload_bytes,
        "bucket": config.cache_bucket,
        "key": config.cache_key,
        "gzip_key": config.cache_gzip_key,
        "generated_at": payload.get("generated_at"),
        "presigned_urls": build_presigned_urls(config),
        "report_presigned_urls": build_report_presigned_urls(config, payload.get("reports", {})),
        "manifest": payload,
    }


def lambda_handler(event: Optional[Dict[str, Any]], context: Any) -> Dict[str, Any]:
    event = event or {}
    config = load_config()
    mode = (event.get("mode") or "dashboard").strip().lower()
    log("lambda_invocation", mode=mode, cache_bucket=config.cache_bucket, cache_key=config.cache_key)
    if mode == "refresh":
        return refresh_cache(config)
    if mode == "dashboard":
        return dashboard_response(config, event)
    raise ConfigError("mode must be 'refresh' or 'dashboard'")


if __name__ == "__main__":
    response = lambda_handler({"mode": os.getenv("MODE", "dashboard")}, None)
    print(json.dumps(response, indent=2, sort_keys=True))
