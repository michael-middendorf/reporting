"""PowerCampus publisher safety tests. Fake connection only; no database, no S3.

Run from the repo root:
  PYTHONPATH=services/publishers python -m unittest discover -s services/publishers/powercampus -t services/publishers/powercampus
"""
from __future__ import annotations

import re
import unittest
from datetime import date, datetime, timezone
from unittest import mock

import db
import handler
import queries

ENV = {
    "PC_HOST": "pc.example.invalid",
    "PC_PORT": "1433",
    "PC_DATABASE": "University_AMU",
    "PC_USERNAME": "fake_user",
    "PC_PASSWORD": "fake-password-value",
    "DATA_BUCKET": "fake-bucket",
}
# 2026-09-29 07:30 UTC = 03:30 America/New_York (EDT): inside the allowed window.
NIGHT = datetime(2026, 9, 29, 7, 30, tzinfo=timezone.utc)
# 2026-09-29 16:00 UTC = 12:00 America/New_York: business hours.
NOON = datetime(2026, 9, 29, 16, 0, tzinfo=timezone.utc)


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
        if sql is queries.SESSION_CHECK or "sys.dm_exec_sessions" in sql:
            self.description = [("transaction_isolation_level",), ("lock_timeout",), ("deadlock_priority",)]
            self._rows = [self.conn.session_row]
        elif sql.startswith("SET "):
            self.description = None
            self._rows = []
        elif "@@VERSION" in sql:
            self.description = [("server_version",), ("database_name",)]
            self._rows = [("Microsoft SQL Server 2016 (SP3)\nEnterprise", "University_AMU")]
        elif "COUNT(" in sql:
            self.description = [("row_count",)]
            self._rows = [(1234,)]
        else:
            self.description = [("COL_A",), ("COL_B",)]
            self._rows = [(i, f"v{i}") for i in range(self.conn.rows_per_query)]

    def fetchmany(self, size):
        self.conn.fetch_sizes.append(size)
        batch, self._rows = self._rows[:size], self._rows[size:]
        return batch

    def fetchall(self):  # pragma: no cover - must never be used
        raise AssertionError("fetchall must not be used; stream with fetchmany")

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

    # Explicit transactions must never be used.
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
    settings_seen = []

    def connect(settings):
        settings_seen.append(settings)
        if connects is not None:
            connects.append(settings)
        return conn

    return handler.handler(
        {},
        None,
        env={**ENV, **(env or {})},
        connect=connect,
        now_utc=now,
        watchdog_factory=NoopWatchdog,
    )


