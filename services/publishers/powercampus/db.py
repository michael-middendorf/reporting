"""Read-only, low-impact connection layer for the production PowerCampus DB.

Top requirement: this job must never harm University_AMU. Defenses, in order:
  1. The login amu_reporting_ro is read-only at the database (DENY on writes,
     EXECUTE, DDL; column-level SELECT grants only).
  2. guard_select() rejects any statement that is not a single SELECT/WITH,
     contains a write/DDL/exec keyword, SELECT *, COUNT(*), comments, or lacks
     OPTION (MAXDOP 1). Every statement goes through it before it is sent.
  3. Session setup: READ UNCOMMITTED (no shared locks that block PowerCampus
     users), LOCK_TIMEOUT 5000 (never wait long on someone else's lock),
     DEADLOCK_PRIORITY LOW (always the deadlock victim). Verified by reading
     this session's row in sys.dm_exec_sessions; the job aborts if it does not
     match (fail closed).
  4. autocommit on, no explicit transactions, one connection, sequential
     queries, fetchmany streaming, login and per-query timeouts.
  5. Application name amu-reporting-worker-powercampus so the DBA can find
     and kill the session if ever needed.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Iterator, Mapping

try:
    from . import queries
except ImportError:  # pragma: no cover - flat import when run from this directory (tests)
    import queries  # type: ignore[no-redef]

APP_NAME = "amu-reporting-worker-powercampus"
LOGIN_TIMEOUT_SECONDS = 15
DEFAULT_QUERY_TIMEOUT_SECONDS = 300
FETCH_BATCH_SIZE = 5000

# Issued one at a time, verbatim, right after connect. These are the only
# non-SELECT statements this module will ever send (see _run_session_setup).
SESSION_SETUP_STATEMENTS: tuple[str, ...] = (
    "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
    "SET LOCK_TIMEOUT 5000",
    "SET DEADLOCK_PRIORITY LOW",
)

# sys.dm_exec_sessions values that prove the setup took effect.
EXPECTED_ISOLATION_LEVEL = 1  # 1 = ReadUncommitted
EXPECTED_LOCK_TIMEOUT_MS = 5000
EXPECTED_DEADLOCK_PRIORITY = -5  # LOW

FORBIDDEN_KEYWORDS: tuple[str, ...] = (
    "INSERT", "UPDATE", "DELETE", "MERGE", "EXEC", "EXECUTE", "DROP", "ALTER",
    "CREATE", "TRUNCATE", "GRANT", "REVOKE", "DENY", "INTO", "BACKUP",
    "RESTORE", "DBCC", "SHUTDOWN", "KILL", "OPENROWSET", "OPENQUERY",
    "OPENDATASOURCE", "WAITFOR", "USE",
)
_FORBIDDEN_RE = re.compile(r"\b(" + "|".join(FORBIDDEN_KEYWORDS) + r")\b", re.IGNORECASE)
# Extended and system stored procedures (xp_cmdshell, sp_executesql, ...).
_PROC_PREFIX_RE = re.compile(r"\b(xp_|sp_)", re.IGNORECASE)
_COUNT_STAR_RE = re.compile(r"\bCOUNT_BIG\s*\(\s*\*\s*\)|\bCOUNT\s*\(\s*\*\s*\)", re.IGNORECASE)
_LEADING_RE = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)
_MAXDOP_RE = re.compile(r"\bOPTION\s*\(\s*MAXDOP\s+1\s*\)\s*;?\s*$", re.IGNORECASE)


class UnsafeQueryError(ValueError):
    """Raised before sending when a statement fails the read-only guard."""


class SessionSetupError(RuntimeError):
    """Raised when the low-impact session settings cannot be confirmed."""


def guard_select(sql: str) -> str:
    """Return sql unchanged if it is a single, safe SELECT; raise otherwise."""
    if not isinstance(sql, str) or not sql.strip():
        raise UnsafeQueryError("empty statement")
    body = sql.strip()
    if "--" in body or "/*" in body or "*/" in body:
        raise UnsafeQueryError("comments are not allowed")
    # One statement only: a single trailing semicolon is tolerated.
    if ";" in body.rstrip(";").rstrip() or body.count(";") > 1:
        raise UnsafeQueryError("multiple statements are not allowed")
    if not _LEADING_RE.match(body):
        raise UnsafeQueryError("only SELECT or WITH statements are allowed")
    match = _FORBIDDEN_RE.search(body)
    if match:
        raise UnsafeQueryError(f"forbidden keyword: {match.group(1).upper()}")
    if _PROC_PREFIX_RE.search(body):
        raise UnsafeQueryError("stored procedure references (xp_/sp_) are not allowed")
    # A plain substring check covers SELECT *, TOP n *, and alias.* without a
    # backtracking-prone regex. COUNT(*) keeps its own message for clarity.
    if _COUNT_STAR_RE.search(body):
        raise UnsafeQueryError("COUNT(*) is not allowed; count a named column")
    if "*" in body:
        raise UnsafeQueryError("'*' is not allowed anywhere; name every column")
    if not _MAXDOP_RE.search(body):
        raise UnsafeQueryError("statement must end with OPTION (MAXDOP 1)")
    return sql


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
        out = str(text)
        for secret in (self.password, self.username):
            if secret:
                out = out.replace(secret, "***")
        return out


def settings_from_env(env: Mapping[str, str] | None = None) -> ConnectionSettings:
    env = os.environ if env is None else env
    missing = [k for k in ("PC_HOST", "PC_DATABASE", "PC_USERNAME", "PC_PASSWORD") if not (env.get(k) or "").strip()]
    if missing:
        raise RuntimeError(f"missing PowerCampus settings: {', '.join(missing)}")
    return ConnectionSettings(
        host=env["PC_HOST"].strip(),
        port=int((env.get("PC_PORT") or "1433").strip()),
        database=env["PC_DATABASE"].strip(),
        username=env["PC_USERNAME"].strip(),
        password=env["PC_PASSWORD"],
        query_timeout=int((env.get("POWERCAMPUS_QUERY_TIMEOUT_SECONDS") or str(DEFAULT_QUERY_TIMEOUT_SECONDS)).strip()),
    )


def _pytds_connect(settings: ConnectionSettings) -> Any:
    import pytds  # imported lazily so unit tests never need the driver

    return pytds.connect(
        server=settings.host,
        port=settings.port,
        database=settings.database,
        user=settings.username,
        password=settings.password,
        login_timeout=LOGIN_TIMEOUT_SECONDS,
        timeout=settings.query_timeout,
        appname=APP_NAME,
        autocommit=True,
        pooling=False,
        use_mars=False,
    )


class PowerCampusReader:
    """One sequential, read-only session. Use as a context manager."""

    def __init__(
        self,
        settings: ConnectionSettings,
        *,
        connect: Callable[[ConnectionSettings], Any] | None = None,
        batch_size: int = FETCH_BATCH_SIZE,
    ) -> None:
        self.settings = settings
        self._connect = connect or _pytds_connect
        self.batch_size = batch_size
        self._conn: Any = None

    # -- lifecycle -------------------------------------------------------
    def open(self) -> "PowerCampusReader":
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

    def __enter__(self) -> "PowerCampusReader":
        return self.open()

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- session safety --------------------------------------------------
    def _run_session_setup(self) -> None:
        cur = self._conn.cursor()
        try:
            for stmt in SESSION_SETUP_STATEMENTS:
                # Exact allowlist: nothing else non-SELECT can be sent here.
                if stmt not in SESSION_SETUP_STATEMENTS:  # pragma: no cover - defensive
                    raise UnsafeQueryError("unexpected session statement")
                cur.execute(stmt)
        finally:
            cur.close()

    def _verify_session(self) -> None:
        rows = list(self._iter_rows(queries.SESSION_CHECK, None))
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

    # -- queries ---------------------------------------------------------
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
        """Stream a guarded SELECT in fetchmany batches into a list.

        The whole result is read before anything is written to S3, so the
        server-side request finishes as fast as the network allows.
        """
        out: list[dict[str, Any]] = []
        for i, row in enumerate(self._iter_rows(sql, params)):
            out.append(row)
            if check_deadline is not None and i % self.batch_size == 0:
                check_deadline()
        return out
