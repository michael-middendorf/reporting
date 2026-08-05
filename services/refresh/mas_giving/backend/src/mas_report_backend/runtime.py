from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_AWS_REGION = "us-east-2"
DEFAULT_VIRTUOUS_BASE_URL = "https://api.virtuoussoftware.com"


def _running_in_lambda() -> bool:
    return bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))


def _read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _env(name: str, dotenv: dict[str, str], default: str | None = None) -> str | None:
    return os.environ.get(name, dotenv.get(name, default))


def _env_int(name: str, dotenv: dict[str, str], default: int) -> int:
    raw = _env(name, dotenv)
    if raw in (None, ""):
        return default
    return int(raw)


def _env_path(name: str, dotenv: dict[str, str], root: Path, default: str | None = None) -> Path | None:
    raw = _env(name, dotenv, default)
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = root / path
    return path.resolve()


@dataclass(frozen=True)
class RuntimeConfig:
    project_root: Path
    aws_region: str
    virtuous_base_url: str
    virtuous_api_key: str | None
    virtuous_secret_id: str | None
    report_bucket: str | None
    report_prefix: str
    cache_bucket: str | None
    cache_prefix: str
    local_report_dir: Path | None
    local_cache_dir: Path | None
    page_size: int
    contact_chunk_size: int
    gift_window_days: int
    note_window_days: int
    activity_default_days: int
    recent_gift_window_days: int
    timeout_seconds: int
    mode: str = "sync"

    @property
    def should_publish_s3(self) -> bool:
        return bool(self.report_bucket or self.cache_bucket)

    @property
    def should_publish_local(self) -> bool:
        return bool(self.local_report_dir or self.local_cache_dir)


def load_runtime_config(project_root: str | Path | None = None) -> RuntimeConfig:
    root = Path(project_root or Path.cwd()).resolve()
    dotenv = _read_dotenv(root / ".env")
    report_prefix = (_env("MAS_REPORT_REPORT_PREFIX", dotenv, "data") or "data").strip("/")
    cache_prefix = (_env("MAS_REPORT_CACHE_PREFIX", dotenv, "") or "").strip("/")
    default_local_report_dir = None if _running_in_lambda() else "frontend/data"
    default_local_cache_dir = None if _running_in_lambda() else ".build/cache"
    return RuntimeConfig(
        project_root=root,
        aws_region=_env("AWS_REGION", dotenv, DEFAULT_AWS_REGION) or DEFAULT_AWS_REGION,
        virtuous_base_url=_env("VIRTUOUS_BASE_URL", dotenv, DEFAULT_VIRTUOUS_BASE_URL) or DEFAULT_VIRTUOUS_BASE_URL,
        virtuous_api_key=_env("API_KEY", dotenv) or _env("VIRTUOUS_API_KEY", dotenv),
        virtuous_secret_id=_env("MAS_REPORT_VIRTUOUS_SECRET_ID", dotenv),
        report_bucket=_env("MAS_REPORT_REPORT_BUCKET", dotenv),
        report_prefix=report_prefix,
        cache_bucket=_env("MAS_REPORT_CACHE_BUCKET", dotenv),
        cache_prefix=cache_prefix,
        local_report_dir=_env_path("MAS_REPORT_LOCAL_REPORT_DIR", dotenv, root, default_local_report_dir),
        local_cache_dir=_env_path("MAS_REPORT_LOCAL_CACHE_DIR", dotenv, root, default_local_cache_dir),
        page_size=_env_int("PAGE_SIZE", dotenv, 500),
        contact_chunk_size=_env_int("CONTACT_CHUNK_SIZE", dotenv, 150),
        gift_window_days=_env_int("GIFT_WINDOW_DAYS", dotenv, 365),
        note_window_days=_env_int("NOTE_WINDOW_DAYS", dotenv, 365),
        activity_default_days=_env_int("ACTIVITY_DEFAULT_DAYS", dotenv, 90),
        recent_gift_window_days=_env_int("RECENT_GIFT_WINDOW_DAYS", dotenv, 30),
        timeout_seconds=_env_int("TIMEOUT_SECONDS", dotenv, 120),
    )


def resolve_api_key(config: RuntimeConfig, secrets_client: Any | None = None) -> str:
    if config.virtuous_api_key:
        return config.virtuous_api_key
    if not config.virtuous_secret_id:
        raise RuntimeError("Missing API_KEY/VIRTUOUS_API_KEY and MAS_REPORT_VIRTUOUS_SECRET_ID.")
    if secrets_client is None:
        raise RuntimeError("A Secrets Manager client is required to resolve MAS_REPORT_VIRTUOUS_SECRET_ID.")
    payload = secrets_client.get_secret_value(SecretId=config.virtuous_secret_id)
    secret_text = payload.get("SecretString")
    if not secret_text:
        raise RuntimeError(f"Secret {config.virtuous_secret_id} did not contain SecretString.")
    return parse_api_key_secret(secret_text)


def parse_api_key_secret(secret_text: str) -> str:
    stripped = secret_text.strip()
    if not stripped:
        raise RuntimeError("Virtuous secret string is empty.")
    if stripped.startswith("{"):
        parsed = json.loads(stripped)
        for key in ("API_KEY", "VIRTUOUS_API_KEY", "api_key", "virtuous_api_key"):
            value = parsed.get(key)
            if value:
                return str(value)
        raise RuntimeError("Virtuous secret JSON did not include an API key field.")
    return stripped
