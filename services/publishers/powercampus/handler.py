"""PowerCampus publisher -> sources/powercampus/{dataset}/ (read-only).

Pulls raw, year-windowed PowerCampus tables (University_AMU on SQL Server
2016, through the IPsec VPN) for the census reports. The overriding rule is
that this job must never harm the production database; see db.py for the
guard and session safety settings. This module adds the operational limits:

  * Refuses to run 07:00 to 22:00 America/New_York unless
    POWERCAMPUS_ALLOW_DAYTIME=1 (the schedule runs overnight).
  * Whole-job hard cap (POWERCAMPUS_MAX_RUNTIME_SECONDS, default 1800): a
    watchdog kills the process (closing the socket, which ends the server
    session) and exits non-zero.
  * Datasets run one at a time on one connection. A failing dataset is
    recorded in the run manifest and the others still run; its previous
    snapshot is left in place. The run exits non-zero if any dataset failed.
  * POWERCAMPUS_DRY_RUN=1: connect, run the version check and one named-column
    count on ACADEMIC for the current year, print, write nothing to S3.

Env: PC_HOST, PC_PORT, PC_DATABASE, PC_USERNAME, PC_PASSWORD (from the
amu-reporting/production/powercampus secret via the ECS task definition),
POWERCAMPUS_YEARS_BACK (default 7), POWERCAMPUS_QUERY_TIMEOUT_SECONDS
(default 300), POWERCAMPUS_MAX_RUNTIME_SECONDS (default 1800).
"""

from __future__ import annotations

import os
import threading
import time
from datetime import date, datetime, timezone
from typing import Any, Callable

try:
    from . import db, queries
except ImportError:  # pragma: no cover - flat import when run from this directory (tests)
    import db  # type: ignore[no-redef]
    import queries  # type: ignore[no-redef]

from common.s3util import put_json
from common.sources import publish_dataset

SOURCE = "powercampus"
TIMEZONE = "America/New_York"
BLOCKED_START_HOUR = 7  # inclusive, local time
BLOCKED_END_HOUR = 22  # exclusive, local time
DEFAULT_YEARS_BACK = 7
DEFAULT_MAX_RUNTIME_SECONDS = 1800
MAX_RECONNECTS = 2
WATCHDOG_EXIT_CODE = 124


class JobTimeout(RuntimeError):
    """The whole-job hard cap was reached."""


class PartialFailure(RuntimeError):
    """At least one dataset failed; see the run manifest."""


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _int_env(env: dict[str, str] | os._Environ, name: str, default: int) -> int:
    raw = (env.get(name) or "").strip()
    return int(raw) if raw else default


def is_blocked_hour(now_utc: datetime | None = None) -> bool:
    """True during PowerCampus business hours (07:00 to 22:00 New York)."""
    from zoneinfo import ZoneInfo

    now_utc = now_utc or datetime.now(timezone.utc)
    local = now_utc.astimezone(ZoneInfo(TIMEZONE))
    return BLOCKED_START_HOUR <= local.hour < BLOCKED_END_HOUR


def window_params(years_back: int, today: date | None = None) -> dict[str, Any]:
    today = today or datetime.now(timezone.utc).date()
    min_year = today.year - years_back
    try:
        min_grad = today.replace(year=today.year - (years_back + 1))
    except ValueError:  # Feb 29
        min_grad = today.replace(year=today.year - (years_back + 1), day=28)
    return {
        # ACADEMIC_YEAR is varchar(4) in PowerCampus; bind as a string.
        "min_year": str(min_year),
        "min_graduation_date": min_grad,
        "current_year": str(today.year),
    }


class _Watchdog:
    """Hard kill after max_seconds, even if a socket read is stuck."""

    def __init__(self, max_seconds: int, on_expire: Callable[[], None] | None = None) -> None:
        self.max_seconds = max_seconds
        self.deadline = time.monotonic() + max_seconds
        self._on_expire = on_expire or self._kill
        self._timer = threading.Timer(max_seconds, self._on_expire)
        self._timer.daemon = True

    def _kill(self) -> None:
        print(f"powercampus: hard cap of {self.max_seconds}s reached, exiting", flush=True)
        # os._exit closes the socket; SQL Server then ends the session and
        # releases anything it held. No cleanup code can hang here.
        os._exit(WATCHDOG_EXIT_CODE)

    def start(self) -> "_Watchdog":
        self._timer.start()
        return self

    def cancel(self) -> None:
        self._timer.cancel()

    def check(self) -> None:
        if time.monotonic() >= self.deadline:
            raise JobTimeout(f"hard cap of {self.max_seconds}s reached")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dry_run(reader: db.PowerCampusReader, params: dict[str, Any], log_target: str) -> dict[str, Any]:
    version = reader.fetch_all(queries.VERSION_CHECK)
    count = reader.fetch_all(queries.DRY_RUN_ACADEMIC_COUNT, {"year": params["current_year"]})
    raw_version = str((version[0] if version else {}).get("server_version") or "").strip()
    server_version = raw_version.splitlines()[0] if raw_version else "unknown"
    row_count = int((count[0] if count else {}).get("row_count") or 0)
    print(f"powercampus dry run ({log_target}): {server_version}", flush=True)
    print(f"powercampus dry run: ACADEMIC rows for {params['current_year']} = {row_count}", flush=True)
    return {
        "ok": True,
        "source": SOURCE,
        "dry_run": True,
        "server_version": server_version,
        "academic_rows_current_year": row_count,
        "current_year": params["current_year"],
    }


