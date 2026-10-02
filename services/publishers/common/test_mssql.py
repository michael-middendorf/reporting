"""Tests for the shared SQL Server publisher core. Fakes only; no database, no S3.

Run from the repo root:
  PYTHONPATH=services/publishers python -m unittest discover -s services/publishers/common -t services/publishers/common
"""
from __future__ import annotations

import types
import unittest
from datetime import datetime, timezone
from unittest import mock

from common import mssql

PREFIX = "XS"
SOURCE = "examplesrc"
UPPER = "EXAMPLESRC"
APP = "amu-reporting-worker-examplesrc"
KMS = "arn:aws:kms:us-east-2:000000000000:key/11111111-1111-1111-1111-111111111111"
ENV = {
    f"{PREFIX}_HOST": "db.example.invalid",
    f"{PREFIX}_DATABASE": "FakeDb",
    f"{PREFIX}_USERNAME": "fake_user",
    f"{PREFIX}_PASSWORD": "fake-password-value",
    "DATA_BUCKET": "fake-bucket",
}
NIGHT = datetime(2026, 9, 29, 7, 30, tzinfo=timezone.utc)
NOON = datetime(2026, 9, 29, 16, 0, tzinfo=timezone.utc)
SQL_A = "SELECT a.ID, a.NAME FROM dbo.A AS a OPTION (MAXDOP 1)"
SQL_B = "SELECT b.ID FROM dbo.B AS b WHERE b.YR >= %(min_year)s OPTION (MAXDOP 1)"
SQL_C = "SELECT c.ID FROM dbo.C AS c OPTION (MAXDOP 1)"
DATASETS = (("a", SQL_A, ()), ("b", SQL_B, ("min_year",)), ("c", SQL_C, ()))
PARAMS = {"min_year": "2020"}


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self.description = None
        self._rows: list[tuple] = []

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))
        for needle, exc in self.conn.fail_on.items():
            if needle in sql:
                raise exc
        if "sys.dm_exec_sessions" in sql:
            self.description = [("transaction_isolation_level",), ("lock_timeout",), ("deadlock_priority",)]
            self._rows = [self.conn.session_row]
        elif sql.startswith("SET "):
            self.description, self._rows = None, []
        elif "@@VERSION" in sql:
            self.description = [("server_version",), ("database_name",)]
            self._rows = [("Microsoft SQL Server 2019\nStandard", "FakeDb")]
        else:
            self.description = [("COL_A",), ("COL_B",)]
            self._rows = [(i, f"v{i}") for i in range(self.conn.rows_per_query)]

    def fetchmany(self, size):
        self.conn.fetch_sizes.append(size)
        batch, self._rows = self._rows[:size], self._rows[size:]
        return batch

    def close(self):
        pass


class FakeConnection:
    def __init__(self, *, fail_on=None, session_row=(1, 5000, -5), rows_per_query=3):
        self.executed: list[tuple] = []
        self.fetch_sizes: list[int] = []
        self.fail_on = fail_on or {}
        self.session_row = session_row
        self.rows_per_query = rows_per_query
        self.closed = False

    def cursor(self):
        return FakeCursor(self)

    def close(self):
        self.closed = True


class NoopWatchdog:
    def __init__(self, max_seconds):
        self.max_seconds = max_seconds

    def start(self):
        return self

    def cancel(self):
        pass

    def check(self):
        pass


def _fake_publish(**kwargs):
    return {"record_count": len(kwargs["rows"]), "prefix": f"sources/{kwargs['source']}/{kwargs['dataset']}/dt=x"}


def run(conn, *, env=None, now=NIGHT, connects=None, datasets=DATASETS, watchdog_factory=NoopWatchdog, kms=KMS):
    def connect(settings):
        if connects is not None:
            connects.append(settings)
        return conn

    return mssql.run_publisher(
        SOURCE,
        datasets,
        PARAMS,
        env_prefix=PREFIX,
        kms_key_id=kms,
        app_name=APP,
        env={**ENV, **(env or {})},
        connect=connect,
        now_utc=now,
        watchdog_factory=watchdog_factory,
    )


