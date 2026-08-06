from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> dict[str, str]:
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


@dataclass(frozen=True)
class AppConfig:
    root_dir: Path
    base_url: str
    api_key: str
    data_dir: Path
    raw_dir: Path
    derived_dir: Path
    state_dir: Path
    exports_dir: Path
    publish_dir: Path
    page_size: int
    contact_chunk_size: int
    gift_window_days: int
    note_window_days: int
    event_window_days: int
    incremental_overlap_days: int
    timeout_seconds: int


def load_config(root_dir: str | Path | None = None) -> AppConfig:
    # In Lambda the deployment package is read-only; keep working state under /tmp.
    if root_dir is None and os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        root = Path(os.environ.get("ALUMNI_WORK_DIR") or "/tmp/alumni_work")
        root.mkdir(parents=True, exist_ok=True)
    else:
        root = Path(root_dir or Path.cwd()).resolve()
    dotenv = _load_dotenv(root / ".env")
    api_key = _env("API_KEY", dotenv) or _env("VIRTUOUS_API_KEY", dotenv)
    if not api_key:
        raise RuntimeError("Missing API_KEY or VIRTUOUS_API_KEY in environment or .env.")

    data_dir = root / "data"
    raw_dir = data_dir / "raw"
    derived_dir = data_dir / "derived"
    state_dir = data_dir / "state"
    exports_dir = data_dir / "exports"
    publish_raw = _env("PUBLISH_DIR", dotenv, "site/data") or "site/data"
    publish_path = Path(publish_raw)
    publish_dir = publish_path if publish_path.is_absolute() else (root / publish_path)

    return AppConfig(
        root_dir=root,
        base_url=_env("VIRTUOUS_BASE_URL", dotenv, "https://api.virtuoussoftware.com")
        or "https://api.virtuoussoftware.com",
        api_key=api_key,
        data_dir=data_dir,
        raw_dir=raw_dir,
        derived_dir=derived_dir,
        state_dir=state_dir,
        exports_dir=exports_dir,
        publish_dir=publish_dir,
        page_size=int(_env("PAGE_SIZE", dotenv, "500") or 500),
        contact_chunk_size=int(_env("CONTACT_CHUNK_SIZE", dotenv, "200") or 200),
        gift_window_days=int(_env("GIFT_WINDOW_DAYS", dotenv, "365") or 365),
        note_window_days=int(_env("NOTE_WINDOW_DAYS", dotenv, "365") or 365),
        event_window_days=int(_env("EVENT_WINDOW_DAYS", dotenv, "365") or 365),
        incremental_overlap_days=int(
            _env("INCREMENTAL_OVERLAP_DAYS", dotenv, "7") or 7
        ),
        timeout_seconds=int(_env("TIMEOUT_SECONDS", dotenv, "120") or 120),
    )
