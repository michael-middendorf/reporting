"""Athletics finance derived extract (DST-2983) for the Great Plains job.

Publishes unrestricted, income-statement GL activity for the athletic
department codes in the Business Office department map, one row per
department + account + fiscal year + period, for the current and prior fiscal
year. Written to sources/athletics-finance/balances/ under its own KMS key
(GP_ATHLETICS_FINANCE_KMS_KEY_ID) plus a small period calendar sidecar at
sources/athletics-finance/meta.json. The reporting web app reads both.

Why a narrow aggregate SELECT instead of reusing the raw gl_balances_* rows:
the raw datasets are published under the Great Plains key, which the web app
cannot (and should not) decrypt, and they hold every account in the
university. This query returns only mapped athletics departments, only
restriction '00' and posting type 1, already summed per period, so the web
app never sees anything outside the athletics scope.

The department map is a single JSON file owned by the web app
(apps/web-next/src/lib/reports/business-office/athletics-departments.json).
Dockerfile.worker copies it into the worker image at the same relative path,
so both images read the same file.
"""

from __future__ import annotations

import json
import pathlib
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

SOURCE = "athletics-finance"
DATASET = "balances"
META_KEY = f"sources/{SOURCE}/meta.json"

MAP_RELATIVE_PATH = pathlib.PurePosixPath(
    "apps/web-next/src/lib/reports/business-office/athletics-departments.json"
)
# handler.py lives at <root>/services/publishers/greatplains/, where <root> is
# the repo root locally and /app in the worker image.
MAP_PATH = pathlib.Path(__file__).resolve().parents[3].joinpath(*MAP_RELATIVE_PATH.parts)

GROUP_TEAM = "team"
GROUP_DEPARTMENT_WIDE = "department_wide"
GROUP_UNASSIGNED = "unassigned"

_DEPT_RE = re.compile(r"^[0-9]{4}$")
_SPORT_KEY_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DEPT_PARAM_PREFIX = "athletics_dept_"
TODAY_PARAM = "athletics_today"


class DepartmentMapError(ValueError):
    """The department map JSON is malformed."""


def validate_department_map(raw: Any, sport_keys: set[str] | None = None) -> dict[str, tuple[str, str | None]]:
    """Return {dept: (group, sport_key)}; raise DepartmentMapError if invalid.

    sport_keys, when given, must contain every team key (the web app checks
    this against SPORTS at load; the Python tests check it against sports.ts).
    """
    if not isinstance(raw, dict):
        raise DepartmentMapError("department map must be a JSON object")
    if raw.get("version") != 1:
        raise DepartmentMapError("department map version must be 1")
    teams = raw.get("teams")
    if not isinstance(teams, dict) or not teams:
        raise DepartmentMapError("teams must be a non-empty object")
    out: dict[str, tuple[str, str | None]] = {}

    def add(dept: Any, group: str, sport: str | None) -> None:
        if not isinstance(dept, str) or not _DEPT_RE.match(dept):
            raise DepartmentMapError(f"department {dept!r} must be a 4-digit string")
        if dept in out:
            raise DepartmentMapError(f"department {dept} appears more than once")
        out[dept] = (group, sport)

    for key, depts in teams.items():
        if not isinstance(key, str) or not _SPORT_KEY_RE.match(key):
            raise DepartmentMapError(f"team key {key!r} is not a sport key")
        if sport_keys is not None and key not in sport_keys:
            raise DepartmentMapError(f"team key {key} is not a known sport")
        if not isinstance(depts, list) or not depts:
            raise DepartmentMapError(f"team {key} must list at least one department")
        for dept in depts:
            add(dept, GROUP_TEAM, key)
    for group in (GROUP_DEPARTMENT_WIDE, GROUP_UNASSIGNED):
        depts = raw.get(group)
        if not isinstance(depts, list):
            raise DepartmentMapError(f"{group} must be a list")
        for dept in depts:
            add(dept, group, None)
    return out


def load_department_map(path: pathlib.Path | None = None) -> dict[str, tuple[str, str | None]]:
    target = path or MAP_PATH
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DepartmentMapError(f"department map not found at {target}") from exc
    except json.JSONDecodeError as exc:
        raise DepartmentMapError(f"department map is not valid JSON: {exc}") from exc
    return validate_department_map(raw)


