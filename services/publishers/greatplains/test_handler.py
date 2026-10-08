"""Great Plains publisher safety tests. Fake connection only; no database, no S3.

Run from the repo root:
  PYTHONPATH=services/publishers python -m unittest discover -s services/publishers/greatplains -t services/publishers/greatplains
"""
from __future__ import annotations

import json
import pathlib
import re
import tempfile
import types
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest import mock

import athletics_finance
import handler
import queries
from common import mssql

SOURCE = "greatplains"
UPPER = "GREATPLAINS"
PREFIX = "GP"
APP_NAME = "amu-reporting-worker-greatplains"
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
        for needle, (columns, rows) in self.conn.custom.items():
            if needle in sql:
                self.description = [(c,) for c in columns]
                self._rows = [tuple(r.get(c) for c in columns) for r in rows]
                return
        if "sys.dm_exec_sessions" in sql:
            self.description = [("transaction_isolation_level",), ("lock_timeout",), ("deadlock_priority",)]
            self._rows = [self.conn.session_row]
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
    def __init__(self, *, fail_on=None, session_row=(1, 5000, -5), rows_per_query=3, custom=None):
        self.executed: list[tuple] = []
        self.fail_on = fail_on or {}
        self.custom = custom or {}
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
            "SELECT v.VENDORID, v.TXIDNMBR FROM dbo.PM00200 AS v OPTION (MAXDOP 1)": "TXIDNMBR",
            "SELECT v.VENDORID, v.VendorTaxId FROM dbo.FAKE_VENDOR AS v OPTION (MAXDOP 1)": "TAXID",
            "SELECT e.VENDORID, e.EFTBankAcct FROM dbo.SY06000 AS e OPTION (MAXDOP 1)": "EFT",
            "SELECT e.VENDORID, e.BANKNAME FROM dbo.SY06000 AS e OPTION (MAXDOP 1)": "BANK",
            "SELECT e.EMPLOYID, e.SSN FROM dbo.FAKE_EMP AS e OPTION (MAXDOP 1)": "SSN",
            "SELECT v.VENDORID, v.VNDACCTNUM FROM dbo.FAKE_VENDOR AS v OPTION (MAXDOP 1)": "ACCTNUM",
            "SELECT v.VENDORID, v.TXRGNNUM FROM dbo.PM00200 AS v OPTION (MAXDOP 1)": "TXRGNNUM",
            # Alias hides nothing: both the column and its alias are checked.
            "SELECT v.VENDORID, v.TXIDNMBR AS ref_no FROM dbo.PM00200 AS v OPTION (MAXDOP 1)": "TXIDNMBR",
            # Inside a CTE, lowercase.
            "WITH c AS (SELECT v.vendorid, v.txrgnnum AS r FROM dbo.PM00200 AS v) "
            "SELECT c.vendorid, c.r FROM c OPTION (MAXDOP 1)": "TXRGNNUM",
        }
        for sql, rule in bad.items():
            with self.subTest(sql=sql[:70]):
                rules = [r.upper() for _, r in self.hits(sql)]
                self.assertIn(rule, rules)

    def test_gl_account_columns_are_allowed(self):
        ok = (
            "SELECT g.ACTINDX, g.ACTNUMST, g.ACTNUMBR_1, g.ACTDESCR, g.PERDBLNC "
            "FROM dbo.GL00105 AS g OPTION (MAXDOP 1)"
        )
        self.assertEqual(self.hits(ok), [])

    def test_where_clause_columns_are_not_select_list(self):
        sql = "SELECT v.VENDORID FROM dbo.PM00200 AS v WHERE v.TXIDNMBR IS NOT NULL OPTION (MAXDOP 1)"
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
        self.assertEqual(sent, [mssql.SESSION_CHECK, mssql.VERSION_CHECK])
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


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
ATHLETICS_KMS_KEY = "arn:aws:kms:us-east-2:000000000000:key/11111111-1111-1111-1111-111111111111"
ATHLETICS_ENV = {handler.ATHLETICS_FINANCE_KMS_ENV: ATHLETICS_KMS_KEY}
ATHLETICS_LABEL = "athletics-finance/balances"
ALLOWED_GP_TABLES = {"GL00100", "GL00105", "GL10110", "GL10111", "GL40200", "SY40100"}
ATHLETICS_COLUMNS = (
    "row_kind", "dept", "dept_desc", "account", "natural_account", "account_desc",
    "fiscal_year", "period", "period_start", "period_end", "debit", "credit",
)


