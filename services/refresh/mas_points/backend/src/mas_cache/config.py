"""Configuration for the raw-only cache refresh.

Env is read from process env first, then a .env in the repo root. Only the
Virtuous API key is required for a local run; AWS settings are only needed when
publishing to S3.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip()
    return values


def _env(name: str, dotenv: dict[str, str], default: str | None = None) -> str | None:
    return os.environ.get(name, dotenv.get(name, default))


# The 7 scoped Mission Advancement callers (exact Virtuous `createdByUser`).
MA_ROSTER = [
    "Sean Kelly",
    "Joseph Blaso",
    "Alanna McCann",
    "Caleb Metzen",
    "Elena Barnes",
    "Betsy Scaletty",
    "Natalia Abrams",
]

# Note-type prefixes/exact types we pull as raw scoring inputs. The frontend
# does the actual points mapping; this only scopes the raw fetch so the cache
# stays lean (it is still unprocessed Virtuous records).
NOTE_TYPE_PREFIXES = ["Mission Advancement"]
NOTE_TYPE_EXACT = ["Letter", "In Person", "Text Message"]

# Event names we pull as raw, display-only inputs. Events carry no MA owner in
# Virtuous (createdByUser is the events-team admin), so they are shown for
# reference only and never scored to an MA. Matched by Event Name "Contains".
# Keep loosely in sync with EVENT_RULES in the frontend config.js.
EVENT_MATCH_KEYWORDS = ["Near You", "Market"]


@dataclass(frozen=True)
class Config:
    root_dir: Path
    base_url: str
    api_key: str
    note_window_days: int
    page_size: int
    timeout_seconds: int
    # local raw output (also used by the frontend for dev)
    local_out_dir: Path
    # S3 cache bucket (raw only)
    s3_bucket: str | None
    s3_prefix: str
    aws_profile: str | None
    aws_region: str
    fields: dict = field(default_factory=dict)


def load_config(root_dir: str | Path | None = None) -> Config:
    root = Path(root_dir or Path.cwd()).resolve()
    dotenv = _load_dotenv(root / ".env")
    api_key = _env("API_KEY", dotenv) or _env("VIRTUOUS_API_KEY", dotenv)
    if not api_key:
        raise RuntimeError("Missing API_KEY / VIRTUOUS_API_KEY in env or .env")

    return Config(
        root_dir=root,
        base_url=_env("VIRTUOUS_BASE_URL", dotenv, "https://api.virtuoussoftware.com"),
        api_key=api_key,
        note_window_days=int(_env("NOTE_WINDOW_DAYS", dotenv, "365")),
        page_size=int(_env("PAGE_SIZE", dotenv, "1000")),
        timeout_seconds=int(_env("TIMEOUT_SECONDS", dotenv, "120")),
        local_out_dir=Path(_env("LOCAL_OUT_DIR", dotenv, str(root / "frontend" / "data"))),
        s3_bucket=_env("MAS_CACHE_BUCKET", dotenv, "mas-report-cache-905418447941-us-east-2"),
        # Publish under points/data so the shared CloudFront distribution's
        # `points/data/*` behavior serves it (the root `data/*` prefix belongs
        # to the sibling giving-report project).
        s3_prefix=_env("MAS_CACHE_PREFIX", dotenv, "points/data"),
        aws_profile=_env("AWS_PROFILE", dotenv),
        aws_region=_env("AWS_REGION", dotenv, "us-east-2"),
    )