def dept_params(dept_map: Mapping[str, tuple[str, str | None]]) -> dict[str, str]:
    """Bound parameters for the department IN list (values never formatted into SQL)."""
    return {f"{DEPT_PARAM_PREFIX}{i}": dept for i, dept in enumerate(sorted(dept_map))}


def build_sql(param_names: list[str]) -> str:
    """One guarded SELECT: balance rows for mapped depts plus the period calendar.

    Current FY = the SY40100 (SERIES 0) fiscal year whose period range contains
    athletics_today (America/New_York); prior FY = current - 1. Balances come
    from GL10110 (open years) UNION ALL GL10111 (history), actual ledger only
    (Ledger_ID 1), period 0 (beginning balance) excluded. GL00100 supplies the
    segments because GL10110 segment columns are blank.
    """
    if not param_names:
        raise DepartmentMapError("no departments to query")
    in_list = ", ".join(f"%({name})s" for name in param_names)
    return (
        "WITH fy AS ("
        "SELECT MAX(p.YEAR1) AS cur_fy FROM dbo.SY40100 AS p "
        f"WHERE p.SERIES = 0 AND p.PERIODID > 0 AND p.PERIODDT <= %({TODAY_PARAM})s "
        f"AND p.PERDENDT >= %({TODAY_PARAM})s"
        "), per AS ("
        "SELECT p.YEAR1, p.PERIODID, MIN(p.PERIODDT) AS PERIODDT, MAX(p.PERDENDT) AS PERDENDT "
        "FROM dbo.SY40100 AS p CROSS JOIN fy "
        "WHERE p.SERIES = 0 AND p.PERIODID > 0 AND p.YEAR1 IN (fy.cur_fy, fy.cur_fy - 1) "
        "GROUP BY p.YEAR1, p.PERIODID"
        "), bal AS ("
        "SELECT o.ACTINDX, o.YEAR1, o.PERIODID, o.DEBITAMT, o.CRDTAMNT FROM dbo.GL10110 AS o "
        "WHERE o.Ledger_ID = 1 AND o.PERIODID > 0 "
        "UNION ALL "
        "SELECT h.ACTINDX, h.YEAR1, h.PERIODID, h.DEBITAMT, h.CRDTAMNT FROM dbo.GL10111 AS h "
        "WHERE h.Ledger_ID = 1 AND h.PERIODID > 0"
        ") "
        "SELECT 'balance' AS row_kind, RTRIM(a.ACTNUMBR_2) AS dept, RTRIM(g.DSCRIPTN) AS dept_desc, "
        "RTRIM(s.ACTNUMST) AS account, RTRIM(a.ACTNUMBR_3) AS natural_account, "
        "RTRIM(a.ACTDESCR) AS account_desc, b.YEAR1 AS fiscal_year, b.PERIODID AS period, "
        "per.PERIODDT AS period_start, per.PERDENDT AS period_end, "
        "SUM(b.DEBITAMT) AS debit, SUM(b.CRDTAMNT) AS credit "
        "FROM bal AS b "
        "INNER JOIN per ON per.YEAR1 = b.YEAR1 AND per.PERIODID = b.PERIODID "
        "INNER JOIN dbo.GL00100 AS a ON a.ACTINDX = b.ACTINDX "
        "LEFT JOIN dbo.GL00105 AS s ON s.ACTINDX = a.ACTINDX "
        "LEFT JOIN dbo.GL40200 AS g ON g.SGMTNUMB = 2 AND g.SGMNTID = a.ACTNUMBR_2 "
        "WHERE a.ACTNUMBR_4 = '00' AND a.PSTNGTYP = 1 "
        f"AND a.ACTNUMBR_2 IN ({in_list}) "
        "GROUP BY a.ACTINDX, a.ACTNUMBR_2, g.DSCRIPTN, s.ACTNUMST, a.ACTNUMBR_3, a.ACTDESCR, "
        "b.YEAR1, b.PERIODID, per.PERIODDT, per.PERDENDT "
        "UNION ALL "
        "SELECT 'period' AS row_kind, NULL, NULL, NULL, NULL, NULL, per.YEAR1, per.PERIODID, "
        "per.PERIODDT, per.PERDENDT, NULL, NULL "
        "FROM per "
        "OPTION (MAXDOP 1)"
    )


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    return date.fromisoformat(text[:10])