class GuardTests(unittest.TestCase):
    def test_accepts_safe_statements(self):
        for sql in (mssql.SESSION_CHECK, mssql.VERSION_CHECK, SQL_A, SQL_B):
            self.assertEqual(mssql.guard_select(sql), sql)

    def test_rejects_unsafe(self):
        for sql in (
            "",
            "SET LOCK_TIMEOUT 0",
            "INSERT INTO dbo.T (A) VALUES (1) OPTION (MAXDOP 1)",
            "UPDATE dbo.T SET A = 1 OPTION (MAXDOP 1)",
            "DELETE FROM dbo.T OPTION (MAXDOP 1)",
            "EXEC sp_who OPTION (MAXDOP 1)",
            "SELECT a.X INTO dbo.Y FROM dbo.T AS a OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a WHERE a.Y = xp_cmdshell OPTION (MAXDOP 1)",
            "SELECT * FROM dbo.T OPTION (MAXDOP 1)",
            "SELECT a.* FROM dbo.T AS a OPTION (MAXDOP 1)",
            "SELECT COUNT(*) FROM dbo.T OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a",
            "SELECT a.X FROM dbo.T AS a OPTION (MAXDOP 4)",
            "SELECT a.X FROM dbo.T AS a -- OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a /* c */ OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a; SELECT b.Y FROM dbo.U AS b OPTION (MAXDOP 1)",
            "WITH c AS (SELECT a.X FROM dbo.T AS a) Update dbo.T SET X = 1 OPTION (MAXDOP 1)",
        ):
            with self.subTest(sql=sql):
                with self.assertRaises(mssql.UnsafeQueryError):
                    mssql.guard_select(sql)

    def test_keyword_match_is_whole_word(self):
        mssql.guard_select("SELECT s.session_id FROM sys.dm_exec_sessions AS s OPTION (MAXDOP 1)")
        mssql.guard_select("SELECT t.LAST_UPDATED FROM dbo.T AS t OPTION (MAXDOP 1)")


class ExclusionHelperTests(unittest.TestCase):
    def test_select_list_identifiers(self):
        sql = (
            "SELECT a.ID, CAST(a.AMT AS DECIMAL) AS amount, [b].[Odd Name], 'lit_ssn' AS tag "
            "FROM dbo.A AS a WHERE a.SSN IS NULL OPTION (MAXDOP 1)"
        )
        self.assertEqual(mssql.select_list_identifiers(sql), ["ID", "AMT", "amount", "Odd Name", "tag"])
        self.assertEqual(mssql.select_list_identifiers(mssql.VERSION_CHECK), ["server_version", "database_name"])

    def test_substring_and_whole_token_rules(self):
        sql = "SELECT a.STU_DOB, a.DOBSON, a.ROUTING_NO, a.Parent_Name FROM dbo.A AS a OPTION (MAXDOP 1)"
        hits = mssql.excluded_column_hits(sql, ("dob", "tin", "parent"), ("dob", "tin"))
        self.assertEqual(hits, [("STU_DOB", "dob"), ("Parent_Name", "parent")])


class SettingsTests(unittest.TestCase):
    def test_reads_prefixed_env_and_defaults(self):
        s = mssql.settings_from_env(PREFIX, ENV)
        self.assertEqual((s.host, s.port, s.database), ("db.example.invalid", 1433, "FakeDb"))
        self.assertEqual(s.query_timeout, 300)
        s = mssql.settings_from_env(PREFIX, {**ENV, f"{PREFIX}_PORT": "1500", "T": "90"}, query_timeout_env="T")
        self.assertEqual((s.port, s.query_timeout), (1500, 90))

    def test_missing_settings_named(self):
        with self.assertRaises(RuntimeError) as ctx:
            mssql.settings_from_env(PREFIX, {f"{PREFIX}_HOST": "h"})
        self.assertIn(f"{PREFIX}_PASSWORD", str(ctx.exception))

    def test_repr_and_redact_hide_credentials(self):
        s = mssql.settings_from_env(PREFIX, ENV)
        self.assertNotIn("fake-password-value", repr(s))
        self.assertNotIn("fake_user", str(s))
        self.assertEqual(s.redact("user 'fake_user' pw fake-password-value"), "user '***' pw ***")
        self.assertEqual(mssql.redact("x fake_user", s), "x ***")


