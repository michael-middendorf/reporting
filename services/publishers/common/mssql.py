"""Shared read-only, low-impact SQL Server publisher core.

Generic copy of the PowerCampus publisher safety design (powercampus/db.py and
powercampus/handler.py are intentionally left untouched) for the newer
SQL Server sources (PowerFAIDS, Great Plains). The top requirement is that a
publisher must never harm the production database it reads. Defenses:

  1. The SQL login is read-only at the database (owned by the DBA; column
     level SELECT grants only).
  2. guard_select() rejects any statement that is not a single SELECT/WITH,
     contains a write/DDL/exec keyword, an xp_/sp_ procedure, '*', COUNT(*),
     comments, or lacks a trailing OPTION (MAXDOP 1). Every statement goes
     through it before it is sent.
  3. Session setup: READ UNCOMMITTED, LOCK_TIMEOUT 5000, DEADLOCK_PRIORITY LOW,
     verified by reading this session's row in sys.dm_exec_sessions. The job
     aborts if it does not match (fail closed).
  4. autocommit on, no explicit transactions, one connection, sequential
     queries, fetchmany streaming, login and per-query timeouts.
  5. A per-source application name so the DBA can find and kill the session.

Operational limits (run_publisher):
  * Refuses to run 07:00 to 22:00 America/New_York unless
    {SOURCE}_ALLOW_DAYTIME=1.
  * Whole-job hard cap ({SOURCE}_MAX_RUNTIME_SECONDS, default 1800) enforced
    by a watchdog that kills the process.
  * Datasets run one at a time; a failure is recorded in the run manifest and
    the others still run (at most MAX_RECONNECTS reconnects after a dropped
    socket). Raises PartialFailure if any dataset failed.
  * {SOURCE}_DRY_RUN=1: session check and version check only; writes nothing.
  * Every object written (data, meta, _latest, run manifests) is encrypted
    with the source's own KMS key, and the shared catalog is not refreshed.
"""

from __future__ import annotations

import functools
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, Mapping, Sequence

from .s3util import put_json
from .sources import publish_dataset

LOGIN_TIMEOUT_SECONDS = 15
DEFAULT_QUERY_TIMEOUT_SECONDS = 300
DEFAULT_MAX_RUNTIME_SECONDS = 1800
FETCH_BATCH_SIZE = 5000
MAX_RECONNECTS = 2
WATCHDOG_EXIT_CODE = 124

TIMEZONE = "America/New_York"
BLOCKED_START_HOUR = 7  # inclusive, local time
BLOCKED_END_HOUR = 22  # exclusive, local time

# Issued one at a time, verbatim, right after connect. These are the only
# non-SELECT statements this module will ever send.
SESSION_SETUP_STATEMENTS: tuple[str, ...] = (
    "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
    "SET LOCK_TIMEOUT 5000",
    "SET DEADLOCK_PRIORITY LOW",
)

# sys.dm_exec_sessions values that prove the setup took effect.
EXPECTED_ISOLATION_LEVEL = 1  # 1 = ReadUncommitted
EXPECTED_LOCK_TIMEOUT_MS = 5000
EXPECTED_DEADLOCK_PRIORITY = -5  # LOW

# Reads this session's own row (no VIEW SERVER STATE needed).
SESSION_CHECK = (
    "SELECT s.transaction_isolation_level, s.lock_timeout, s.deadlock_priority "
    "FROM sys.dm_exec_sessions AS s "
    "WHERE s.session_id = @@SPID "
    "OPTION (MAXDOP 1)"
)

VERSION_CHECK = (
    "SELECT @@VERSION AS server_version, DB_NAME() AS database_name "
    "OPTION (MAXDOP 1)"
)


