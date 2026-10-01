"""Every SQL statement the Great Plains publisher is allowed to send.

Source: Great Plains (finance GL/AP) on AMU-V-GP18SQL, read through a
read-only login with column-level SELECT grants.

Rules (enforced by common.mssql.guard_select at execution time and by
test_handler.py):
  * One SELECT (or WITH) statement per constant, no semicolons, no comments.
  * Name every column (no '*', no COUNT(*)).
  * Every statement ends with OPTION (MAXDOP 1).
  * Values are bound parameters (pytds pyformat, e.g. %(min_year)s), never
    string-formatted into the SQL. Available parameters come from
    handler.window_params: min_year (str), min_date (date), current_year (str).
  * No selected column may match EXCLUDED_COLUMN_SUBSTRINGS (tax ids, EFT and
    vendor bank details). Enforced by test_handler.py.
"""

from __future__ import annotations

from common.mssql import SESSION_CHECK, VERSION_CHECK

# Case-insensitive substring match against every selected identifier:
# vendor/employee tax ids (TXIDNMBR, TAXID), tax registration numbers
# (TXRGNNUM), EFT and bank setup, SSNs, and vendor bank account numbers.
EXCLUDED_COLUMN_SUBSTRINGS: tuple[str, ...] = (
    "TXIDNMBR", "TAXID", "EFT", "BANK", "SSN", "ACCTNUM", "TXRGNNUM",
    # Vendor contact details and birth date (some vendors are individuals).
    "ADDRESS", "PHNUMBR", "PHONE", "FAXNUMBR", "ZIPCODE", "BRTHDATE",
)
WHOLE_IDENTIFIER_TOKENS: tuple[str, ...] = ()

# ---------------------------------------------------------------------------
# Company database AMU (Ave Maria University) only. Window: fiscal years on/after
# min_year_int (default 7 years back) for balances and journal lines, and
# documents dated on/after min_date for payables. Char columns are RTRIMmed.
# No tax IDs, bank/EFT details, vendor addresses or phones, or user columns.
# ---------------------------------------------------------------------------

GL_ACCOUNTS = (
    "SELECT a.ACTINDX, RTRIM(s.ACTNUMST) AS ACTNUMST, RTRIM(a.ACTNUMBR_1) AS ACTNUMBR_1, "
    "RTRIM(a.ACTNUMBR_2) AS ACTNUMBR_2, RTRIM(a.ACTNUMBR_3) AS ACTNUMBR_3, "
    "RTRIM(a.ACTNUMBR_4) AS ACTNUMBR_4, RTRIM(a.ACTNUMBR_5) AS ACTNUMBR_5, "
    "RTRIM(a.ACTNUMBR_6) AS ACTNUMBR_6, RTRIM(a.ACTALIAS) AS ACTALIAS, "
    "RTRIM(a.ACTDESCR) AS ACTDESCR, a.ACCTTYPE, a.PSTNGTYP, a.ACCATNUM, a.ACTIVE, "
    "a.TPCLBLNC, a.CREATDDT, a.MODIFDT "
    "FROM dbo.GL00100 AS a "
    "LEFT JOIN dbo.GL00105 AS s ON s.ACTINDX = a.ACTINDX "
    "OPTION (MAXDOP 1)"
)

GL_SEGMENTS = (
    "SELECT g.SGMTNUMB, RTRIM(g.SGMNTID) AS SGMNTID, RTRIM(g.DSCRIPTN) AS DSCRIPTN "
    "FROM dbo.GL40200 AS g "
    "OPTION (MAXDOP 1)"
)

FISCAL_YEARS = (
    "SELECT y.YEAR1, y.FSTFSCDY, y.LSTFSCDY, y.NUMOFPER, y.HISTORYR "
    "FROM dbo.SY40101 AS y "
    "OPTION (MAXDOP 1)"
)

FISCAL_PERIODS = (
    "SELECT p.YEAR1, p.PERIODID, RTRIM(p.PERNAME) AS PERNAME, p.PERIODDT, p.PERDENDT, "
    "p.SERIES, RTRIM(p.ODESCTN) AS ODESCTN, p.CLOSED "
    "FROM dbo.SY40100 AS p "
    "WHERE p.YEAR1 >= %(min_year_int)s "
    "OPTION (MAXDOP 1)"
)

GL_BALANCES_OPEN = (
    "SELECT b.ACTINDX, b.YEAR1, b.PERIODID, b.Ledger_ID, b.ACCATNUM, b.PERDBLNC, "
    "b.DEBITAMT, b.CRDTAMNT "
    "FROM dbo.GL10110 AS b "
    "WHERE b.YEAR1 >= %(min_year_int)s "
    "OPTION (MAXDOP 1)"
)