class ReaderTests(unittest.TestCase):
    def test_session_setup_and_verify(self):
        conn = FakeConnection()
        mssql.MssqlReader(mssql.settings_from_env(PREFIX, ENV), app_name=APP, connect=lambda s: conn).open()
        sent = [sql for sql, _ in conn.executed]
        self.assertEqual(sent[:4], [*mssql.SESSION_SETUP_STATEMENTS, mssql.SESSION_CHECK])
        self.assertEqual(
            mssql.SESSION_SETUP_STATEMENTS,
            ("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED", "SET LOCK_TIMEOUT 5000", "SET DEADLOCK_PRIORITY LOW"),
        )

    def test_fails_closed(self):
        conn = FakeConnection(session_row=(2, -1, 0))
        reader = mssql.MssqlReader(mssql.settings_from_env(PREFIX, ENV), app_name=APP, connect=lambda s: conn)
        with self.assertRaises(mssql.SessionSetupError):
            reader.open()
        self.assertTrue(conn.closed)
        self.assertFalse(reader.is_open)

    def test_refuses_unsafe_sql_before_sending(self):
        conn = FakeConnection()
        reader = mssql.MssqlReader(mssql.settings_from_env(PREFIX, ENV), app_name=APP, connect=lambda s: conn).open()
        before = len(conn.executed)
        with self.assertRaises(mssql.UnsafeQueryError):
            reader.fetch_all("DELETE FROM dbo.T OPTION (MAXDOP 1)")
        self.assertEqual(len(conn.executed), before)

    def test_streams_with_fetchmany(self):
        conn = FakeConnection(rows_per_query=12)
        reader = mssql.MssqlReader(mssql.settings_from_env(PREFIX, ENV), app_name=APP, connect=lambda s: conn, batch_size=5).open()
        rows = reader.fetch_all(SQL_A)
        self.assertEqual(len(rows), 12)
        self.assertIn(5, conn.fetch_sizes)

    def test_app_name_required_and_passed(self):
        with self.assertRaises(ValueError):
            mssql.MssqlReader(mssql.settings_from_env(PREFIX, ENV), app_name="")
        captured = {}

        class FakePytds:
            class tls:  # noqa: N801 - stands in for the pytds.tls module
                class EncryptedSocket:
                    def __init__(self):
                        self._tls_conn = types.SimpleNamespace(get_protocol_version_name=lambda: "TLSv1.2")

                @staticmethod
                def create_context(cafile):
                    return None

            @staticmethod
            def connect(**kwargs):
                captured.update(kwargs)
                conn = FakeConnection()
                sock = FakePytds.tls.EncryptedSocket()
                session = types.SimpleNamespace(
                    _writer=types.SimpleNamespace(_transport=sock), _reader=types.SimpleNamespace(_transport=sock)
                )
                conn._tds_socket = types.SimpleNamespace(sock=sock, main_session=session)
                return conn

        with mock.patch.dict("sys.modules", {"pytds": FakePytds}):
            mssql.MssqlReader(mssql.settings_from_env(PREFIX, ENV), app_name=APP).open()
        self.assertEqual(captured["appname"], APP)
        self.assertTrue(captured["autocommit"])
        self.assertFalse(captured["use_mars"])
        self.assertEqual(captured["login_timeout"], 15)