def _sport_keys_from_ts() -> set[str]:
    src = (REPO_ROOT / "apps/web-next/src/lib/reports/athletics-coaching/sports.ts").read_text(encoding="utf-8")
    body = src.split("export const SPORTS", 1)[1].split("export const sportByKey", 1)[0]
    return set(re.findall(r'^\s{4}key: "([a-z0-9-]+)"', body, re.MULTILINE))


def _period(fy, period, start, end):
    return {"row_kind": "period", "fiscal_year": fy, "period": period,
            "period_start": datetime.fromisoformat(start), "period_end": datetime.fromisoformat(end)}


def _bal(dept, natural, fy, period, debit, credit, end="2026-07-31", desc="Dept"):
    return {
        "row_kind": "balance", "dept": dept, "dept_desc": desc, "account": f"900-{dept}-{natural}-00-00",
        "natural_account": natural, "account_desc": f"Acct {natural}", "fiscal_year": fy, "period": period,
        "period_start": None, "period_end": datetime.fromisoformat(end),
        "debit": Decimal(debit), "credit": Decimal(credit),
    }


PERIOD_ROWS = [
    _period(2027, 1, "2026-07-01", "2026-07-31"),
    _period(2027, 2, "2026-08-01", "2026-08-31"),
    _period(2027, 3, "2026-09-01", "2026-09-30"),
    _period(2027, 4, "2026-10-01", "2026-10-31"),
    _period(2026, 1, "2025-07-01", "2025-07-31"),
    _period(2026, 3, "2025-09-01", "2025-09-30"),
]


class AthleticsFinanceMapTests(unittest.TestCase):
    def test_real_map_is_valid_and_keys_are_sports(self):
        sport_keys = _sport_keys_from_ts()
        self.assertIn("football", sport_keys)
        raw = json.loads(athletics_finance.MAP_PATH.read_text(encoding="utf-8"))
        dept_map = athletics_finance.validate_department_map(raw, sport_keys)
        self.assertEqual(dept_map["6552"], ("team", "football"))
        self.assertEqual(dept_map["6117"], ("department_wide", None))
        self.assertEqual(dept_map["8214"], ("unassigned", None))
        self.assertEqual(set(raw["teams"]) - sport_keys, set())

    def test_duplicate_department_rejected(self):
        raw = {"version": 1, "teams": {"football": ["6552"]}, "department_wide": ["6552"], "unassigned": []}
        with self.assertRaisesRegex(athletics_finance.DepartmentMapError, "more than once"):
            athletics_finance.validate_department_map(raw)

    def test_unknown_sport_rejected(self):
        raw = {"version": 1, "teams": {"curling": ["1234"]}, "department_wide": [], "unassigned": []}
        with self.assertRaisesRegex(athletics_finance.DepartmentMapError, "not a known sport"):
            athletics_finance.validate_department_map(raw, {"football"})

    def test_bad_department_and_version_rejected(self):
        bad = [
            {"version": 1, "teams": {"football": ["65520"]}, "department_wide": [], "unassigned": []},
            {"version": 1, "teams": {"football": [6552]}, "department_wide": [], "unassigned": []},
            {"version": 1, "teams": {"football": ["6552' OR 1=1"]}, "department_wide": [], "unassigned": []},
            {"version": 2, "teams": {"football": ["6552"]}, "department_wide": [], "unassigned": []},
            {"version": 1, "teams": {}, "department_wide": [], "unassigned": []},
            {"version": 1, "teams": {"football": ["6552"]}, "unassigned": []},
        ]
        for raw in bad:
            with self.subTest(raw=raw), self.assertRaises(athletics_finance.DepartmentMapError):
                athletics_finance.validate_department_map(raw)

    def test_map_copied_into_worker_image_at_same_path(self):
        dockerfile = (REPO_ROOT / "Dockerfile.worker").read_text(encoding="utf-8")
        rel = str(athletics_finance.MAP_RELATIVE_PATH)
        self.assertIn(f"COPY {rel} ./{rel}", dockerfile)
        self.assertTrue(athletics_finance.MAP_PATH.is_file())