# TLS: every connection is encrypted end to end (TLS 1.2 or newer), on top of the IPsec
# VPN. The campus SQL servers present SQL Server's auto-generated self-signed certificate,
# which is regenerated on every service restart, so the certificate is not validated
# (encrypt-only, TLS 1.2; pinning it would break the pull after each patch reboot). This protects
# against passive capture on the campus network. Moving to a CA-issued server certificate
# plus validation is the planned follow-up (pass a real CA bundle path as cafile).
# Sentinel, not a path. If the context factory were ever not installed, pytds would try to
# load it as a CA file and fail closed (no connection), never fall back to plaintext.
ENCRYPT_ONLY_CAFILE = "encrypt-only:no-certificate-validation"

FORBIDDEN_KEYWORDS: tuple[str, ...] = (
    "INSERT", "UPDATE", "DELETE", "MERGE", "EXEC", "EXECUTE", "DROP", "ALTER",
    "CREATE", "TRUNCATE", "GRANT", "REVOKE", "DENY", "INTO", "BACKUP",
    "RESTORE", "DBCC", "SHUTDOWN", "KILL", "OPENROWSET", "OPENQUERY",
    "OPENDATASOURCE", "WAITFOR", "USE",
)
_FORBIDDEN_RE = re.compile(r"\b(" + "|".join(FORBIDDEN_KEYWORDS) + r")\b", re.IGNORECASE)
_PROC_PREFIX_RE = re.compile(r"\b(xp_|sp_)", re.IGNORECASE)
_COUNT_STAR_RE = re.compile(r"\bCOUNT_BIG\s*\(\s*\*\s*\)|\bCOUNT\s*\(\s*\*\s*\)", re.IGNORECASE)
_LEADING_RE = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)
_MAXDOP_RE = re.compile(r"\bOPTION\s*\(\s*MAXDOP\s+1\s*\)\s*;?\s*$", re.IGNORECASE)


class UnsafeQueryError(ValueError):
    """Raised before sending when a statement fails the read-only guard."""


class SessionSetupError(RuntimeError):
    """Raised when the low-impact session settings cannot be confirmed."""


class JobTimeout(RuntimeError):
    """The whole-job hard cap was reached."""


class PartialFailure(RuntimeError):
    """At least one dataset failed; see the run manifest."""


def guard_select(sql: str) -> str:
    """Return sql unchanged if it is a single, safe SELECT; raise otherwise."""
    if not isinstance(sql, str) or not sql.strip():
        raise UnsafeQueryError("empty statement")
    body = sql.strip()
    if "--" in body or "/*" in body or "*/" in body:
        raise UnsafeQueryError("comments are not allowed")
    if ";" in body.rstrip(";").rstrip() or body.count(";") > 1:
        raise UnsafeQueryError("multiple statements are not allowed")
    if not _LEADING_RE.match(body):
        raise UnsafeQueryError("only SELECT or WITH statements are allowed")
    match = _FORBIDDEN_RE.search(body)
    if match:
        raise UnsafeQueryError(f"forbidden keyword: {match.group(1).upper()}")
    if _PROC_PREFIX_RE.search(body):
        raise UnsafeQueryError("stored procedure references (xp_/sp_) are not allowed")
    if _COUNT_STAR_RE.search(body):
        raise UnsafeQueryError("COUNT(*) is not allowed; count a named column")
    if "*" in body:
        raise UnsafeQueryError("'*' is not allowed anywhere; name every column")
    if not _MAXDOP_RE.search(body):
        raise UnsafeQueryError("statement must end with OPTION (MAXDOP 1)")
    return sql


# ---------------------------------------------------------------------------
# Column exclusion helpers (used by each source's tests to keep sensitive
# columns out of every SELECT list)
# ---------------------------------------------------------------------------