class JobTests(unittest.TestCase):
    def test_blocked_window_edges(self):
        self.assertTrue(mssql.is_blocked_hour(datetime(2026, 9, 29, 11, 0, tzinfo=timezone.utc)))
        self.assertFalse(mssql.is_blocked_hour(datetime(2026, 9, 29, 10, 59, tzinfo=timezone.utc)))
        self.assertFalse(mssql.is_blocked_hour(datetime(2026, 9, 30, 2, 0, tzinfo=timezone.utc)))
        self.assertTrue(mssql.is_blocked_hour(datetime(2026, 9, 30, 1, 59, tzinfo=timezone.utc)))
        self.assertFalse(mssql.is_blocked_hour(datetime(2026, 1, 15, 7, 30, tzinfo=timezone.utc)))

    def test_publishes_with_kms_and_no_catalog(self):
        conn = FakeConnection()
        with mock.patch.object(mssql, "publish_dataset", side_effect=_fake_publish) as pub, mock.patch.object(mssql, "put_json") as put:
            result = run(conn)
        self.assertTrue(result["ok"])
        self.assertEqual([c.kwargs["dataset"] for c in pub.call_args_list], ["a", "b", "c"])
        for c in pub.call_args_list:
            self.assertEqual(c.kwargs["kms_key_id"], KMS)
            self.assertIs(c.kwargs["refresh_catalog"], False)
        self.assertEqual({s: p for s, p in conn.executed}[SQL_B], {"min_year": "2020"})
        day = datetime.now(timezone.utc).date().isoformat()
        self.assertEqual(
            [c.args[0] for c in put.call_args_list],
            [f"sources/{SOURCE}/_runs/dt={day}/manifest.json", f"sources/{SOURCE}/_runs/latest.json"],
        )
        self.assertTrue(all(c.kwargs["kms_key_id"] == KMS for c in put.call_args_list))
        self.assertTrue(conn.closed)

    def test_refuses_without_kms(self):
        with self.assertRaises(RuntimeError):
            run(FakeConnection(), kms="")

    def test_unsafe_dataset_rejected_before_connect(self):
        connects = []
        with self.assertRaises(mssql.UnsafeQueryError):
            run(FakeConnection(), connects=connects, datasets=(("x", "SELECT * FROM dbo.T OPTION (MAXDOP 1)", ()),))
        self.assertEqual(connects, [])

    def test_unknown_param_rejected(self):
        with self.assertRaises(ValueError):
            run(FakeConnection(), datasets=(("x", SQL_A, ("nope",)),))

    def test_daytime_skip_and_override(self):
        connects = []
        with mock.patch.object(mssql, "publish_dataset", side_effect=_fake_publish), mock.patch.object(mssql, "put_json") as put:
            skipped = run(FakeConnection(), now=NOON, connects=connects)
            self.assertEqual(skipped["skipped"], "daytime-window")
            self.assertEqual(connects, [])
            put.assert_not_called()
            ok = run(FakeConnection(), now=NOON, env={f"{UPPER}_ALLOW_DAYTIME": "1"})
        self.assertTrue(ok["ok"])

    def test_dry_run_writes_nothing(self):
        conn = FakeConnection()
        with mock.patch.object(mssql, "publish_dataset") as pub, mock.patch.object(mssql, "put_json") as put:
            result = run(conn, env={f"{UPPER}_DRY_RUN": "1"})
        pub.assert_not_called()
        put.assert_not_called()
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["server_version"], "Microsoft SQL Server 2019")
        sent = [s for s, _ in conn.executed if s not in mssql.SESSION_SETUP_STATEMENTS]
        self.assertEqual(sent, [mssql.SESSION_CHECK, mssql.VERSION_CHECK])

    def test_partial_failure_records_and_raises(self):
        conn = FakeConnection(fail_on={"dbo.B": RuntimeError("Lock request time out (1222) for fake_user")})
        with mock.patch.object(mssql, "publish_dataset", side_effect=_fake_publish) as pub, mock.patch.object(mssql, "put_json") as put:
            with self.assertRaises(mssql.PartialFailure):
                run(conn)
        self.assertEqual([c.kwargs["dataset"] for c in pub.call_args_list], ["a", "c"])
        manifest = put.call_args_list[-1].args[1]
        self.assertEqual(manifest["failed"], ["b"])
        self.assertNotIn("fake_user", str(manifest))

    def test_reconnects_at_most_twice(self):
        conn = FakeConnection(fail_on={"dbo.": TimeoutError("timed out")})
        connects = []
        datasets = tuple((f"d{i}", f"SELECT t.ID FROM dbo.T{i} AS t OPTION (MAXDOP 1)", ()) for i in range(5))
        with mock.patch.object(mssql, "publish_dataset") as pub, mock.patch.object(mssql, "put_json") as put:
            with self.assertRaises(mssql.PartialFailure):
                run(conn, connects=connects, datasets=datasets)
        pub.assert_not_called()
        self.assertEqual(len(connects), 1 + mssql.MAX_RECONNECTS)
        manifest = put.call_args_list[-1].args[1]
        self.assertEqual(manifest["reconnects"], mssql.MAX_RECONNECTS)
        self.assertIn("reconnect limit", manifest["datasets"][-1]["error"])

    def test_hard_cap_reports_all_datasets(self):
        class Expired(NoopWatchdog):
            def check(self):
                raise mssql.JobTimeout("cap")

        with mock.patch.object(mssql, "publish_dataset") as pub, mock.patch.object(mssql, "put_json") as put:
            with self.assertRaises(mssql.PartialFailure):
                run(FakeConnection(), watchdog_factory=Expired)
        pub.assert_not_called()
        manifest = put.call_args_list[-1].args[1]
        self.assertEqual(len(manifest["datasets"]), len(DATASETS))
        self.assertTrue(all(not r["ok"] for r in manifest["datasets"]))

    def test_max_runtime_env(self):
        seen = []

        def factory(seconds):
            seen.append(seconds)
            return NoopWatchdog(seconds)

        with mock.patch.object(mssql, "publish_dataset", side_effect=_fake_publish), mock.patch.object(mssql, "put_json"):
            run(FakeConnection(), watchdog_factory=factory)
            run(FakeConnection(), watchdog_factory=factory, env={f"{UPPER}_MAX_RUNTIME_SECONDS": "60"})
        self.assertEqual(seen, [1800, 60])

    def test_watchdog_fires_callback(self):
        fired = []
        wd = mssql._Watchdog(0, on_expire=lambda: fired.append(True), label=SOURCE)
        wd.start()
        wd._timer.join(2)
        self.assertEqual(fired, [True])
        with self.assertRaises(mssql.JobTimeout):
            wd.check()