class AthleticsFinanceQueryTests(unittest.TestCase):
    def setUp(self):
        self.dept_map = athletics_finance.load_department_map()
        self.params = athletics_finance.dept_params(self.dept_map)
        self.sql = athletics_finance.build_sql(list(self.params))

    def test_not_a_raw_dataset(self):
        self.assertNotIn(self.sql, [sql for _, sql, _ in queries.DATASETS])

    def test_passes_guard(self):
        self.assertEqual(mssql.guard_select(self.sql), self.sql)
        self.assertTrue(self.sql.endswith("OPTION (MAXDOP 1)"))
        self.assertNotIn("*", self.sql)
        for m in re.finditer(r"%", self.sql):
            self.assertRegex(self.sql[m.start():], r"^%\([a-z0-9_]+\)s")

    def test_no_excluded_columns(self):
        hits = mssql.excluded_column_hits(self.sql, queries.EXCLUDED_COLUMN_SUBSTRINGS, queries.WHOLE_IDENTIFIER_TOKENS)
        self.assertEqual(hits, [])

    def test_only_granted_tables(self):
        tables = set(re.findall(r"\bdbo\.([A-Za-z0-9_]+)", self.sql))
        self.assertEqual(tables, ALLOWED_GP_TABLES)

    def test_filters_unrestricted_income_statement_actual_ledger(self):
        sql = self.sql
        self.assertIn("a.ACTNUMBR_4 = '00'", sql)
        self.assertIn("a.PSTNGTYP = 1", sql)
        self.assertIn("o.Ledger_ID = 1 AND o.PERIODID > 0", sql)
        self.assertIn("h.Ledger_ID = 1 AND h.PERIODID > 0", sql)
        self.assertIn("FROM dbo.GL10110 AS o", sql)
        self.assertIn("FROM dbo.GL10111 AS h", sql)
        self.assertIn("p.SERIES = 0", sql)

    def test_departments_are_bound_never_formatted(self):
        self.assertEqual(sorted(self.params.values()), sorted(self.dept_map))
        for dept in self.dept_map:
            self.assertNotIn(f"'{dept}'", self.sql)
        for name in self.params:
            self.assertIn(f"%({name})s", self.sql)

    def test_output_columns_are_the_contract(self):
        idents = mssql.select_list_identifiers(self.sql)
        for column in ATHLETICS_COLUMNS:
            self.assertIn(column, idents)


