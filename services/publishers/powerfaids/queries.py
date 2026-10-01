"""Every SQL statement the PowerFAIDS publisher is allowed to send.

Source: PowerFAIDS financial aid database on AMU-V-PFSQL-N1, read through a
read-only login with column-level SELECT grants.

Rules (enforced by common.mssql.guard_select at execution time and by
test_handler.py):
  * One SELECT (or WITH) statement per constant, no semicolons, no comments.
  * Name every column (no '*', no COUNT(*)).
  * Every statement ends with OPTION (MAXDOP 1).
  * Values are bound parameters (pytds pyformat, e.g. %(min_year)s), never
    string-formatted into the SQL. Available parameters come from
    handler.window_params: min_year (str), min_date (date), current_year (str).
  * No selected column may match EXCLUDED_COLUMN_SUBSTRINGS (SSN, tax and
    income data, parent data, contact details). Enforced by test_handler.py.
"""

from __future__ import annotations

from common.mssql import SESSION_CHECK, VERSION_CHECK

# Case-insensitive. Entries in WHOLE_IDENTIFIER_TOKENS match only a whole
# identifier or one underscore-separated segment of it (so 'tin' does not
# flag names like POSTING_DATE); every other entry is a plain substring match.
EXCLUDED_COLUMN_SUBSTRINGS: tuple[str, ...] = (
    "ssn", "social", "tin", "birth", "dob", "income", "agi", "tax", "phone",
    "address", "street", "parent", "email",
)
WHOLE_IDENTIFIER_TOKENS: tuple[str, ...] = ("tin", "dob")

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
