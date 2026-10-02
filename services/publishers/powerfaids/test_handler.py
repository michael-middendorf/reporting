"""PowerFAIDS publisher safety tests. Fake connection only; no database, no S3.

Run from the repo root:
  PYTHONPATH=services/publishers python -m unittest discover -s services/publishers/powerfaids -t services/publishers/powerfaids
"""
from __future__ import annotations

import pathlib
import re
import unittest
from datetime import datetime, timezone
from unittest import mock

import handler
import queries
from common import mssql

SOURCE = "powerfaids"
UPPER = "POWERFAIDS"
PREFIX = "PF"
APP_NAME = "amu-reporting-worker-powerfaids"
KMS_KEY = "arn:aws:kms:us-east-2:000000000000:key/00000000-0000-0000-0000-000000000000"

ENV = {
    f"{PREFIX}_HOST": "db.example.invalid",
    f"{PREFIX}_PORT": "1433",
    f"{PREFIX}_DATABASE": "FakeDb",
    f"{PREFIX}_USERNAME": "fake_user",
    f"{PREFIX}_PASSWORD": "fake-password-value",
    f"{PREFIX}_KMS_KEY_ID": KMS_KEY,
    "DATA_BUCKET": "fake-bucket",
}
# 03:30 America/New_York (EDT): inside the allowed window.
NIGHT = datetime(2026, 9, 29, 7, 30, tzinfo=timezone.utc)
# 12:00 America/New_York: business hours.
NOON = datetime(2026, 9, 29, 16, 0, tzinfo=timezone.utc)

# Synthetic datasets for the handler path (DATASETS is empty until schema
# discovery lands). Names are deliberately generic.
FAKE_DATASETS = (
    ("fake_reference", "SELECT r.CODE, r.DESCRIPTION FROM dbo.FAKE_REF AS r OPTION (MAXDOP 1)", ()),
    ("fake_windowed", "SELECT w.ID, w.YEAR_VALUE FROM dbo.FAKE_WIN AS w WHERE w.YEAR_VALUE >= %(min_year)s OPTION (MAXDOP 1)", ("min_year",)),
)


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
        elif "CONNECTIONPROPERTY('encrypt_option')" in sql:
            self.description = [("encrypt_option",)]
            self._rows = [(self.conn.encrypt_option,)]
        elif sql.startswith("SET "):
            self.description = None
            self._rows = []
        elif "@@VERSION" in sql:
            self.description = [("server_version",), ("database_name",)]
            self._rows = [("Microsoft SQL Server 2019\nStandard", "FakeDb")]
        else:
            self.description = [("COL_A",), ("COL_B",)]
            self._rows = [(i, f"v{i}") for i in range(self.conn.rows_per_query)]

    def fetchmany(self, size):
        batch, self._rows = self._rows[:size], self._rows[size:]
        return batch

    def fetchall(self):  # pragma: no cover - must never be used
        raise AssertionError("fetchall must not be used; stream with fetchmany")

    def close(self):
        pass


class FakeConnection:
    def __init__(self, *, encrypt_option="TRUE", fail_on=None, session_row=(1, 5000, -5), rows_per_query=3):
        self.encrypt_option = encrypt_option
        self.executed: list[tuple] = []
        self.fail_on = fail_on or {}
        self.session_row = session_row
        self.rows_per_query = rows_per_query
        self.closed = False

    def cursor(self):
        return FakeCursor(self)

    def close(self):
        self.closed = True

    def commit(self):  # pragma: no cover
        raise AssertionError("commit must not be called")

    def rollback(self):  # pragma: no cover
        raise AssertionError("rollback must not be called")


class NoopWatchdog:
    def __init__(self, max_seconds):
        self.max_seconds = max_seconds

    def start(self):
        return self

    def cancel(self):
        pass

    def check(self):
        pass


def run(conn, *, env=None, now=NIGHT, connects=None):
    def connect(settings):
        if connects is not None:
            connects.append(settings)
        return conn

    return handler.handler(
        {}, None, env={**ENV, **(env or {})}, connect=connect, now_utc=now, watchdog_factory=NoopWatchdog
    )


