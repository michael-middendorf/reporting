"""PowerFAIDS publisher -> sources/powerfaids/{dataset}/ (read-only).

Pulls raw financial aid tables from PowerFAIDS (SQL Server on
AMU-V-PFSQL-N1). Safety design is shared with the other SQL Server sources in
common/mssql.py: guarded SELECT-only statements, READ UNCOMMITTED /
LOCK_TIMEOUT 5000 / DEADLOCK_PRIORITY LOW verified per session, overnight
window only, whole-job hard cap, one connection, sequential queries.

Every object written is SSE-KMS encrypted with the PowerFAIDS key and the
shared sources/_catalog.json is not refreshed by this job. The job refuses to
run when PF_KMS_KEY_ID is unset.

After every raw dataset succeeds, the same run publishes one derived extract
(queries.NEED_EXTRACT) to sources/scholarship-need/need/, encrypted with its
own key (PF_NEED_KMS_KEY_ID) that only the scholarship app can decrypt. If
PF_NEED_KMS_KEY_ID is unset the extract is skipped with a warning; an extract
failure is recorded in the run manifest but does not fail the raw run.

It then publishes the acceptance letters export (DST-3070): six scoped reads
joined in Python (acceptance.py, rules in acceptance_rules.py) written to
sources/acceptance-letters/exports/<generatedAt>.json and then
sources/acceptance-letters/manifest.json, encrypted with PF_ACCEPT_KMS_KEY_ID
(its own key). Same skip and failure behavior as the need extract.

Env: PF_HOST, PF_PORT (default 1433), PF_DATABASE, PF_USERNAME, PF_PASSWORD
(from the PowerFAIDS secret via the ECS task definition), PF_KMS_KEY_ID,
PF_NEED_KMS_KEY_ID,
PF_ACCEPT_KMS_KEY_ID, ACCEPT_AWARD_YEAR_NAME (default 2027-2028),
DATA_BUCKET, POWERFAIDS_YEARS_BACK (default 7), POWERFAIDS_ALLOW_DAYTIME,
POWERFAIDS_DRY_RUN, POWERFAIDS_MAX_RUNTIME_SECONDS (default 1800),
POWERFAIDS_QUERY_TIMEOUT_SECONDS (default 300).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any, Callable

try:
    from . import acceptance, acceptance_rules, queries
except ImportError:  # pragma: no cover - flat import when run from this directory (tests)
    import acceptance  # type: ignore[no-redef]
    import acceptance_rules  # type: ignore[no-redef]
    import queries  # type: ignore[no-redef]

from common import mssql

SOURCE = "powerfaids"
ENV_PREFIX = "PF"
KMS_ENV = "PF_KMS_KEY_ID"
NEED_KMS_ENV = "PF_NEED_KMS_KEY_ID"
ACCEPT_KMS_ENV = "PF_ACCEPT_KMS_KEY_ID"
APP_NAME = "amu-reporting-worker-powerfaids"
DEFAULT_YEARS_BACK = 7


def window_params(years_back: int, today: date | None = None) -> dict[str, Any]:
    today = today or datetime.now(timezone.utc).date()
    min_year = today.year - years_back
    return {
        "min_year": str(min_year),
        "min_date": date(min_year, 1, 1),
        "current_year": str(today.year),
        "today": today,
    }


def need_extract(env: dict[str, str]) -> mssql.DerivedDataset:
    need_key = (env.get(NEED_KMS_ENV) or "").strip()
    if not need_key:
        print(f"{SOURCE}: WARNING {NEED_KMS_ENV} is not set; scholarship need extract will be skipped", flush=True)
    return mssql.DerivedDataset(
        source=queries.NEED_EXTRACT_SOURCE,
        dataset=queries.NEED_EXTRACT_DATASET,
        sql=queries.NEED_EXTRACT,
        param_names=queries.NEED_EXTRACT_PARAMS,
        kms_key_id=need_key,
    )


def acceptance_extract(env: dict[str, str], now_utc: datetime | None = None) -> mssql.DerivedDataset:
    accept_key = (env.get(ACCEPT_KMS_ENV) or "").strip()
    if not accept_key:
        print(f"{SOURCE}: WARNING {ACCEPT_KMS_ENV} is not set; acceptance letters extract will be skipped", flush=True)
    unavailable = ""
    award_year = ""
    if accept_key:
        try:
            award_year = acceptance_rules.award_year_name(env)
        except ValueError as exc:
            unavailable = str(exc)
    return mssql.DerivedDataset(
        source=queries.ACCEPT_SOURCE,
        dataset=queries.ACCEPT_DATASET,
        sql="",
        param_names=(),
        kms_key_id=accept_key,
        unavailable=unavailable,
        statements=queries.ACCEPT_STATEMENTS,
        build=acceptance.make_build(lambda: now_utc or datetime.now(timezone.utc), award_year),
        extra_params={queries.ACCEPT_AWARD_YEAR_PARAM: award_year},
    )


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
        derived=(need_extract(env), acceptance_extract(env, now_utc)),
    )