class GuardTests(unittest.TestCase):
    def test_accepts_every_statement_in_queries(self):
        self.assertGreater(len(queries.ALL_STATEMENTS), 25)
        for sql in queries.ALL_STATEMENTS:
            with self.subTest(sql=sql[:60]):
                self.assertEqual(db.guard_select(sql), sql)

    def test_every_query_ends_with_maxdop_1(self):
        for sql in queries.ALL_STATEMENTS:
            with self.subTest(sql=sql[:60]):
                self.assertRegex(sql, r"OPTION \(MAXDOP 1\)$")

    def test_no_star_and_no_string_formatted_values(self):
        for sql in queries.ALL_STATEMENTS:
            with self.subTest(sql=sql[:60]):
                self.assertNotIn("*", sql)
                # Only pyformat bound parameters may carry values.
                for m in re.finditer(r"%", sql):
                    self.assertRegex(sql[m.start():], r"^%\([a-z_]+\)s")

    def test_rejects_forbidden_keywords(self):
        bad = [
            "INSERT INTO dbo.PEOPLE (PEOPLE_ID) VALUES ('x') OPTION (MAXDOP 1)",
            "UPDATE dbo.PEOPLE SET FIRST_NAME = 'x' OPTION (MAXDOP 1)",
            "DELETE FROM dbo.PEOPLE OPTION (MAXDOP 1)",
            "MERGE dbo.PEOPLE AS t USING dbo.X AS s ON 1 = 1 OPTION (MAXDOP 1)",
            "EXEC sp_who OPTION (MAXDOP 1)",
            "EXECUTE sp_who OPTION (MAXDOP 1)",
            "DROP TABLE dbo.PEOPLE",
            "ALTER TABLE dbo.PEOPLE ADD X int",
            "CREATE TABLE dbo.X (A int)",
            "TRUNCATE TABLE dbo.PEOPLE",
            "GRANT SELECT ON dbo.PEOPLE TO public",
            "REVOKE SELECT ON dbo.PEOPLE TO public",
            "DENY SELECT ON dbo.PEOPLE TO public",
            "BACKUP DATABASE University_AMU TO DISK = 'x'",
            "RESTORE DATABASE University_AMU FROM DISK = 'x'",
            "DBCC CHECKDB",
            "SHUTDOWN",
            "KILL 55",
        ]
        for sql in bad:
            with self.subTest(sql=sql):
                with self.assertRaises(db.UnsafeQueryError):
                    db.guard_select(sql)

    def test_rejects_keywords_hidden_inside_a_select(self):
        bad = [
            "SELECT p.PEOPLE_ID INTO dbo.X FROM dbo.PEOPLE AS p OPTION (MAXDOP 1)",
            "select p.PEOPLE_ID from dbo.PEOPLE as p where 1 = 1 and exists (select 1) delete from dbo.PEOPLE option (maxdop 1)",
            "SELECT a.X FROM OPENROWSET('SQLNCLI', 'x', 'y') AS a OPTION (MAXDOP 1)",
            "SELECT a.X FROM OPENQUERY(LNK, 'y') AS a OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a WHERE a.Y = xp_cmdshell OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a WHERE a.Y = sp_executesql OPTION (MAXDOP 1)",
            "WITH c AS (SELECT a.X FROM dbo.T AS a) Update dbo.T SET X = 1 OPTION (MAXDOP 1)",
        ]
        for sql in bad:
            with self.subTest(sql=sql):
                with self.assertRaises(db.UnsafeQueryError):
                    db.guard_select(sql)

    def test_keyword_match_is_whole_word(self):
        # dm_exec_sessions and UPDATED_AT-like names must not trip EXEC/UPDATE.
        db.guard_select("SELECT s.session_id FROM sys.dm_exec_sessions AS s OPTION (MAXDOP 1)")
        db.guard_select("SELECT t.LAST_UPDATED FROM dbo.T AS t OPTION (MAXDOP 1)")

    def test_rejects_multiple_statements(self):
        for sql in (
            "SELECT a.X FROM dbo.T AS a; SELECT b.Y FROM dbo.U AS b OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a OPTION (MAXDOP 1);;",
            "SELECT a.X FROM dbo.T AS a OPTION (MAXDOP 1); DROP TABLE dbo.T",
        ):
            with self.subTest(sql=sql):
                with self.assertRaises(db.UnsafeQueryError):
                    db.guard_select(sql)
        # A single trailing semicolon (and whitespace) is tolerated.
        db.guard_select("SELECT a.X FROM dbo.T AS a OPTION (MAXDOP 1);  \n")

    def test_rejects_select_star_and_count_star(self):
        for sql in (
            "SELECT * FROM dbo.PEOPLE OPTION (MAXDOP 1)",
            "select   *   from dbo.PEOPLE option (maxdop 1)",
            "SELECT TOP 10 * FROM dbo.PEOPLE OPTION (MAXDOP 1)",
            "SELECT DISTINCT * FROM dbo.PEOPLE OPTION (MAXDOP 1)",
            "SELECT p.* FROM dbo.PEOPLE AS p OPTION (MAXDOP 1)",
            "SELECT COUNT(*) FROM dbo.ACADEMIC OPTION (MAXDOP 1)",
            "SELECT count( * ) AS n FROM dbo.ACADEMIC OPTION (MAXDOP 1)",
            "SELECT COUNT_BIG(*) FROM dbo.ACADEMIC OPTION (MAXDOP 1)",
        ):
            with self.subTest(sql=sql):
                with self.assertRaises(db.UnsafeQueryError):
                    db.guard_select(sql)

    def test_rejects_non_select_and_comments_and_missing_maxdop(self):
        for sql in (
            "",
            "   ",
            "SET LOCK_TIMEOUT 0",
            "SELECT a.X FROM dbo.T AS a",
            "SELECT a.X FROM dbo.T AS a -- OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a /* x */ OPTION (MAXDOP 1)",
            "SELECT a.X FROM dbo.T AS a OPTION (MAXDOP 4)",
        ):
            with self.subTest(sql=sql):
                with self.assertRaises(db.UnsafeQueryError):
                    db.guard_select(sql)

    def test_reader_refuses_unsafe_sql_before_sending(self):
        conn = FakeConnection()
        reader = db.PowerCampusReader(db.settings_from_env(ENV), connect=lambda s: conn).open()
        sent_before = len(conn.executed)
        with self.assertRaises(db.UnsafeQueryError):
            reader.fetch_all("DELETE FROM dbo.PEOPLE OPTION (MAXDOP 1)")
        self.assertEqual(len(conn.executed), sent_before)