def _fake_publish(**kwargs):
    return {
        "source": kwargs["source"],
        "dataset": kwargs["dataset"],
        "record_count": len(kwargs["rows"]),
        "prefix": f"sources/{kwargs['source']}/{kwargs['dataset']}/dt=2026-09-29",
    }


class GuardTests(unittest.TestCase):
    def test_every_statement_passes_guard(self):
        self.assertGreaterEqual(len(queries.ALL_STATEMENTS), 2)
        for sql in queries.ALL_STATEMENTS:
            with self.subTest(sql=sql[:60]):
                self.assertEqual(mssql.guard_select(sql), sql)
                self.assertRegex(sql, r"OPTION \(MAXDOP 1\)$")
                self.assertNotIn("*", sql)
                for m in re.finditer(r"%", sql):
                    self.assertRegex(sql[m.start():], r"^%\([a-z_]+\)s")

    def test_dataset_params_are_known(self):
        params = handler.window_params(7)
        for name, _, param_names in queries.DATASETS:
            with self.subTest(dataset=name):
                for p in param_names:
                    self.assertIn(p, params)


class ExclusionTests(unittest.TestCase):
    def hits(self, sql):
        return mssql.excluded_column_hits(sql, queries.EXCLUDED_COLUMN_SUBSTRINGS, queries.WHOLE_IDENTIFIER_TOKENS)

    def test_no_statement_selects_an_excluded_column(self):
        for sql in queries.ALL_STATEMENTS:
            with self.subTest(sql=sql[:60]):
                self.assertEqual(self.hits(sql), [])

    def test_exclusion_check_catches_violations(self):
        bad = {
            "SELECT s.STUDENT_ID, s.SSN FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "ssn",
            "SELECT s.STUDENT_ID, s.SocialSecurityNumber FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "social",
            "SELECT s.STUDENT_ID, s.TIN FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "tin",
            "SELECT s.STUDENT_ID, s.STU_DOB FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "dob",
            "SELECT s.STUDENT_ID, s.BIRTH_DATE FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "birth",
            "SELECT i.STUDENT_ID, i.PARENT_AGI FROM dbo.ISIR AS i OPTION (MAXDOP 1)": "parent",
            "SELECT i.STUDENT_ID, i.TotalIncome FROM dbo.ISIR AS i OPTION (MAXDOP 1)": "income",
            "SELECT i.STUDENT_ID, i.US_TAX_PAID FROM dbo.ISIR AS i OPTION (MAXDOP 1)": "tax",
            "SELECT s.STUDENT_ID, s.HOME_PHONE FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "phone",
            "SELECT s.STUDENT_ID, s.PERM_ADDRESS1 FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "address",
            "SELECT s.STUDENT_ID, s.Street2 FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "street",
            "SELECT s.STUDENT_ID, s.[Email Addr] FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "email",
            # Alias hides nothing: both the column and its alias are checked.
            "SELECT s.STUDENT_ID, s.SSN AS ref_no FROM dbo.STUDENT AS s OPTION (MAXDOP 1)": "ssn",
            # Inside a CTE and a CAST.
            "WITH c AS (SELECT s.STUDENT_ID, CAST(s.DOB AS DATE) AS d FROM dbo.STUDENT AS s) "
            "SELECT c.STUDENT_ID, c.d FROM c OPTION (MAXDOP 1)": "dob",
        }
        for sql, rule in bad.items():
            with self.subTest(sql=sql[:70]):
                rules = [r.lower() for _, r in self.hits(sql)]
                self.assertIn(rule, rules)

    def test_short_tokens_are_whole_identifier_only(self):
        ok = (
            "SELECT d.STUDENT_ID, d.DISBURSEMENT_DT, d.POSTING_DATE, d.ROUTINE_FLAG, d.DOBSON_CODE "
            "FROM dbo.DISB AS d WHERE d.STATUS = 'tin' OPTION (MAXDOP 1)"
        )
        self.assertEqual(self.hits(ok), [])

    def test_where_clause_columns_are_not_select_list(self):
        sql = "SELECT s.STUDENT_ID FROM dbo.STUDENT AS s WHERE s.BIRTH_DATE IS NOT NULL OPTION (MAXDOP 1)"
        self.assertEqual(self.hits(sql), [])


