"""Great Plains publisher -> sources/greatplains/{dataset}/ (read-only).

Pulls raw finance (GL and AP) tables from Great Plains (SQL Server on
AMU-V-GP18SQL). Safety design is shared with the other SQL Server sources in
common/mssql.py: guarded SELECT-only statements, READ UNCOMMITTED /
LOCK_TIMEOUT 5000 / DEADLOCK_PRIORITY LOW verified per session, overnight
window only, whole-job hard cap, one connection, sequential queries.

Every object written is SSE-KMS encrypted with the Great Plains key and the
shared sources/_catalog.json is not refreshed by this job. The job refuses to
run when GP_KMS_KEY_ID is unset.

Env: GP_HOST, GP_PORT (default 1433), GP_DATABASE, GP_USERNAME, GP_PASSWORD
(from the Great Plains secret via the ECS task definition), GP_KMS_KEY_ID,
DATA_BUCKET, GREATPLAINS_YEARS_BACK (default 7), GREATPLAINS_ALLOW_DAYTIME,
GREATPLAINS_DRY_RUN, GREATPLAINS_MAX_RUNTIME_SECONDS (default 1800),
GREATPLAINS_QUERY_TIMEOUT_SECONDS (default 300).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any, Callable

try:
    from . import queries
except ImportError:  # pragma: no cover - flat import when run from this directory (tests)
    import queries  # type: ignore[no-redef]

from common import mssql

SOURCE = "greatplains"
ENV_PREFIX = "GP"
KMS_ENV = "GP_KMS_KEY_ID"
APP_NAME = "amu-reporting-worker-greatplains"
DEFAULT_YEARS_BACK = 7


def window_params(years_back: int, today: date | None = None) -> dict[str, Any]:
    today = today or datetime.now(timezone.utc).date()
    min_year = today.year - years_back
    # GP fiscal years (YEAR1, HSTYEAR, OPENYEAR) are smallint, so also bind an int.
    return {
        "min_year": str(min_year),
        "min_year_int": min_year,
        "min_date": date(min_year, 1, 1),
        "current_year": str(today.year),
    }


def handler(
    event: Any,  # noqa: ARG001
    context: Any,  # noqa: ARG001
    *,
    env: dict[str, str] | None = None,
    connect: Callable[[mssql.ConnectionSettings], Any] | None = None,
    now_utc: datetime | None = None,
    watchdog_factory: Callable[[int], Any] | None = None,
) -> dict[str, Any]:
    env = dict(os.environ) if env is None else env
    kms_key_id = (env.get(KMS_ENV) or "").strip()
    if not kms_key_id:
        raise RuntimeError(f"{SOURCE}: {KMS_ENV} is not set; refusing to run")
    upper = SOURCE.upper()
    years_back = mssql.int_env(env, f"{upper}_YEARS_BACK", DEFAULT_YEARS_BACK)
    if years_back < 0 or years_back > 30:
        raise ValueError(f"{upper}_YEARS_BACK must be between 0 and 30")
    params = window_params(years_back, (now_utc or datetime.now(timezone.utc)).date())
    return mssql.run_publisher(
        SOURCE,
        queries.DATASETS,
        params,
        env_prefix=ENV_PREFIX,
        kms_key_id=kms_key_id,
        app_name=APP_NAME,
        env=env,
        connect=connect,
        now_utc=now_utc,
        watchdog_factory=watchdog_factory,
    )