class SessionTests(unittest.TestCase):
    def test_session_setup_issued_first_then_verified(self):
        conn = FakeConnection()
        db.PowerCampusReader(db.settings_from_env(ENV), connect=lambda s: conn).open()
        sent = [sql for sql, _ in conn.executed]
        self.assertEqual(
            sent[:3],
            [
                "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
                "SET LOCK_TIMEOUT 5000",
                "SET DEADLOCK_PRIORITY LOW",
            ],
        )
        self.assertEqual(sent[3], queries.SESSION_CHECK)

    def test_fails_closed_when_session_settings_not_applied(self):
        conn = FakeConnection(session_row=(2, -1, 0))  # READ COMMITTED, wait forever, NORMAL
        reader = db.PowerCampusReader(db.settings_from_env(ENV), connect=lambda s: conn)
        with self.assertRaises(db.SessionSetupError):
            reader.open()
        self.assertTrue(conn.closed)
        self.assertFalse(reader.is_open)

    def test_every_sent_non_set_statement_passed_guard_and_has_maxdop(self):
        conn = FakeConnection()
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish), mock.patch.object(handler, "put_json"):
            run(conn)
        for sql, _ in conn.executed:
            if sql in db.SESSION_SETUP_STATEMENTS:
                continue
            db.guard_select(sql)
            self.assertTrue(sql.rstrip().endswith("OPTION (MAXDOP 1)"), sql)

    def test_streams_with_fetchmany(self):
        conn = FakeConnection(rows_per_query=12)
        reader = db.PowerCampusReader(db.settings_from_env(ENV), connect=lambda s: conn, batch_size=5).open()
        rows = reader.fetch_all(queries.ACADEMIC_CALENDAR)
        self.assertEqual(len(rows), 12)
        self.assertEqual(rows[0], {"COL_A": 0, "COL_B": "v0"})
        self.assertIn(5, conn.fetch_sizes)

    def test_connect_arguments(self):
        captured = {}

        class FakePytds:
            @staticmethod
            def connect(**kwargs):
                captured.update(kwargs)
                return FakeConnection()

        with mock.patch.dict("sys.modules", {"pytds": FakePytds}):
            db._pytds_connect(db.settings_from_env({**ENV, "POWERCAMPUS_QUERY_TIMEOUT_SECONDS": "120"}))
        self.assertEqual(captured["appname"], "amu-reporting-worker-powercampus")
        self.assertTrue(captured["autocommit"])
        self.assertEqual(captured["login_timeout"], 15)
        self.assertEqual(captured["timeout"], 120)
        self.assertEqual(captured["port"], 1433)
        self.assertFalse(captured["use_mars"])

    def test_default_query_timeout_is_300(self):
        self.assertEqual(db.settings_from_env(ENV).query_timeout, 300)

    def test_settings_repr_hides_credentials(self):
        s = db.settings_from_env(ENV)
        self.assertNotIn("fake-password-value", repr(s))
        self.assertNotIn("fake_user", str(s))
        self.assertEqual(s.redact("Login failed for user 'fake_user' pw fake-password-value"), "Login failed for user '***' pw ***")


def _fake_publish(**kwargs):
    return {
        "source": kwargs["source"],
        "dataset": kwargs["dataset"],
        "record_count": len(kwargs["rows"]),
        "prefix": f"sources/{kwargs['source']}/{kwargs['dataset']}/dt=2026-09-29",
    }


