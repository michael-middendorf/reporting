"""Every SQL statement the PowerCampus publisher is allowed to send.

Rules (enforced by db.guard_select at execution time and by test_handler.py):
  * One SELECT (or WITH) statement per constant, no semicolons, no comments.
  * Name every column. amu_reporting_ro has column-level SELECT grants only, so
    SELECT * and COUNT(*) fail (and are rejected by the guard before sending).
  * Every statement ends with OPTION (MAXDOP 1) so a query never fans out
    across the production server's schedulers.
  * Values are bound parameters (pytds pyformat, e.g. %(min_year)s), never
    string-formatted into the SQL.

Column lists for the code tables (CODE_VALUE_KEY, CODE_VALUE, SHORT_DESC,
MEDIUM_DESC, LONG_DESC, STATUS) and for ACADEMICCALENDAR (ACADEMIC_YEAR,
ACADEMIC_TERM, ACADEMIC_SESSION, START_DATE, END_DATE) were verified against
the University_AMU schema 2026-09-29.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Session verification and dry-run checks
# ---------------------------------------------------------------------------

# Reads this session's own row (no VIEW SERVER STATE needed) to prove the
# session setup took effect before any data query runs.
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

# Named-column count (column-level grants make COUNT(*) fail).
DRY_RUN_ACADEMIC_COUNT = (
    "SELECT COUNT(a.PEOPLE_CODE_ID) AS row_count "
    "FROM dbo.ACADEMIC AS a "
    "WHERE a.ACADEMIC_YEAR = %(year)s "
    "OPTION (MAXDOP 1)"
)

# ---------------------------------------------------------------------------
# Year-windowed raw tables (ACADEMIC_YEAR is varchar(4); compared as a string)
# ---------------------------------------------------------------------------

ACADEMIC = (
    "SELECT a.PEOPLE_CODE, a.PEOPLE_ID, a.PEOPLE_CODE_ID, a.ACADEMIC_YEAR, "
    "a.ACADEMIC_TERM, a.ACADEMIC_SESSION, a.PROGRAM, a.DEGREE, a.CURRICULUM, "
    "a.COLLEGE, a.DEPARTMENT, a.CLASS_LEVEL, a.POPULATION, a.FULL_PART, "
    "a.CREDITS, a.ENROLL_SEPARATION, a.SEPARATION_DATE, a.PRIMARY_FLAG, "
    "a.ACADEMIC_FLAG, a.APPLICATION_FLAG, a.APP_DECISION, a.COLLEGE_ATTEND, "
    "a.EXTRA_CURRICULAR, a.ADMIT_YEAR, a.ADMIT_TERM, a.ADMIT_SESSION, "
    "a.MATRIC, a.MATRIC_YEAR, a.MATRIC_TERM, a.GRADUATED, a.GRADUATED_YEAR, "
    "a.GRADUATED_TERM, a.GRADUATED_SESSION, a.TRANSCRIPT_SEQ, a.STATUS, "
    "a.REVISION_DATE "
    "FROM dbo.ACADEMIC AS a "
    "WHERE a.ACADEMIC_YEAR >= %(min_year)s "
    "OPTION (MAXDOP 1)"
)

DEMOGRAPHICS = (
    "SELECT d.PEOPLE_CODE, d.PEOPLE_ID, d.PEOPLE_CODE_ID, d.ACADEMIC_YEAR, "
    "d.ACADEMIC_TERM, d.ACADEMIC_SESSION, d.ETHNICITY, d.GENDER, d.RELIGION, "
    "d.CITIZENSHIP, d.VISA "
    "FROM dbo.DEMOGRAPHICS AS d "
    "WHERE d.ACADEMIC_YEAR >= %(min_year)s "
    "OPTION (MAXDOP 1)"
)

RESIDENCY = (
    "SELECT r.PEOPLE_CODE, r.PEOPLE_ID, r.PEOPLE_CODE_ID, r.ACADEMIC_YEAR, "
    "r.ACADEMIC_TERM, r.ACADEMIC_SESSION, r.RESIDENT_COMMUTER, r.DORM_CAMPUS, "
    "r.DORM_BUILDING, r.DORM_PLAN "
    "FROM dbo.RESIDENCY AS r "
    "WHERE r.ACADEMIC_YEAR >= %(min_year)s "
    "OPTION (MAXDOP 1)"
)

TRANSCRIPTGPA = (
    "SELECT g.PEOPLE_CODE, g.PEOPLE_ID, g.PEOPLE_CODE_ID, g.ACADEMIC_YEAR, "
    "g.ACADEMIC_TERM, g.ACADEMIC_SESSION, g.TRANSCRIPT_SEQ, g.RECORD_TYPE, "
    "g.PROGRAM, g.DEGREE, g.CURRICULUM, g.ATTEMPTED_CREDITS, g.EARNED_CREDITS, "
    "g.TOTAL_CREDITS, g.TRANSFER_CREDITS, g.GPA_CREDITS, g.GPA "
    "FROM dbo.TRANSCRIPTGPA AS g "
    "WHERE g.ACADEMIC_YEAR >= %(min_year)s "
    "OPTION (MAXDOP 1)"
)

# All association codes in the window. Codes of interest downstream: HONORS,
# HHMAMA (Mary's Marines), FSP-NS, INSCH (Institute Scholarship).
ASSOCIATION = (
    "SELECT s.PEOPLE_ORG_CODE, s.PEOPLE_ORG_ID, s.PEOPLE_ORG_CODE_ID, "
    "s.ASSOCIATION, s.ACADEMIC_YEAR, s.ACADEMIC_TERM, s.ACADEMIC_SESSION "
    "FROM dbo.ASSOCIATION AS s "
    "WHERE s.ACADEMIC_YEAR >= %(min_year)s "
    "OPTION (MAXDOP 1)"
)

# Degrees conferred on or after %(min_graduation_date)s (default: 8 years back).
TRANSCRIPTDEGREE = (
    "SELECT t.PEOPLE_CODE, t.PEOPLE_ID, t.PEOPLE_CODE_ID, t.TRANSCRIPT_SEQ, "
    "t.PROGRAM, t.DEGREE, t.CURRICULUM, t.COLLEGE, t.GRADUATION_DATE, "
    "t.FORMAL_TITLE "
    "FROM dbo.TRANSCRIPTDEGREE AS t "
    "WHERE t.GRADUATION_DATE >= %(min_graduation_date)s "
    "OPTION (MAXDOP 1)"
)

# ---------------------------------------------------------------------------
# Person-level tables, restricted to people with an ACADEMIC row in the window
# ---------------------------------------------------------------------------

PEOPLE = (
    "SELECT p.PEOPLE_CODE, p.PEOPLE_ID, p.PEOPLE_CODE_ID, p.FIRST_NAME, "
    "p.MIDDLE_NAME, p.LAST_NAME, p.SUFFIX, p.NICKNAME, p.PREFERRED_ADD, "
    "p.PrimaryEmailId, p.DECEASED_FLAG, p.PersonId "
    "FROM dbo.PEOPLE AS p "
    "WHERE EXISTS ("
    "SELECT a.PEOPLE_CODE_ID FROM dbo.ACADEMIC AS a "
    "WHERE a.PEOPLE_CODE_ID = p.PEOPLE_CODE_ID "
    "AND a.ACADEMIC_YEAR >= %(min_year)s"
    ") "
    "OPTION (MAXDOP 1)"
)

# Preferred address only: PEOPLE.PREFERRED_ADD names the ADDRESS_TYPE.
ADDRESS = (
    "SELECT ad.PEOPLE_ORG_CODE, ad.PEOPLE_ORG_ID, ad.PEOPLE_ORG_CODE_ID, "
    "ad.ADDRESS_TYPE, ad.CITY, ad.STATE, ad.ZIP_CODE, ad.COUNTRY "
    "FROM dbo.PEOPLE AS p "
    "INNER JOIN dbo.ADDRESS AS ad "
    "ON ad.PEOPLE_ORG_CODE_ID = p.PEOPLE_CODE_ID "
    "AND ad.ADDRESS_TYPE = p.PREFERRED_ADD "
    "WHERE EXISTS ("
    "SELECT a.PEOPLE_CODE_ID FROM dbo.ACADEMIC AS a "
    "WHERE a.PEOPLE_CODE_ID = p.PEOPLE_CODE_ID "
    "AND a.ACADEMIC_YEAR >= %(min_year)s"
    ") "
    "OPTION (MAXDOP 1)"
)

# Primary email only: PEOPLE.PrimaryEmailId = EmailAddress.EmailAddressId.
EMAIL = (
    "SELECT e.EmailAddressId, e.PeopleOrgCode, e.PeopleOrgId, "
    "e.PeopleOrgCodeId, e.EmailType, e.Email, e.IsActive "
    "FROM dbo.PEOPLE AS p "
    "INNER JOIN dbo.EmailAddress AS e "
    "ON e.EmailAddressId = p.PrimaryEmailId "
    "WHERE EXISTS ("
    "SELECT a.PEOPLE_CODE_ID FROM dbo.ACADEMIC AS a "
    "WHERE a.PEOPLE_CODE_ID = p.PEOPLE_CODE_ID "
    "AND a.ACADEMIC_YEAR >= %(min_year)s"
    ") "
    "OPTION (MAXDOP 1)"
)

# ---------------------------------------------------------------------------
# Reference tables (small, pulled whole)
# ---------------------------------------------------------------------------

ACADEMIC_CALENDAR = (
    "SELECT c.ACADEMIC_YEAR, c.ACADEMIC_TERM, c.ACADEMIC_SESSION, "
    "c.START_DATE, c.END_DATE "
    "FROM dbo.ACADEMICCALENDAR AS c "
    "OPTION (MAXDOP 1)"
)


def _code_table(table: str) -> str:
    # Only called at import time with the literal names in CODE_TABLES below;
    # never with runtime input.
    return (
        "SELECT c.CODE_VALUE_KEY, c.CODE_VALUE, c.SHORT_DESC, c.MEDIUM_DESC, "
        "c.LONG_DESC, c.STATUS "
        f"FROM {table} AS c "
        "OPTION (MAXDOP 1)"
    )


# dataset name -> fully qualified table. Note WebAdmin schema for gender.
CODE_TABLES: dict[str, str] = {
    "code_acasession": "dbo.CODE_ACASESSION",
    "code_acaterm": "dbo.CODE_ACATERM",
    "code_appdecision": "dbo.CODE_APPDECISION",
    "code_association": "dbo.CODE_ASSOCIATION",
    "code_classlevel": "dbo.CODE_CLASSLEVEL",
    "code_collegeattend": "dbo.CODE_COLLEGEATTEND",
    "code_curriculum": "dbo.CODE_CURRICULUM",
    "code_degree": "dbo.CODE_DEGREE",
    "code_emailtype": "dbo.CODE_EMAILTYPE",
    "code_ethnicity": "dbo.CODE_ETHNICITY",
    "code_fullpartflag": "dbo.CODE_FULLPARTFLAG",
    "code_population": "dbo.CODE_POPULATION",
    "code_program": "dbo.CODE_PROGRAM",
    "code_religion": "dbo.CODE_RELIGION",
    "code_visa": "dbo.CODE_VISA",
    "code_gender": "WebAdmin.CODE_GENDER",
}

CODE_TABLE_QUERIES: dict[str, str] = {name: _code_table(table) for name, table in CODE_TABLES.items()}

# ---------------------------------------------------------------------------
# Publish order: (dataset, sql, parameter names). Small reference tables
# first, then the windowed tables. Parameters are resolved by the handler.
# ---------------------------------------------------------------------------

DATASETS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    *((name, sql, ()) for name, sql in CODE_TABLE_QUERIES.items()),
    ("academic_calendar", ACADEMIC_CALENDAR, ()),
    ("academic", ACADEMIC, ("min_year",)),
    ("demographics", DEMOGRAPHICS, ("min_year",)),
    ("residency", RESIDENCY, ("min_year",)),
    ("transcriptgpa", TRANSCRIPTGPA, ("min_year",)),
    ("association", ASSOCIATION, ("min_year",)),
    ("transcriptdegree", TRANSCRIPTDEGREE, ("min_graduation_date",)),
    ("people", PEOPLE, ("min_year",)),
    ("address", ADDRESS, ("min_year",)),
    ("email", EMAIL, ("min_year",)),
)

# Every statement in this module, for the guard tests.
ALL_STATEMENTS: tuple[str, ...] = (
    SESSION_CHECK,
    VERSION_CHECK,
    DRY_RUN_ACADEMIC_COUNT,
    *(sql for _, sql, _ in DATASETS),
)