class SessionTests(unittest.TestCase):
    def test_session_setup_then_verified(self):
        conn = FakeConnection()
        settings = mssql.settings_from_env(PREFIX, ENV)
        mssql.MssqlReader(settings, app_name=APP_NAME, connect=lambda s: conn).open()
        sent = [sql for sql, _ in conn.executed]
        self.assertEqual(sent[:3], list(mssql.SESSION_SETUP_STATEMENTS))
        self.assertEqual(sent[3], mssql.SESSION_CHECK)

    def test_fails_closed_when_session_settings_not_applied(self):
        conn = FakeConnection(session_row=(2, -1, 0))
        with mock.patch.object(mssql, "publish_dataset") as pub, mock.patch.object(mssql, "put_json") as put:
            with self.assertRaises(mssql.SessionSetupError):
                run(conn)
        self.assertTrue(conn.closed)
        pub.assert_not_called()
        put.assert_not_called()

    def test_app_name_passed_to_driver(self):
        captured = {}

        class FakePytds:
            class tls:  # noqa: N801 - stands in for the pytds.tls module
                @staticmethod
                def create_context(cafile):
                    return None

            @staticmethod
            def connect(**kwargs):
                captured.update(kwargs)
                return FakeConnection()

        env = {**ENV, f"{UPPER}_QUERY_TIMEOUT_SECONDS": "120"}
        settings = mssql.settings_from_env(PREFIX, env, query_timeout_env=f"{UPPER}_QUERY_TIMEOUT_SECONDS")
        with mock.patch.dict("sys.modules", {"pytds": FakePytds}):
            mssql.MssqlReader(settings, app_name=handler.APP_NAME).open()
        self.assertEqual(handler.APP_NAME, APP_NAME)
        self.assertEqual(captured["appname"], APP_NAME)
        self.assertEqual(captured["timeout"], 120)
        self.assertTrue(captured["autocommit"])