def _as_decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"not a number: {value!r}") from exc


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


class AthleticsFinanceBuild:
    """transform + sidecar hooks for the DerivedDataset (one per run)."""

    def __init__(self, dept_map: Mapping[str, tuple[str, str | None]], today: date) -> None:
        self.dept_map = dict(dept_map)
        self.today = today
        self.meta: dict[str, Any] | None = None

    def _calendar(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        periods: list[dict[str, Any]] = []
        for row in rows:
            if _text(row.get("row_kind")) != "period":
                continue
            start = _as_date(row.get("period_start"))
            end = _as_date(row.get("period_end"))
            if start is None or end is None:
                raise ValueError("period row without start or end date")
            periods.append(
                {
                    "fiscal_year": int(row["fiscal_year"]),
                    "period": int(row["period"]),
                    "start": start,
                    "end": end,
                }
            )
        current = [p for p in periods if p["start"] <= self.today <= p["end"]]
        if not current:
            raise ValueError(f"no fiscal period contains {self.today.isoformat()}")
        current_fy = max(p["fiscal_year"] for p in current)
        current_period = max(p["period"] for p in current if p["fiscal_year"] == current_fy)
        prior_fy = current_fy - 1
        periods = sorted(
            (p for p in periods if p["fiscal_year"] in (current_fy, prior_fy)),
            key=lambda p: (p["fiscal_year"], p["period"]),
        )
        return {
            "current_fy": current_fy,
            "prior_fy": prior_fy,
            "current_period": current_period,
            "periods": [
                {
                    "fiscal_year": p["fiscal_year"],
                    "period": p["period"],
                    "start": p["start"].isoformat(),
                    "end": p["end"].isoformat(),
                }
                for p in periods
            ],
        }

    def transform(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        calendar = self._calendar(rows)
        years = (calendar["current_fy"], calendar["prior_fy"])
        out: list[dict[str, Any]] = []
        for row in rows:
            if _text(row.get("row_kind")) != "balance":
                continue
            dept = _text(row.get("dept"))
            mapped = self.dept_map.get(dept)
            if mapped is None:
                continue  # defensive: the SQL IN list already limits this
            fiscal_year = int(row["fiscal_year"])
            period = int(row["period"])
            if fiscal_year not in years or period <= 0:
                continue
            group, sport_key = mapped
            natural = _text(row.get("natural_account"))
            category = "revenue" if natural.startswith("4") else "expense"
            debit = _as_decimal(row.get("debit"))
            credit = _as_decimal(row.get("credit"))
            amount = credit - debit if category == "revenue" else debit - credit
            period_end = _as_date(row.get("period_end"))
            out.append(
                {
                    "group": group,
                    "sport_key": sport_key if group == GROUP_TEAM else None,
                    "dept": dept,
                    "dept_desc": _text(row.get("dept_desc")),
                    "account": _text(row.get("account")),
                    "account_desc": _text(row.get("account_desc")),
                    "category": category,
                    "fiscal_year": fiscal_year,
                    "period": period,
                    "period_end": period_end.isoformat() if period_end else None,
                    "debit": _money(debit),
                    "credit": _money(credit),
                    "amount": _money(amount),
                }
            )
        out.sort(key=lambda r: (r["group"], r["sport_key"] or "", r["dept"], r["account"], r["fiscal_year"], r["period"]))
        self.meta = calendar
        return out

    def sidecar(self, rows: list[dict[str, Any]], latest: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        calendar = self.meta if self.meta is not None else self._calendar(rows)
        payload = {
            "schema_version": 1,
            "source": SOURCE,
            "dataset": DATASET,
            "as_of": latest.get("pulled_at"),
            "as_of_date": self.today.isoformat(),
            "dt": latest.get("dt"),
            "record_count": latest.get("record_count"),
            **calendar,
        }
        return META_KEY, payload