_SELECT_LIST_RE = re.compile(r"\bSELECT\s+(.*?)(?=\bFROM\b|\bOPTION\s*\()", re.IGNORECASE | re.DOTALL)
_STRING_LITERAL_RE = re.compile(r"'(?:[^']|'')*'")
_IDENT_RE = re.compile(r"\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_@#$]*)")
_NON_COLUMN_WORDS = frozenset(
    {
        "AS", "DISTINCT", "TOP", "CASE", "WHEN", "THEN", "ELSE", "END", "NULL",
        "AND", "OR", "NOT", "IS", "IN", "LIKE", "BETWEEN", "PERCENT", "TIES", "WITH",
        "VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "INT", "BIGINT", "SMALLINT",
        "DECIMAL", "NUMERIC", "MONEY", "DATE", "DATETIME", "DATETIME2", "BIT",
    }
)


def select_list_identifiers(sql: str) -> list[str]:
    """Column names and aliases named in every SELECT list of sql.

    Heuristic: table qualifiers (the 'a' in a.COL), function names (followed
    by '('), string literals, and SQL keywords are dropped.
    """
    out: list[str] = []
    for match in _SELECT_LIST_RE.finditer(sql):
        select_list = _STRING_LITERAL_RE.sub(" ", match.group(1))
        for ident in _IDENT_RE.finditer(select_list):
            name = ident.group(1) or ident.group(2)
            rest = select_list[ident.end():].lstrip()
            if rest.startswith("(") or rest.startswith("."):
                continue
            if ident.start() >= 2 and select_list[ident.start() - 2 : ident.start()] == "@@":
                continue
            if name.upper() in _NON_COLUMN_WORDS:
                continue
            out.append(name)
    return out


def excluded_column_hits(
    sql: str,
    substrings: Sequence[str],
    whole_tokens: Sequence[str] = (),
) -> list[tuple[str, str]]:
    """(identifier, rule) pairs where a selected identifier matches an exclusion.

    substrings match anywhere in the identifier, case-insensitive. Entries in
    whole_tokens (short tokens such as 'tin', 'dob') match only the whole
    identifier or one of its underscore-separated segments.
    """
    whole = {t.lower() for t in whole_tokens}
    hits: list[tuple[str, str]] = []
    for name in select_list_identifiers(sql):
        lower = name.lower()
        segments = set(lower.split("_"))
        for rule in substrings:
            r = rule.lower()
            if r in whole:
                if lower == r or r in segments:
                    hits.append((name, rule))
            elif r in lower:
                hits.append((name, rule))
    return hits


# ---------------------------------------------------------------------------
# Connection settings
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConnectionSettings:
    host: str
    port: int
    database: str
    username: str
    password: str
    query_timeout: int = DEFAULT_QUERY_TIMEOUT_SECONDS

    def __repr__(self) -> str:  # never expose credentials in logs or tracebacks
        return f"ConnectionSettings(host={self.host!r}, port={self.port}, database={self.database!r})"

    __str__ = __repr__

    def redact(self, text: str) -> str:
        """Strip credentials from an error string before it is logged or stored."""
        return redact(text, self)


def redact(text: Any, settings: ConnectionSettings | None) -> str:
    out = str(text)
    if settings is None:
        return out
    for secret in (settings.password, settings.username):
        if secret:
            out = out.replace(secret, "***")
    return out


def settings_from_env(
    prefix: str,
    env: Mapping[str, str] | None = None,
    *,
    query_timeout_env: str | None = None,
) -> ConnectionSettings:
    """Read {prefix}_HOST/_PORT/_DATABASE/_USERNAME/_PASSWORD (port default 1433)."""
    env = os.environ if env is None else env
    required = [f"{prefix}_{k}" for k in ("HOST", "DATABASE", "USERNAME", "PASSWORD")]
    missing = [k for k in required if not (env.get(k) or "").strip()]
    if missing:
        raise RuntimeError(f"missing {prefix} connection settings: {', '.join(missing)}")
    timeout_raw = (env.get(query_timeout_env) if query_timeout_env else None) or ""
    return ConnectionSettings(
        host=env[f"{prefix}_HOST"].strip(),
        port=int((env.get(f"{prefix}_PORT") or "1433").strip()),
        database=env[f"{prefix}_DATABASE"].strip(),
        username=env[f"{prefix}_USERNAME"].strip(),
        password=env[f"{prefix}_PASSWORD"],
        query_timeout=int(timeout_raw.strip() or str(DEFAULT_QUERY_TIMEOUT_SECONDS)),
    )


