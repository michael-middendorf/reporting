"""Athletics Slate publisher -> sources/athletics/{applications,prospects,roster,association_history}/.

Query ids and service tokens are supplied only through ATHLETICS_SLATE_QUERIES
(secret AthleticsSlateQueries). They are deliberately never written to
provenance or logs. Roster and association_history are optional: if the secret
has no entry for one, this run skips sources/athletics/{name}/ and leaves the
existing recruiting feeds alone.

association_history feeds the coaching Sport Alumni tab. Its Slate query
exports PCID, CurrentSport, SecondSport, MF, RosterStatus, AthType, FirstName,
LastName for every athlete Slate has ever tracked, so former athletes can be
joined to PowerCampus graduates by PCID.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import threading
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from common.sources import publish_dataset, rows_from_slate_payload

BASE_URL = "https://apply.avemaria.edu/manage/query/run"
REQUIRED_DATASETS = {"applications", "prospects"}
OPTIONAL_DATASETS = {"roster", "association_history"}
KNOWN_DATASETS = REQUIRED_DATASETS | OPTIONAL_DATASETS
USER_AGENT = "amu-reporting-athletics-publisher/1.0"


class ConfigError(RuntimeError):
    """Raised when the secret-backed query configuration is unusable."""


def _load_queries(raw: str | None = None) -> dict[str, tuple[str, str, int, str]]:
    text = (raw if raw is not None else os.getenv("ATHLETICS_SLATE_QUERIES") or "").strip()
    if not text:
        raise ConfigError("ATHLETICS_SLATE_QUERIES is missing or blank")
    try:
        payload = json.loads(text)
    except ValueError as exc:
        raise ConfigError("ATHLETICS_SLATE_QUERIES is not valid JSON") from exc

    queries: dict[str, tuple[str, str, int, str]] = {}
    for item in payload.get("queries", []):
        name = str(item.get("name") or "").strip().lower()
        query_id = str(item.get("query_id") or "").strip()
        token = str(item.get("token") or "").strip()
        default_auth = "bearer" if name == "applications" else "query"
        auth = str(item.get("auth") or default_auth).strip().lower()
        if name in KNOWN_DATASETS and query_id and token:
            if auth not in {"bearer", "query"}:
                raise ConfigError(f"Unsupported auth mode for {name}: {auth}")
            queries[name] = (query_id, token, int(item.get("timeout", 900)), auth)
    missing = REQUIRED_DATASETS - queries.keys()
    if missing:
        raise ConfigError(f"Missing Athletics query configuration: {', '.join(sorted(missing))}")
    return queries


def _log_skipped_optional(queries: dict[str, tuple[str, str, int, str]]) -> list[str]:
    skipped = sorted(OPTIONAL_DATASETS - queries.keys())
    for name in skipped:
        print(
            json.dumps(
                {
                    "event": "athletics_dataset_skipped",
                    "dataset": name,
                    "reason": "missing_query_config",
                    "message": (
                        f"ATHLETICS_SLATE_QUERIES has no {name} entry with query_id and token. "
                        f"Add queries[].name={name} to secret AthleticsSlateQueries. "
                        f"Skipping sources/athletics/{name}/."
                    ),
                }
            ),
            flush=True,
        )
    return skipped


def _safe_error(exc: BaseException) -> str:
    """Keep failure text, but never echo a Slate `h=` service token."""
    return re.sub(r"([?&]h=)[^&\s]+", r"\1[redacted]", str(exc), flags=re.I)


def _fetch(query_id: str, token: str, timeout: int, auth: str) -> list[dict]:
    params = {"id": query_id, "cmd": "service", "output": "json"}
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if auth == "bearer":
        headers["Authorization"] = f"Bearer {token}"
    else:
        params["h"] = token
    url = f"{BASE_URL}?{urlencode(params)}"
    request = Request(url, headers=headers)
    with urlopen(request, context=ssl.create_default_context(), timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return rows_from_slate_payload(payload)


def handler(event, context):  # noqa: ANN001, ARG001
    queries = _load_queries()
    skipped = _log_skipped_optional(queries)
    results: dict[str, dict] = {}
    errors: dict[str, str] = {}
    lock = threading.Lock()

    def worker(name: str) -> None:
        query_id, token, timeout, auth = queries[name]
        try:
            rows = _fetch(query_id, token, timeout, auth)
            latest = publish_dataset(
                source="athletics",
                dataset=name,
                rows=rows,
                provenance={
                    "system": "slate",
                    "query_name": name,
                    "query_id": query_id,
                    "auth": auth,
                },
            )
            with lock:
                results[name] = {
                    "record_count": latest["record_count"],
                    "pulled_at": latest["pulled_at"],
                }
        except Exception as exc:  # noqa: BLE001
            with lock:
                errors[name] = _safe_error(exc)

    threads = [threading.Thread(target=worker, args=(name,), daemon=True) for name in queries]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    if not results:
        raise RuntimeError(f"All Athletics Slate queries failed: {errors}")
    print(
        json.dumps(
            {
                "event": "athletics_refresh",
                "datasets": results,
                "errors": errors,
                "skipped": skipped,
            }
        ),
        flush=True,
    )
    return {
        "ok": not errors,
        "source": "athletics",
        "datasets": results,
        "errors": errors,
        "skipped": skipped,
    }