class TlsTests(unittest.TestCase):
    """Every connection is TLS 1.2 for the whole session; anything else is refused."""

    class _Enc:  # stands in for pytds.tls.EncryptedSocket
        def __init__(self, version="TLSv1.2"):
            self._tls_conn = types.SimpleNamespace(get_protocol_version_name=lambda: version)

    def _fake_tls(self):
        return types.SimpleNamespace(EncryptedSocket=self._Enc, create_context=lambda cafile: "stock")

    def _conn(self, sock, writer=None, reader=None):
        session = types.SimpleNamespace(
            _writer=types.SimpleNamespace(_transport=sock if writer is None else writer),
            _reader=types.SimpleNamespace(_transport=sock if reader is None else reader),
        )
        return types.SimpleNamespace(_tds_socket=types.SimpleNamespace(sock=sock, main_session=session))

    def _assert(self, conn):
        fake_tls = self._fake_tls()
        fake_pytds = types.SimpleNamespace(tls=fake_tls)
        with mock.patch.dict("sys.modules", {"pytds": fake_pytds, "pytds.tls": fake_tls}):
            return mssql.assert_tls_session(conn)

    def test_encrypted_tls12_session_passes(self):
        self.assertEqual(self._assert(self._conn(self._Enc())), "TLSv1.2")

    def test_plain_socket_refused(self):
        with self.assertRaises(mssql.SessionSetupError):
            self._assert(self._conn(object()))

    def test_login_only_encryption_refused(self):
        sock = self._Enc()
        with self.assertRaises(mssql.SessionSetupError):
            self._assert(self._conn(sock, writer=object(), reader=object()))

    def test_other_tls_version_refused(self):
        with self.assertRaises(mssql.SessionSetupError):
            self._assert(self._conn(self._Enc("TLSv1.3")))

    def test_driver_called_with_tls_on_and_closed_if_unencrypted(self):
        fake_tls = self._fake_tls()
        plain = FakeConnection()
        plain._tds_socket = types.SimpleNamespace(sock=object(), main_session=None)
        fake_pytds = mock.MagicMock()
        fake_pytds.tls = fake_tls
        fake_pytds.connect.return_value = plain
        with mock.patch.dict("sys.modules", {"pytds": fake_pytds, "pytds.tls": fake_tls}):
            with self.assertRaises(mssql.SessionSetupError):
                mssql._pytds_connect(mssql.settings_from_env(PREFIX, ENV), app_name=APP)
        self.assertTrue(plain.closed)
        kwargs = fake_pytds.connect.call_args.kwargs
        self.assertEqual(kwargs["cafile"], mssql.ENCRYPT_ONLY_CAFILE)
        self.assertFalse(kwargs["enc_login_only"])
        self.assertFalse(kwargs["validate_host"])
        self.assertTrue(getattr(fake_tls.create_context, "_amu_encrypt_only", False))
        self.assertEqual(fake_tls.create_context("/real/ca.pem"), "stock")

    def test_encrypt_only_context_skips_validation_only_for_sentinel(self):
        try:
            from OpenSSL import SSL
        except ImportError:
            self.skipTest("pyOpenSSL not installed")
        ctx = mssql._encrypt_only_tls_context(mssql.ENCRYPT_ONLY_CAFILE)
        self.assertEqual(ctx.get_verify_mode(), SSL.VERIFY_NONE)
        with self.assertRaises(RuntimeError):
            mssql._encrypt_only_tls_context("/real/ca.pem")


if __name__ == "__main__":
    unittest.main()