def _encrypt_only_tls_context(cafile: str, _original: Callable[[str], Any] | None = None) -> Any:
    """pytds TLS context factory: exactly TLS 1.2, no certificate validation for ENCRYPT_ONLY_CAFILE.

    python-tds 1.17.1 only enables TLS when given a CA file and always validates
    against it, so the encrypt-only mode swaps in this context. Any other cafile
    (a real CA bundle) gets pytds' stock validating context.
    """
    if cafile != ENCRYPT_ONLY_CAFILE:
        if _original is None:
            raise RuntimeError("no validating TLS context factory available")
        return _original(cafile)
    from OpenSSL import SSL

    ctx = SSL.Context(SSL.TLS_CLIENT_METHOD)
    # Exactly TLS 1.2: TDS 7 wraps TLS in PRELOGIN packets and pytds has only been
    # exercised with 1.2 there (stock pytds uses TLSv1_2_METHOD).
    ctx.set_min_proto_version(SSL.TLS1_2_VERSION)
    ctx.set_max_proto_version(SSL.TLS1_2_VERSION)
    ctx.set_verify(SSL.VERIFY_NONE, lambda *_: True)
    return ctx


def _install_tls_context_factory() -> None:
    from pytds import tls as pytds_tls

    if getattr(pytds_tls.create_context, "_amu_encrypt_only", False):
        return
    original = pytds_tls.create_context

    def factory(cafile: str) -> Any:
        return _encrypt_only_tls_context(cafile, original)

    factory._amu_encrypt_only = True  # type: ignore[attr-defined]
    pytds_tls.create_context = factory


REQUIRED_TLS_VERSION = "TLSv1.2"


def assert_tls_session(conn: Any) -> str:
    """Raise SessionSetupError unless the whole TDS session runs over TLS 1.2.

    Checked on the client: the server-side CONNECTIONPROPERTY('encrypt_option')
    needs VIEW SERVER STATE, which the read-only logins deliberately lack. pytds
    swaps the session socket for tls.EncryptedSocket after the handshake and
    swaps it back (revert_to_clear) if only the login was encrypted.
    Relies on python-tds internals (_tds_socket, main_session, _tls_conn), so the
    driver is pinned (python-tds==1.17.1 in Dockerfile.worker); an upgrade that
    changes them makes every run fail closed rather than read unencrypted.
    """
    from pytds import tls as pytds_tls

    tds_socket = getattr(conn, "_tds_socket", None)
    sock = getattr(tds_socket, "sock", None)
    session = getattr(tds_socket, "main_session", None)
    transports = (
        getattr(getattr(session, "_writer", None), "_transport", None),
        getattr(getattr(session, "_reader", None), "_transport", None),
    )
    if not isinstance(sock, pytds_tls.EncryptedSocket) or not all(t is sock for t in transports):
        raise SessionSetupError("connection is not TLS-encrypted; refusing to read")
    version = sock._tls_conn.get_protocol_version_name()
    if version != REQUIRED_TLS_VERSION:
        raise SessionSetupError(f"unexpected TLS version {version!r}; refusing to read")
    return version


def _pytds_connect(settings: ConnectionSettings, *, app_name: str) -> Any:
    import pytds  # imported lazily so unit tests never need the driver

    _install_tls_context_factory()
    conn = _pytds_raw_connect(pytds, settings, app_name=app_name)
    try:
        version = assert_tls_session(conn)
    except Exception:
        try:
            conn.close()
        except Exception:  # noqa: BLE001 - never mask the TLS refusal with a shutdown error
            pass
        raise
    print(f"{app_name}: {version} session established (certificate not validated)", flush=True)
    return conn


