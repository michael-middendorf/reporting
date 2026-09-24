"""Enrollment publisher → sources/slate/{dataset}/."""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

from common.sources import publish_dataset, rows_from_slate_payload

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
    "ame": "ame",
}

# Published after everything else; see _load_links.
LAST_DATASETS = {"interactions"}

USER_AGENT = "amu-reporting-slate-publisher/2.0"
TIMEOUT = int(os.getenv("FETCH_TIMEOUT_SECONDS", "900"))


def _links_path() -> Path:
    env = os.getenv("QUERY_LINKS_FILE")
    if env and Path(env).exists():
        return Path(env)
    here = Path(__file__).resolve().parent
    for candidate in (
        here / "query_links.json",
        Path("/var/task/query_links.json"),
        Path.cwd() / "query_links.json",
    ):
        if candidate.exists():
            return candidate
    return here / "query_links.json"


def _load_links() -> list[tuple[str, str]]:
    raw = json.loads(_links_path().read_text(encoding="utf-8"))
    ordered: list[tuple[str, str]] = []
    for source_key, url in raw.items():
        if source_key not in KEY_ALIASES:
            raise RuntimeError(f"Unexpected query key: {source_key}")
        ordered.append((KEY_ALIASES[source_key], url.strip()))
    # Publish the largest dataset last: if it fails (e.g. out of memory, which
    # can't be caught), every smaller dataset has already been refreshed.
    ordered.sort(key=lambda item: item[0] in LAST_DATASETS)
    return ordered


def _fetch_json(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        # json.loads accepts bytes; skipping .decode() avoids a second full copy.
        return json.loads(resp.read())


def handler(event, context):  # noqa: ANN001, ARG001
    published = []
    for dataset, url in _load_links():
        payload = _fetch_json(url)
        rows = rows_from_slate_payload(payload)
        latest = publish_dataset(
            source="slate",
            dataset=dataset,
            rows=rows,
            provenance={"system": "slate", "query_url": url, "source_key": dataset},
        )
        published.append(latest)
        print(f"slate/{dataset}: {latest['record_count']} rows → {latest['prefix']}", flush=True)
    return {"ok": True, "source": "slate", "datasets": published}