class AthleticsFinanceTransformTests(unittest.TestCase):
    def setUp(self):
        self.dept_map = {
            "6552": ("team", "football"),
            "6530": ("team", "mens-basketball"),
            "6117": ("department_wide", None),
            "8214": ("unassigned", None),
        }
        self.build = athletics_finance.AthleticsFinanceBuild(self.dept_map, date(2026, 9, 29))

    def test_groups_signs_and_years(self):
        rows = PERIOD_ROWS + [
            _bal("6552", "4100", 2027, 1, "10.00", "510.25"),  # team revenue
            _bal("6552", "6100", 2027, 2, "300.00", "20.00"),  # team expense
            _bal("6117", "6200", 2027, 1, "50", "0"),  # department-wide expense
            _bal("8214", "4300", 2026, 3, "0", "75.5"),  # unassigned revenue, prior FY
            _bal("9999", "4100", 2027, 1, "0", "1000"),  # not in the map: dropped
            _bal("6552", "4100", 2025, 1, "0", "1000"),  # older FY: dropped
            _bal("6552", "4100", 2027, 0, "0", "1000"),  # beginning balance: dropped
        ]
        out = self.build.transform(rows)
        self.assertEqual(len(out), 4)
        by = {(r["dept"], r["account"]): r for r in out}
        rev = by[("6552", "900-6552-4100-00-00")]
        self.assertEqual((rev["group"], rev["sport_key"], rev["category"], rev["amount"]), ("team", "football", "revenue", "500.25"))
        exp = by[("6552", "900-6552-6100-00-00")]
        self.assertEqual((exp["category"], exp["amount"]), ("expense", "280.00"))
        dw = by[("6117", "900-6117-6200-00-00")]
        self.assertEqual((dw["group"], dw["sport_key"], dw["amount"]), ("department_wide", None, "50.00"))
        un = by[("8214", "900-8214-4300-00-00")]
        self.assertEqual(
            (un["group"], un["sport_key"], un["category"], un["amount"], un["fiscal_year"]),
            ("unassigned", None, "revenue", "75.50", 2026),
        )
        self.assertEqual(rev["period_end"], "2026-07-31")
        self.assertEqual(
            set(rev),
            {"group", "sport_key", "dept", "dept_desc", "account", "account_desc", "category",
             "fiscal_year", "period", "period_end", "debit", "credit", "amount"},
        )
        self.assertEqual(json.loads(json.dumps(out)), out)

    def test_meta_from_period_calendar(self):
        self.build.transform(PERIOD_ROWS)
        key, meta = self.build.sidecar(
            PERIOD_ROWS, {"pulled_at": "2026-09-29T07:31:00+00:00", "dt": "2026-09-29", "record_count": 0}
        )
        self.assertEqual(key, "sources/athletics-finance/meta.json")
        self.assertEqual((meta["current_fy"], meta["prior_fy"], meta["current_period"]), (2027, 2026, 3))
        self.assertEqual(meta["as_of"], "2026-09-29T07:31:00+00:00")
        self.assertEqual(meta["as_of_date"], "2026-09-29")
        self.assertEqual(meta["periods"][0], {"fiscal_year": 2026, "period": 1, "start": "2025-07-01", "end": "2025-07-31"})
        json.dumps(meta)

    def test_no_period_containing_today_fails(self):
        build = athletics_finance.AthleticsFinanceBuild(self.dept_map, date(2030, 1, 1))
        with self.assertRaisesRegex(ValueError, "no fiscal period"):
            build.transform(PERIOD_ROWS)