def _pytds_raw_connect(pytds: Any, settings: ConnectionSettings, *, app_name: str) -> Any:
    return pytds.connect(
        cafile=ENCRYPT_ONLY_CAFILE,
        validate_host=False,
        enc_login_only=False,
        server=settings.host,
        port=settings.port,
        database=settings.database,
        user=settings.username,
        password=settings.password,
        login_timeout=LOGIN_TIMEOUT_SECONDS,
        timeout=settings.query_timeout,
        appname=app_name,
        autocommit=True,
        pooling=False,
        use_mars=False,
    )


class MssqlReader:
    """One sequential, read-only session. Use as a context manager."""

    def __init__(
        self,
        settings: ConnectionSettings,
        *,
        app_name: str,
        connect: Callable[[ConnectionSettings], Any] | None = None,
        batch_size: int = FETCH_BATCH_SIZE,
    ) -> None:
        if not app_name:
            raise ValueError("app_name is required")
        self.settings = settings
        self.app_name = app_name
        self._connect = connect or functools.partial(_pytds_connect, app_name=app_name)
        self.batch_size = batch_size
        self._conn: Any = None

    def open(self) -> "MssqlReader":
        self.close()
        conn = self._connect(self.settings)
        try:
            self._conn = conn
            self._run_session_setup()
            self._verify_session()
        except Exception:
            self.close()
            raise
        return self

    def close(self) -> None:
        conn, self._conn = self._conn, None
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001 - closing a dead socket is fine
                pass

    @property
    def is_open(self) -> bool:
        return self._conn is not None

    def __enter__(self) -> "MssqlReader":
        return self.open()

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _run_session_setup(self) -> None:
        cur = self._conn.cursor()
        try:
            for stmt in SESSION_SETUP_STATEMENTS:
                cur.execute(stmt)
        finally:
            cur.close()

    def _verify_session(self) -> None:
        rows = list(self._iter_rows(SESSION_CHECK, None))
        if len(rows) != 1:
            raise SessionSetupError("could not read own session settings")
        row = rows[0]
        iso = int(row["transaction_isolation_level"])
        lock = int(row["lock_timeout"])
        prio = int(row["deadlock_priority"])
        if (iso, lock, prio) != (EXPECTED_ISOLATION_LEVEL, EXPECTED_LOCK_TIMEOUT_MS, EXPECTED_DEADLOCK_PRIORITY):
            raise SessionSetupError(
                f"session settings not applied (isolation={iso}, lock_timeout={lock}, deadlock_priority={prio})"
            )

    def _iter_rows(self, sql: str, params: Mapping[str, Any] | None) -> Iterator[dict[str, Any]]:
        guard_select(sql)
        if self._conn is None:
            raise RuntimeError("connection is not open")
        cur = self._conn.cursor()
        try:
            if params:
                cur.execute(sql, dict(params))
            else:
                cur.execute(sql)
            columns = [d[0] for d in (cur.description or [])]
            while True:
                batch = cur.fetchmany(self.batch_size)
                if not batch:
                    break
                for rec in batch:
                    yield dict(zip(columns, rec))
        finally:
            try:
                cur.close()
            except Exception:  # noqa: BLE001
                pass

    def fetch_all(
        self,
        sql: str,
        params: Mapping[str, Any] | None = None,
        *,
        check_deadline: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        """Stream a guarded SELECT in fetchmany batches into a list."""
        out: list[dict[str, Any]] = []
        for i, row in enumerate(self._iter_rows(sql, params)):
            out.append(row)
            if check_deadline is not None and i % self.batch_size == 0:
                check_deadline()
        return out


# ---------------------------------------------------------------------------
# Job controls
# ---------------------------------------------------------------------------


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def int_env(env: Mapping[str, str], name: str, default: int) -> int:
    raw = (env.get(name) or "").strip()
    return int(raw) if raw else default


def is_blocked_hour(now_utc: datetime | None = None) -> bool:
    """True during business hours (07:00 to 22:00 America/New_York)."""
    from zoneinfo import ZoneInfo

    now_utc = now_utc or datetime.now(timezone.utc)
    local = now_utc.astimezone(ZoneInfo(TIMEZONE))
    return BLOCKED_START_HOUR <= local.hour < BLOCKED_END_HOUR


class _Watchdog:
    """Hard kill after max_seconds, even if a socket read is stuck."""

    def __init__(self, max_seconds: int, on_expire: Callable[[], None] | None = None, *, label: str = "mssql") -> None:
        self.max_seconds = max_seconds
        self.label = label
        self.deadline = time.monotonic() + max_seconds
        self._on_expire = on_expire or self._kill
        self._timer = threading.Timer(max_seconds, self._on_expire)
        self._timer.daemon = True

    def _kill(self) -> None:
        print(f"{self.label}: hard cap of {self.max_seconds}s reached, exiting", flush=True)
        # os._exit closes the socket; SQL Server then ends the session.
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


def _connection_broken(exc: BaseException) -> bool:
    """Socket-level failures leave the TDS stream unusable; server errors do not."""
    if isinstance(exc, (OSError, TimeoutError, ConnectionError, EOFError)):
        return True
    name = type(exc).__name__
    return name in {"ClosedConnectionError", "OperationalError"} and "closed" in str(exc).lower()


Dataset = tuple[str, str, tuple[str, ...]]


def run_publisher(
    source: str,
    datasets: Sequence[Dataset],
    params: Mapping[str, Any],
    *,
    env_prefix: str,
    kms_key_id: str,
    app_name: str,
    env: Mapping[str, str] | None = None,
    connect: Callable[[ConnectionSettings], Any] | None = None,
    now_utc: datetime | None = None,
    watchdog_factory: Callable[[int], Any] | None = None,
) -> dict[str, Any]:
    """Run one SQL Server source end to end (see the module docstring)."""
    env = dict(os.environ) if env is None else env
    upper = source.upper()
    if not (kms_key_id or "").strip():
        raise RuntimeError(f"{source}: KMS key id is required; refusing to write unencrypted data")
    dry_run = truthy(env.get(f"{upper}_DRY_RUN"))

    if is_blocked_hour(now_utc) and not truthy(env.get(f"{upper}_ALLOW_DAYTIME")):
        msg = (
            f"{source}: refusing to run between 07:00 and 22:00 America/New_York "
            f"(set {upper}_ALLOW_DAYTIME=1 to override)"
        )
        print(msg, flush=True)
        return {"ok": False, "source": source, "skipped": "daytime-window", "message": msg}

    settings = settings_from_env(env_prefix, env, query_timeout_env=f"{upper}_QUERY_TIMEOUT_SECONDS")
    max_runtime = int_env(env, f"{upper}_MAX_RUNTIME_SECONDS", DEFAULT_MAX_RUNTIME_SECONDS)
    log_target = f"{settings.host}/{settings.database}"  # never credentials

    for name, sql, param_names in datasets:
        guard_select(sql)  # fail before connecting if any statement is unsafe
        unknown = [p for p in param_names if p not in params]
        if unknown:
            raise ValueError(f"{source}/{name}: unknown parameter(s) {', '.join(unknown)}")

    factory = watchdog_factory or functools.partial(_Watchdog, label=source)
    watchdog = factory(max_runtime).start()
    reader = MssqlReader(settings, app_name=app_name, connect=connect)
    try:
        reader.open()
        if dry_run:
            return _dry_run(source, reader, log_target)
        return _publish_all(source, datasets, params, reader, settings, log_target, watchdog, kms_key_id)
    finally:
        reader.close()
        watchdog.cancel()


def _dry_run(source: str, reader: MssqlReader, log_target: str) -> dict[str, Any]:
    version = reader.fetch_all(VERSION_CHECK)
    raw_version = str((version[0] if version else {}).get("server_version") or "").strip()
    server_version = raw_version.splitlines()[0] if raw_version else "unknown"
    database = str((version[0] if version else {}).get("database_name") or "")
    print(f"{source} dry run ({log_target}): session settings verified; {server_version}", flush=True)
    return {
        "ok": True,
        "source": source,
        "dry_run": True,
        "server_version": server_version,
        "database_name": database,
    }


def _publish_all(
    source: str,
    datasets: Sequence[Dataset],
    params: Mapping[str, Any],
    reader: MssqlReader,
    settings: ConnectionSettings,
    log_target: str,
    watchdog: Any,
    kms_key_id: str,
) -> dict[str, Any]:
    started = _now()
    started_mono = time.monotonic()
    results: list[dict[str, Any]] = []
    reconnects = 0
    print(f"{source}: publishing {len(datasets)} dataset(s) from {log_target}", flush=True)

    for dataset, sql, param_names in datasets:
        entry: dict[str, Any] = {"dataset": dataset, "started_at": _now()}
        t0 = time.monotonic()
        try:
            watchdog.check()
            if not reader.is_open:
                if reconnects >= MAX_RECONNECTS:
                    raise RuntimeError("connection lost and reconnect limit reached")
                reconnects += 1
                reader.open()
            bound = {name: params[name] for name in param_names}
            rows = reader.fetch_all(sql, bound or None, check_deadline=watchdog.check)
            query_seconds = round(time.monotonic() - t0, 3)
            latest = publish_dataset(
                source=source,
                dataset=dataset,
                rows=rows,
                provenance={
                    "system": source,
                    "database": settings.database,
                    "dataset": dataset,
                    "params": {k: str(v) for k, v in bound.items()},
                },
                kms_key_id=kms_key_id,
                refresh_catalog=False,
            )
            entry.update(
                ok=True,
                record_count=latest["record_count"],
                prefix=latest["prefix"],
                query_seconds=query_seconds,
            )
            print(f"{source}/{dataset}: {latest['record_count']} rows in {query_seconds}s", flush=True)
        except JobTimeout as exc:
            entry.update(ok=False, error=f"JobTimeout: {exc}")
            entry["duration_seconds"] = round(time.monotonic() - t0, 3)
            results.append(entry)
            break
        except Exception as exc:  # noqa: BLE001 - one dataset must not stop the others
            entry.update(ok=False, error=settings.redact(f"{type(exc).__name__}: {exc}")[:1000])
            print(f"{source}/{dataset}: FAILED {entry['error']}", flush=True)
            if _connection_broken(exc):
                reader.close()
        entry["duration_seconds"] = round(time.monotonic() - t0, 3)
        results.append(entry)

    ran = {r["dataset"] for r in results}
    for dataset, _, _ in datasets:
        if dataset not in ran:
            results.append({"dataset": dataset, "ok": False, "error": "not run: job hard cap reached"})

    failed = [r["dataset"] for r in results if not r.get("ok")]
    manifest = {
        "schema_version": 1,
        "source": source,
        "database": settings.database,
        "started_at": started,
        "finished_at": _now(),
        "duration_seconds": round(time.monotonic() - started_mono, 3),
        "params": {k: str(v) for k, v in params.items()},
        "reconnects": reconnects,
        "ok": not failed,
        "failed": failed,
        "datasets": results,
    }
    day = started[:10]
    put_json(f"sources/{source}/_runs/dt={day}/manifest.json", manifest, kms_key_id=kms_key_id)
    put_json(f"sources/{source}/_runs/latest.json", manifest, kms_key_id=kms_key_id)
    if failed:
        raise PartialFailure(f"{len(failed)} dataset(s) failed: {', '.join(failed)}")
    return {"ok": True, "source": source, "datasets": results}