class HandlerTests(unittest.TestCase):
    def test_refuses_during_business_hours(self):
        connects = []
        with mock.patch.object(handler, "publish_dataset") as pub, mock.patch.object(handler, "put_json") as put:
            result = run(FakeConnection(), now=NOON, connects=connects)
        self.assertEqual(result["skipped"], "daytime-window")
        self.assertEqual(connects, [])
        pub.assert_not_called()
        put.assert_not_called()

    def test_blocked_window_edges(self):
        # EDT (UTC-4): 11:00 UTC = 07:00 local (blocked), 10:59 = 06:59 (allowed),
        # 02:00 UTC next day = 22:00 local (allowed), 01:59 = 21:59 (blocked).
        self.assertTrue(handler.is_blocked_hour(datetime(2026, 9, 29, 11, 0, tzinfo=timezone.utc)))
        self.assertFalse(handler.is_blocked_hour(datetime(2026, 9, 29, 10, 59, tzinfo=timezone.utc)))
        self.assertFalse(handler.is_blocked_hour(datetime(2026, 9, 30, 2, 0, tzinfo=timezone.utc)))
        self.assertTrue(handler.is_blocked_hour(datetime(2026, 9, 30, 1, 59, tzinfo=timezone.utc)))
        # The 07:30 UTC schedule is allowed in both EDT and EST.
        self.assertFalse(handler.is_blocked_hour(datetime(2026, 7, 1, 7, 30, tzinfo=timezone.utc)))
        self.assertFalse(handler.is_blocked_hour(datetime(2026, 1, 15, 7, 30, tzinfo=timezone.utc)))

    def test_daytime_override(self):
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish), mock.patch.object(handler, "put_json"):
            result = run(FakeConnection(), now=NOON, env={"POWERCAMPUS_ALLOW_DAYTIME": "1"})
        self.assertTrue(result["ok"])

    def test_dry_run_writes_nothing(self):
        conn = FakeConnection()
        with mock.patch.object(handler, "publish_dataset") as pub, mock.patch.object(handler, "put_json") as put, mock.patch("common.s3util.s3") as s3:
            result = run(conn, env={"POWERCAMPUS_DRY_RUN": "1"})
        pub.assert_not_called()
        put.assert_not_called()
        s3.assert_not_called()
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["academic_rows_current_year"], 1234)
        data_sql = [sql for sql, _ in conn.executed if sql not in db.SESSION_SETUP_STATEMENTS]
        self.assertEqual(data_sql, [queries.SESSION_CHECK, queries.VERSION_CHECK, queries.DRY_RUN_ACADEMIC_COUNT])
        self.assertEqual(conn.executed[-1][1], {"year": "2026"})
        self.assertTrue(conn.closed)

    def test_publishes_all_datasets_with_bound_params(self):
        conn = FakeConnection()
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish) as pub, mock.patch.object(handler, "put_json") as put:
            result = run(conn)
        self.assertTrue(result["ok"])
        published = [c.kwargs["dataset"] for c in pub.call_args_list]
        self.assertEqual(published, [d for d, _, _ in queries.DATASETS])
        self.assertTrue(all(c.kwargs["source"] == "powercampus" for c in pub.call_args_list))
        by_sql = {sql: params for sql, params in conn.executed}
        self.assertEqual(by_sql[queries.ACADEMIC], {"min_year": "2019"})
        self.assertEqual(by_sql[queries.TRANSCRIPTDEGREE], {"min_graduation_date": date(2018, 9, 29)})
        self.assertIsNone(by_sql[queries.ACADEMIC_CALENDAR])
        keys = [c.args[0] for c in put.call_args_list]
        self.assertEqual(keys, ["sources/powercampus/_runs/dt=2026-09-29/manifest.json", "sources/powercampus/_runs/latest.json"])
        self.assertTrue(conn.closed)

    def test_years_back_env(self):
        conn = FakeConnection()
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish), mock.patch.object(handler, "put_json"):
            run(conn, env={"POWERCAMPUS_YEARS_BACK": "3"})
        by_sql = {sql: params for sql, params in conn.executed}
        self.assertEqual(by_sql[queries.ACADEMIC], {"min_year": "2023"})

    def test_one_failing_dataset_does_not_stop_others(self):
        lock_timeout = RuntimeError("Lock request time out period exceeded. (1222)")
        conn = FakeConnection(fail_on={"FROM dbo.RESIDENCY": lock_timeout})
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish) as pub, mock.patch.object(handler, "put_json") as put:
            with self.assertRaises(handler.PartialFailure):
                run(conn)
        published = [c.kwargs["dataset"] for c in pub.call_args_list]
        expected = [d for d, _, _ in queries.DATASETS if d != "residency"]
        self.assertEqual(published, expected)
        manifest = put.call_args_list[-1].args[1]
        self.assertFalse(manifest["ok"])
        self.assertEqual(manifest["failed"], ["residency"])
        failed = next(r for r in manifest["datasets"] if r["dataset"] == "residency")
        self.assertIn("1222", failed["error"])
        self.assertIn("started_at", manifest)
        self.assertIn("finished_at", manifest)
        ok = next(r for r in manifest["datasets"] if r["dataset"] == "academic")
        self.assertEqual(ok["record_count"], 3)
        self.assertIn("duration_seconds", ok)

    def test_broken_socket_reconnects_once_and_continues(self):
        conn = FakeConnection(fail_on={"FROM dbo.DEMOGRAPHICS": TimeoutError("timed out")})
        connects = []
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish) as pub, mock.patch.object(handler, "put_json") as put:
            with self.assertRaises(handler.PartialFailure):
                run(conn, connects=connects)
        self.assertEqual(len(connects), 2)
        self.assertIn("email", [c.kwargs["dataset"] for c in pub.call_args_list])
        self.assertEqual(put.call_args_list[-1].args[1]["reconnects"], 1)

    def test_errors_are_redacted(self):
        conn = FakeConnection(fail_on={"FROM dbo.RESIDENCY": RuntimeError("Login failed for user 'fake_user'")})
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish), mock.patch.object(handler, "put_json") as put:
            with self.assertRaises(handler.PartialFailure):
                run(conn)
        manifest = put.call_args_list[-1].args[1]
        self.assertNotIn("fake_user", str(manifest))
        self.assertNotIn("fake-password-value", str(manifest))

    def test_job_hard_cap_stops_and_reports(self):
        class ExpiredWatchdog(NoopWatchdog):
            def check(self):
                raise handler.JobTimeout("hard cap reached")

        conn = FakeConnection()
        with mock.patch.object(handler, "publish_dataset", side_effect=_fake_publish) as pub, mock.patch.object(handler, "put_json") as put:
            with self.assertRaises(handler.PartialFailure):
                handler.handler({}, None, env=ENV, connect=lambda s: conn, now_utc=NIGHT, watchdog_factory=ExpiredWatchdog)
        pub.assert_not_called()
        manifest = put.call_args_list[-1].args[1]
        self.assertEqual(len(manifest["datasets"]), len(queries.DATASETS))
        self.assertTrue(all(not r["ok"] for r in manifest["datasets"]))

    def test_watchdog_fires_callback(self):
        fired = []
        wd = handler._Watchdog(0, on_expire=lambda: fired.append(True))
        wd.start()
        wd._timer.join(2)
        self.assertEqual(fired, [True])
        with self.assertRaises(handler.JobTimeout):
            wd.check()

    def test_missing_credentials_fail_before_connect(self):
        env = {k: v for k, v in ENV.items() if k != "PC_PASSWORD"}
        with self.assertRaises(RuntimeError) as ctx:
            handler.handler({}, None, env=env, connect=lambda s: self.fail("connected"), now_utc=NIGHT, watchdog_factory=NoopWatchdog)
        self.assertIn("PC_PASSWORD", str(ctx.exception))