class HandlerTests(unittest.TestCase):
    def test_happy_path_publishes_encrypted_without_catalog(self):
        conn = FakeConnection()
        with mock.patch.object(queries, "DATASETS", FAKE_DATASETS), mock.patch.object(
            mssql, "publish_dataset", side_effect=_fake_publish
        ) as pub, mock.patch.object(mssql, "put_json") as put:
            result = run(conn)
        self.assertTrue(result["ok"])
        self.assertEqual([c.kwargs["dataset"] for c in pub.call_args_list], ["fake_reference", "fake_windowed"])
        for c in pub.call_args_list:
            self.assertEqual(c.kwargs["source"], SOURCE)
            self.assertEqual(c.kwargs["kms_key_id"], KMS_KEY)
            self.assertIs(c.kwargs["refresh_catalog"], False)
        by_sql = {sql: params for sql, params in conn.executed}
        self.assertEqual(by_sql[FAKE_DATASETS[1][1]], {"min_year": "2019"})
        self.assertIsNone(by_sql[FAKE_DATASETS[0][1]])
        keys = [c.args[0] for c in put.call_args_list]
        self.assertEqual(keys, [f"sources/{SOURCE}/_runs/dt={datetime.now(timezone.utc).date().isoformat()}/manifest.json", f"sources/{SOURCE}/_runs/latest.json"])
        for c in put.call_args_list:
            self.assertEqual(c.kwargs["kms_key_id"], KMS_KEY)
        self.assertTrue(put.call_args_list[-1].args[1]["ok"])
        self.assertTrue(conn.closed)

    def test_real_datasets_run_with_publish_patched(self):
        conn = FakeConnection()
        with mock.patch.object(mssql, "publish_dataset", side_effect=_fake_publish) as pub, mock.patch.object(mssql, "put_json"):
            result = run(conn)
        self.assertTrue(result["ok"])
        self.assertEqual(pub.call_count, len(queries.DATASETS))

    def test_daytime_skip(self):
        connects = []
        with mock.patch.object(mssql, "publish_dataset") as pub, mock.patch.object(mssql, "put_json") as put:
            result = run(FakeConnection(), now=NOON, connects=connects)
        self.assertEqual(result["skipped"], "daytime-window")
        self.assertEqual(connects, [])
        pub.assert_not_called()
        put.assert_not_called()

    def test_daytime_override(self):
        with mock.patch.object(mssql, "publish_dataset", side_effect=_fake_publish), mock.patch.object(mssql, "put_json"):
            result = run(FakeConnection(), now=NOON, env={f"{UPPER}_ALLOW_DAYTIME": "1"})
        self.assertTrue(result["ok"])

    def test_dry_run_writes_nothing(self):
        conn = FakeConnection()
        with mock.patch.object(queries, "DATASETS", FAKE_DATASETS), mock.patch.object(
            mssql, "publish_dataset"
        ) as pub, mock.patch.object(mssql, "put_json") as put, mock.patch("common.s3util.s3") as s3:
            result = run(conn, env={f"{UPPER}_DRY_RUN": "1"})
        pub.assert_not_called()
        put.assert_not_called()
        s3.assert_not_called()
        self.assertTrue(result["dry_run"])
        sent = [sql for sql, _ in conn.executed if sql not in mssql.SESSION_SETUP_STATEMENTS]
        self.assertEqual(sent, [mssql.SESSION_CHECK, mssql.ENCRYPTION_CHECK, mssql.VERSION_CHECK])
        self.assertTrue(conn.closed)

    def test_missing_kms_key_refuses_before_connect(self):
        for value in (None, "", "   "):
            env = {k: v for k, v in ENV.items() if k != f"{PREFIX}_KMS_KEY_ID"}
            if value is not None:
                env[f"{PREFIX}_KMS_KEY_ID"] = value
            with self.subTest(value=value), mock.patch.object(mssql, "publish_dataset") as pub, mock.patch.object(
                mssql, "put_json"
            ) as put:
                with self.assertRaises(RuntimeError) as ctx:
                    handler.handler(
                        {}, None, env=env, connect=lambda s: self.fail("connected"), now_utc=NIGHT, watchdog_factory=NoopWatchdog
                    )
                self.assertIn(f"{PREFIX}_KMS_KEY_ID", str(ctx.exception))
                pub.assert_not_called()
                put.assert_not_called()

    def test_missing_credentials_fail_before_connect(self):
        env = {k: v for k, v in ENV.items() if k != f"{PREFIX}_PASSWORD"}
        with self.assertRaises(RuntimeError) as ctx:
            handler.handler({}, None, env=env, connect=lambda s: self.fail("connected"), now_utc=NIGHT, watchdog_factory=NoopWatchdog)
        self.assertIn(f"{PREFIX}_PASSWORD", str(ctx.exception))
        self.assertNotIn("fake-password-value", str(ctx.exception))


class DispatcherTests(unittest.TestCase):
    def test_registered_in_worker_entrypoint(self):
        src = (pathlib.Path(__file__).resolve().parents[3] / "docker" / "worker-entrypoint.py").read_text(encoding="utf-8")
        self.assertIn(f'"{SOURCE}": "services.publishers.{SOURCE}.handler"', src)


class CampusIdMaskTests(unittest.TestCase):
    """alternate_id can hold an SSN in PowerFAIDS; only P + 9 digit IDs may leave."""

    def test_students_query_masks_non_campus_ids(self) -> None:
        sql = queries.STUDENTS
        self.assertIn("CASE WHEN s.alternate_id LIKE 'P[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'", sql)
        self.assertIn("THEN s.alternate_id END AS campus_id", sql)
        self.assertNotRegex(sql, r"s\.alternate_id\s*,")
        self.assertNotIn("%", sql.replace("%(min_date)s", ""))


if __name__ == "__main__":
    unittest.main()