class AthleticsFinanceHandlerTests(unittest.TestCase):
    def athletics_conn(self, rows=None):
        rows = PERIOD_ROWS + [_bal("6552", "4100", 2027, 1, "0", "100")] if rows is None else rows
        return FakeConnection(custom={"row_kind": (ATHLETICS_COLUMNS, rows)})

    def run_with(self, conn, env):
        with mock.patch.object(queries, "DATASETS", FAKE_DATASETS), mock.patch.object(
            mssql, "publish_dataset", side_effect=_fake_publish
        ) as pub, mock.patch.object(mssql, "put_json") as put:
            result = run(conn, env=env)
        manifest = [c for c in put.call_args_list if c.args[0].endswith("_runs/latest.json")][0].args[1]
        return result, pub, put, manifest

    def test_published_with_own_key_and_meta(self):
        conn = self.athletics_conn()
        result, pub, put, manifest = self.run_with(conn, ATHLETICS_ENV)
        self.assertTrue(result["ok"])
        calls = pub.call_args_list
        self.assertEqual([c.kwargs["dataset"] for c in calls], ["fake_reference", "fake_windowed", "balances"])
        fin = calls[-1].kwargs
        self.assertEqual(fin["source"], "athletics-finance")
        self.assertEqual(fin["kms_key_id"], ATHLETICS_KMS_KEY)
        self.assertIs(fin["refresh_catalog"], False)
        self.assertEqual(len(fin["rows"]), 1)
        self.assertEqual(fin["rows"][0]["sport_key"], "football")
        for c in calls[:-1]:
            self.assertEqual(c.kwargs["kms_key_id"], KMS_KEY)
        meta_calls = [c for c in put.call_args_list if c.args[0] == athletics_finance.META_KEY]
        self.assertEqual(len(meta_calls), 1)
        self.assertEqual(meta_calls[0].kwargs["kms_key_id"], ATHLETICS_KMS_KEY)
        self.assertEqual(meta_calls[0].args[1]["current_fy"], 2027)
        for c in put.call_args_list:
            if c.args[0].startswith("sources/greatplains/"):
                self.assertEqual(c.kwargs["kms_key_id"], KMS_KEY)
        self.assertEqual(manifest["derived_failed"], [])
        self.assertEqual(manifest["derived"][0]["sidecar"], athletics_finance.META_KEY)
        fin_sql, bound = [(sql, params) for sql, params in conn.executed if "row_kind" in sql][0]
        self.assertEqual(bound[athletics_finance.TODAY_PARAM], date(2026, 9, 29))
        self.assertIn("6552", bound.values())
        self.assertIn("8214", bound.values())
        self.assertEqual(mssql.guard_select(fin_sql), fin_sql)

    def test_missing_kms_env_fails_derived_but_raw_ok(self):
        for value in (None, "", "  "):
            env = {} if value is None else {handler.ATHLETICS_FINANCE_KMS_ENV: value}
            with self.subTest(value=value):
                conn = self.athletics_conn()
                result, pub, put, manifest = self.run_with(conn, env)
                self.assertTrue(result["ok"])
                self.assertEqual([c.kwargs["dataset"] for c in pub.call_args_list], ["fake_reference", "fake_windowed"])
                self.assertTrue(manifest["ok"])
                self.assertEqual(manifest["failed"], [])
                self.assertEqual(manifest["derived_failed"], [ATHLETICS_LABEL])
                self.assertIn(handler.ATHLETICS_FINANCE_KMS_ENV, manifest["derived"][0]["error"])
                self.assertFalse(any("row_kind" in sql for sql, _ in conn.executed))
                self.assertFalse(any(c.args[0] == athletics_finance.META_KEY for c in put.call_args_list))

    def test_missing_map_fails_derived_but_raw_ok(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(
            athletics_finance, "MAP_PATH", pathlib.Path(tmp) / "missing.json"
        ):
            result, pub, _put, manifest = self.run_with(self.athletics_conn(), ATHLETICS_ENV)
        self.assertTrue(result["ok"])
        self.assertEqual(len(pub.call_args_list), 2)
        self.assertEqual(manifest["derived_failed"], [ATHLETICS_LABEL])
        self.assertIn("department map", manifest["derived"][0]["error"])

    def test_transform_failure_recorded_without_failing_raw(self):
        conn = self.athletics_conn(rows=[])  # no period calendar, so transform raises
        result, pub, put, manifest = self.run_with(conn, ATHLETICS_ENV)
        self.assertTrue(result["ok"])
        self.assertEqual(len(pub.call_args_list), 2)
        self.assertEqual(manifest["derived_failed"], [ATHLETICS_LABEL])
        self.assertIn("no fiscal period", manifest["derived"][0]["error"])
        self.assertFalse(any(c.args[0] == athletics_finance.META_KEY for c in put.call_args_list))

    def test_skipped_when_a_raw_dataset_fails(self):
        conn = FakeConnection(
            fail_on={"FAKE_WIN": RuntimeError("boom")}, custom={"row_kind": (ATHLETICS_COLUMNS, PERIOD_ROWS)}
        )
        with mock.patch.object(queries, "DATASETS", FAKE_DATASETS), mock.patch.object(
            mssql, "publish_dataset", side_effect=_fake_publish
        ) as pub, mock.patch.object(mssql, "put_json"):
            with self.assertRaises(mssql.PartialFailure):
                run(conn, env=ATHLETICS_ENV)
        self.assertNotIn("athletics-finance", [c.kwargs["source"] for c in pub.call_args_list])

    def test_dry_run_does_not_query_extract(self):
        conn = self.athletics_conn()
        with mock.patch.object(mssql, "publish_dataset") as pub, mock.patch.object(mssql, "put_json") as put:
            run(conn, env={**ATHLETICS_ENV, f"{UPPER}_DRY_RUN": "1"})
        pub.assert_not_called()
        put.assert_not_called()
        self.assertFalse(any("row_kind" in sql for sql, _ in conn.executed))

    def test_local_today_uses_new_york(self):
        # 03:30 UTC on Oct 1 is still Sep 30 in New York.
        self.assertEqual(handler.local_today(datetime(2026, 10, 1, 3, 30, tzinfo=timezone.utc)), date(2026, 9, 30))


class DispatcherTests(unittest.TestCase):
    def test_registered_in_worker_entrypoint(self):
        src = (pathlib.Path(__file__).resolve().parents[3] / "docker" / "worker-entrypoint.py").read_text(encoding="utf-8")
        self.assertIn(f'"{SOURCE}": "services.publishers.{SOURCE}.handler"', src)


if __name__ == "__main__":
    unittest.main()