class SportAlumniQueryTests(unittest.TestCase):
    def test_alumni_datasets_are_registered_without_a_window(self):
        by_name = {name: (sql, params) for name, sql, params in queries.DATASETS}
        self.assertEqual(by_name["athletic_alumni"], (queries.ATHLETIC_ALUMNI, ()))
        self.assertEqual(by_name["graduates"], (queries.GRADUATES, ()))
        for sql in (queries.ATHLETIC_ALUMNI, queries.GRADUATES):
            self.assertNotIn("%(", sql)
            self.assertEqual(db.guard_select(sql), sql)

    def test_every_athletic_code_is_in_the_query(self):
        self.assertEqual(len(set(queries.ATHLETIC_ASSOCIATION_CODES)), len(queries.ATHLETIC_ASSOCIATION_CODES))
        for code in queries.ATHLETIC_ASSOCIATION_CODES:
            self.assertIn(f"'{code}'", queries.ATHLETIC_ALUMNI)
        for code in ("ICFBM", "AFBALM", "ICJBBM", "CDANCE", "LACROS", "ICJRGB", "ICUFRM"):
            self.assertIn(code, queries.ATHLETIC_ASSOCIATION_CODES)

    def test_retired_codes_without_a_coaching_sport_are_excluded(self):
        # Color Guard, JV Equestrian, JV Lacrosse-Men, legacy Football Women.
        for code in ("ICCG", "ICJEQU", "ICJLCM", "AFBALW"):
            self.assertNotIn(code, queries.ATHLETIC_ASSOCIATION_CODES)
            for sql in (queries.ATHLETIC_ALUMNI, queries.GRADUATES):
                self.assertNotIn(f"'{code}'", sql)

    def test_roster_filter_and_enrollment_check(self):
        sql = queries.ATHLETIC_ALUMNI
        self.assertIn("ISNULL(LTRIM(RTRIM(s.OFFICE_HELD)), '') IN ('MEM', 'MSSPRT', 'LRMTRM', 'MNRTRN', 'LOISGN', '')", sql)
        self.assertIn("a.ENROLL_SEPARATION = 'ENRL'", sql)
        self.assertIn("a.PRIMARY_FLAG = 'Y'", sql)
        self.assertIn("a.ACADEMIC_YEAR = s.ACADEMIC_YEAR", sql)
        self.assertIn("COUNT(DISTINCT ath.ACADEMIC_YEAR) AS YEARS_COUNT", sql)
        # Term and session are trimmed and null-safe on both sides.
        self.assertIn("LTRIM(RTRIM(ISNULL(a.ACADEMIC_TERM, ''))) = LTRIM(RTRIM(ISNULL(s.ACADEMIC_TERM, '')))", sql)
        self.assertIn("LTRIM(RTRIM(ISNULL(a.ACADEMIC_SESSION, ''))) = LTRIM(RTRIM(ISNULL(s.ACADEMIC_SESSION, '')))", sql)

    def test_graduates_limited_to_people_with_an_athletic_association(self):
        sql = queries.GRADUATES
        self.assertIn("FROM dbo.ASSOCIATION AS s WHERE s.PEOPLE_ORG_CODE_ID = p.PEOPLE_CODE_ID", sql)
        for code in queries.ATHLETIC_ASSOCIATION_CODES:
            self.assertIn(f"'{code}'", sql)
        # Any OFFICE_HELD (recruits included) qualifies a graduate for the Slate join.
        self.assertNotIn("OFFICE_HELD", sql)

    def test_graduate_fields_exclude_non_degrees_deceased_and_contact_data(self):
        for sql in (queries.ATHLETIC_ALUMNI, queries.GRADUATES):
            self.assertIn("t.GRADUATION_DATE IS NOT NULL", sql)
            for code in queries.NON_DEGREE_CODES:
                self.assertIn(f"'{code}'", sql)
            self.assertIn("ISNULL(p.DECEASED_FLAG, '') <> 'Y'", sql)
            self.assertIn("e.IsActive = 1", sql)
            self.assertIn("CASE e.EmailType WHEN 'PEMA' THEN 1 WHEN 'PERM' THEN 2 WHEN 'MAIL' THEN 3", sql)
            # Never address, phone, or tables amu_reporting_ro cannot read.
            for table in ("ADDRESS", "PHONE", "ALUMNIDEGREE", "AMU_AthleticAssoc", "AMU_JVAthleticAssoc"):
                self.assertNotRegex(sql, rf"dbo\.{table}")

    def test_sql_list_rejects_unexpected_literals(self):
        with self.assertRaises(ValueError):
            queries._sql_list(("OK", "x' OR 1=1"))


class DispatcherTests(unittest.TestCase):
    def test_registered_in_worker_entrypoint(self):
        import pathlib

        src = (pathlib.Path(__file__).resolve().parents[3] / "docker" / "worker-entrypoint.py").read_text(encoding="utf-8")
        self.assertIn('"powercampus": "services.publishers.powercampus.handler"', src)


if __name__ == "__main__":
    unittest.main()
