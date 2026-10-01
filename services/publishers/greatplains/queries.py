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
)
WHOLE_IDENTIFIER_TOKENS: tuple[str, ...] = ()

# ---------------------------------------------------------------------------
# Publish order: (dataset, sql, parameter names).
# TODO: pending schema discovery (pf-columns.csv / gp-columns.csv). Add one
# named-column, OPTION (MAXDOP 1) constant per table here once the column
# inventory is reviewed, and list it in DATASETS.
# ---------------------------------------------------------------------------

DATASETS: tuple[tuple[str, str, tuple[str, ...]], ...] = ()

# Every statement in this module, for the guard and exclusion tests.
ALL_STATEMENTS: tuple[str, ...] = (
    SESSION_CHECK,
    VERSION_CHECK,
    *(sql for _, sql, _ in DATASETS),
)