def handler(
    event: Any,
    context: Any,  # noqa: ARG001
    *,
    env: dict[str, str] | None = None,
    connect: Callable[[db.ConnectionSettings], Any] | None = None,
    now_utc: datetime | None = None,
    watchdog_factory: Callable[[int], Any] | None = None,
) -> dict[str, Any]:
    env = dict(os.environ) if env is None else env
    dry_run = _truthy(env.get("POWERCAMPUS_DRY_RUN"))

    if is_blocked_hour(now_utc) and not _truthy(env.get("POWERCAMPUS_ALLOW_DAYTIME")):
        msg = (
            "powercampus: refusing to run between 07:00 and 22:00 America/New_York "
            "(set POWERCAMPUS_ALLOW_DAYTIME=1 to override)"
        )
        print(msg, flush=True)
        return {"ok": False, "source": SOURCE, "skipped": "daytime-window", "message": msg}

    settings = db.settings_from_env(env)
    years_back = _int_env(env, "POWERCAMPUS_YEARS_BACK", DEFAULT_YEARS_BACK)
    max_runtime = _int_env(env, "POWERCAMPUS_MAX_RUNTIME_SECONDS", DEFAULT_MAX_RUNTIME_SECONDS)
    if years_back < 0 or years_back > 30:
        raise ValueError("POWERCAMPUS_YEARS_BACK must be between 0 and 30")
    params = window_params(years_back, (now_utc or datetime.now(timezone.utc)).date())
    # Host and database only; never credentials.
    log_target = f"{settings.host}/{settings.database}"

    watchdog = (watchdog_factory or _Watchdog)(max_runtime).start()
    reader = db.PowerCampusReader(settings, connect=connect)
    try:
        reader.open()
        if dry_run:
            return _dry_run(reader, params, log_target)
        return _publish_all(reader, settings, params, years_back, log_target, watchdog)
    finally:
        reader.close()
        watchdog.cancel()


def _publish_all(
    reader: db.PowerCampusReader,
    settings: db.ConnectionSettings,
    params: dict[str, Any],
    years_back: int,
    log_target: str,
    watchdog: Any,
) -> dict[str, Any]:
    started = _now()
    started_mono = time.monotonic()
    results: list[dict[str, Any]] = []
    reconnects = 0
    print(f"powercampus: publishing from {log_target}, ACADEMIC_YEAR >= {params['min_year']}", flush=True)

    for dataset, sql, param_names in queries.DATASETS:
        entry: dict[str, Any] = {"dataset": dataset, "started_at": _now()}
        t0 = time.monotonic()
        try:
            watchdog.check()
            if not reader.is_open:
                # The previous failure dropped the socket (e.g. query timeout).
                # Reopen, still one connection at a time, at most MAX_RECONNECTS.
                if reconnects >= MAX_RECONNECTS:
                    raise RuntimeError("connection lost and reconnect limit reached")
                reconnects += 1
                reader.open()
            bound = {name: params[name] for name in param_names}
            rows = reader.fetch_all(sql, bound or None, check_deadline=watchdog.check)
            query_seconds = round(time.monotonic() - t0, 3)
            latest = publish_dataset(
                source=SOURCE,
                dataset=dataset,
                rows=rows,
                provenance={
                    "system": "powercampus",
                    "database": settings.database,
                    "dataset": dataset,
                    "params": {k: str(v) for k, v in bound.items()},
                },
            )
            entry.update(
                ok=True,
                record_count=latest["record_count"],
                prefix=latest["prefix"],
                query_seconds=query_seconds,
            )
            print(f"powercampus/{dataset}: {latest['record_count']} rows in {query_seconds}s", flush=True)
        except JobTimeout as exc:
            entry.update(ok=False, error=f"JobTimeout: {exc}")
            entry["duration_seconds"] = round(time.monotonic() - t0, 3)
            results.append(entry)
            break
        except Exception as exc:  # noqa: BLE001 - one dataset must not stop the others
            entry.update(ok=False, error=settings.redact(f"{type(exc).__name__}: {exc}")[:1000])
            print(f"powercampus/{dataset}: FAILED {entry['error']}", flush=True)
            if _connection_broken(exc):
                reader.close()
        entry["duration_seconds"] = round(time.monotonic() - t0, 3)
        results.append(entry)

    ran = {r["dataset"] for r in results}
    for dataset, _, _ in queries.DATASETS:
        if dataset not in ran:
            results.append({"dataset": dataset, "ok": False, "error": "not run: job hard cap reached"})

    failed = [r["dataset"] for r in results if not r.get("ok")]
    manifest = {
        "schema_version": 1,
        "source": SOURCE,
        "database": settings.database,
        "started_at": started,
        "finished_at": _now(),
        "duration_seconds": round(time.monotonic() - started_mono, 3),
        "years_back": years_back,
        "min_academic_year": params["min_year"],
        "min_graduation_date": str(params["min_graduation_date"]),
        "reconnects": reconnects,
        "ok": not failed,
        "failed": failed,
        "datasets": results,
    }
    day = started[:10]
    put_json(f"sources/{SOURCE}/_runs/dt={day}/manifest.json", manifest)
    put_json(f"sources/{SOURCE}/_runs/latest.json", manifest)
    if failed:
        raise PartialFailure(f"{len(failed)} dataset(s) failed: {', '.join(failed)}")
    return {"ok": True, "source": SOURCE, "datasets": results}


def _connection_broken(exc: BaseException) -> bool:
    """Socket-level failures leave the TDS stream unusable; server errors do not."""
    if isinstance(exc, (OSError, TimeoutError, ConnectionError, EOFError)):
        return True
    name = type(exc).__name__
    return name in {"ClosedConnectionError", "OperationalError"} and "closed" in str(exc).lower()