GL_BALANCES_HISTORY = (
    "SELECT b.ACTINDX, b.YEAR1, b.PERIODID, b.Ledger_ID, b.ACCATNUM, b.PERDBLNC, "
    "b.DEBITAMT, b.CRDTAMNT "
    "FROM dbo.GL10111 AS b "
    "WHERE b.YEAR1 >= %(min_year_int)s "
    "OPTION (MAXDOP 1)"
)

_GL_LINE_COLUMNS = (
    "t.JRNENTRY, t.SEQNUMBR, t.DEX_ROW_ID, t.ACTINDX, t.TRXDATE, t.PERIODID, "
    "RTRIM(t.SOURCDOC) AS SOURCDOC, RTRIM(t.REFRENCE) AS REFRENCE, "
    "RTRIM(t.DSCRIPTN) AS DSCRIPTN, RTRIM(t.TRXSORCE) AS TRXSORCE, t.SERIES, "
    "t.ORTRXTYP, RTRIM(t.ORCTRNUM) AS ORCTRNUM, RTRIM(t.ORMSTRID) AS ORMSTRID, "
    "RTRIM(t.ORMSTRNM) AS ORMSTRNM, RTRIM(t.ORDOCNUM) AS ORDOCNUM, t.ORPSTDDT, "
    "t.DEBITAMT, t.CRDTAMNT, t.VOIDED, t.Ledger_ID"
)

GL_LINES_OPEN = (
    f"SELECT t.OPENYEAR, {_GL_LINE_COLUMNS} "
    "FROM dbo.GL20000 AS t "
    "WHERE t.OPENYEAR >= %(min_year_int)s "
    "OPTION (MAXDOP 1)"
)

GL_LINES_HISTORY = (
    f"SELECT t.HSTYEAR, {_GL_LINE_COLUMNS} "
    "FROM dbo.GL30000 AS t "
    "WHERE t.HSTYEAR >= %(min_year_int)s "
    "OPTION (MAXDOP 1)"
)

VENDORS = (
    "SELECT RTRIM(v.VENDORID) AS VENDORID, RTRIM(v.VENDNAME) AS VENDNAME, "
    "RTRIM(v.VENDSHNM) AS VENDSHNM, RTRIM(v.VNDCLSID) AS VNDCLSID, v.VENDSTTS, "
    "v.TEN99TYPE, RTRIM(v.PYMTRMID) AS PYMTRMID, v.HOLD, v.CREATDDT, v.MODIFDT "
    "FROM dbo.PM00200 AS v "
    "OPTION (MAXDOP 1)"
)

_AP_COLUMNS = (
    "RTRIM(d.VCHRNMBR) AS VCHRNMBR, RTRIM(d.VENDORID) AS VENDORID, d.DOCTYPE, d.DOCDATE, "
    "RTRIM(d.DOCNUMBR) AS DOCNUMBR, d.DOCAMNT, d.CURTRXAM, d.TTLPYMTS, d.DUEDATE, "
    "d.POSTEDDT, d.PSTGDATE, RTRIM(d.TRXDSCRN) AS TRXDSCRN, RTRIM(d.PORDNMBR) AS PORDNMBR, "
    "RTRIM(d.BACHNUMB) AS BACHNUMB, d.VOIDED, d.HOLD"
)

AP_DOCUMENTS_OPEN = (
    f"SELECT {_AP_COLUMNS} "
    "FROM dbo.PM20000 AS d "
    "OPTION (MAXDOP 1)"
)

AP_DOCUMENTS_HISTORY = (
    f"SELECT {_AP_COLUMNS}, d.VOIDPDATE "
    "FROM dbo.PM30200 AS d "
    "WHERE d.DOCDATE >= %(min_date)s "
    "OPTION (MAXDOP 1)"
)

DATASETS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("gl_accounts", GL_ACCOUNTS, ()),
    ("gl_segments", GL_SEGMENTS, ()),
    ("fiscal_years", FISCAL_YEARS, ()),
    ("fiscal_periods", FISCAL_PERIODS, ("min_year_int",)),
    ("gl_balances_open", GL_BALANCES_OPEN, ("min_year_int",)),
    ("gl_balances_history", GL_BALANCES_HISTORY, ("min_year_int",)),
    ("gl_lines_open", GL_LINES_OPEN, ("min_year_int",)),
    ("gl_lines_history", GL_LINES_HISTORY, ("min_year_int",)),
    ("vendors", VENDORS, ()),
    ("ap_documents_open", AP_DOCUMENTS_OPEN, ()),
    ("ap_documents_history", AP_DOCUMENTS_HISTORY, ("min_date",)),
)

# Every statement in this module, for the guard and exclusion tests.
ALL_STATEMENTS: tuple[str, ...] = (
    SESSION_CHECK,
    VERSION_CHECK,
    *(sql for _, sql, _ in DATASETS),
)
