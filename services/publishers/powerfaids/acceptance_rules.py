"""Mapping rules for the acceptance letters export (DST-3070).

Every business rule that turns PowerFAIDS rows into a letter package lives in
this one module, as named constants, so Financial Aid can review them in one
place. The transform (acceptance.py) contains mechanics only and reads these.

Confirm with Financial Aid before LIVE_LETTERS_ENABLED. Nothing here has been
approved by Financial Aid yet. With the defaults below no package can be
"approved" (PACKAGED_STATUSES is empty), so the export is all draft or
withdrawn until FA names the packaging status code(s) that mean "final".
"""

from __future__ import annotations

import re
from typing import Mapping

# ---------------------------------------------------------------------------
# Award year
# ---------------------------------------------------------------------------

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
AWARD_YEAR_ENV = "ACCEPT_AWARD_YEAR_NAME"
DEFAULT_AWARD_YEAR_NAME = "2027-2028"
_AWARD_YEAR_NAME_RE = re.compile(r"^\d{4}-\d{4}$")


def award_year_name(env: Mapping[str, str]) -> str:
    """The award_year_defn.award_year_name to export (env override, else the default)."""
    value = (env.get(AWARD_YEAR_ENV) or "").strip() or DEFAULT_AWARD_YEAR_NAME
    if not _AWARD_YEAR_NAME_RE.match(value):
        raise ValueError(f"{AWARD_YEAR_ENV} must look like 2027-2028, got {value!r}")
    return value


# ---------------------------------------------------------------------------
# Population and package status
# ---------------------------------------------------------------------------

# Population: dbo.student rows whose alternate_id is a PowerCampus ID (P + 9
# digits, queries.CAMPUS_ID_EXPR) and that have a stu_award_year row for the
# award year. One package per student. Other rows are excluded in SQL.

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
# stu_award_year.packaging_status codes that mean the package is final and may
# be sent. EMPTY ON PURPOSE: nothing is approved until FA names the code. In
# the 2027-2028 data (2026-10-12) packaging_status is null on every row.
PACKAGED_STATUSES: tuple[str, ...] = ()

# A package is "withdrawn" when stu_award_year.date_withdrew is not null.
# Otherwise it is "approved" only if packaging_status is in PACKAGED_STATUSES
# AND it has no notes; anything else is "draft".

# ---------------------------------------------------------------------------
# Awards
# ---------------------------------------------------------------------------

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
# stu_award.status -> letter award status. Any other status (cancelled, etc.)
# is skipped and counted in the manifest summary (awardsSkippedStatus).
# Observed in the 2027-2028 data (2026-10-12): only "A".
AWARD_STATUS_MAP: Mapping[str, str] = {"O": "offered", "A": "accepted", "D": "declined"}

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
# Award category comes from funds (stu_award.fund_ay_token = funds.fund_token).
FUND_TYPE_LOAN = "L"
FUND_TYPE_WORK = "J"
FUND_TYPE_GRANT = "G"
# fund_type "G" is a "scholarship" when fund_source is SCHOLARSHIP_FUND_SOURCE
# and fund_family is in SCHOLARSHIP_FAMILIES; otherwise a "grant". Any other
# fund_type is skipped and counted (awardsSkippedFundType).
SCHOLARSHIP_FUND_SOURCE = "I"
SCHOLARSHIP_FAMILIES: tuple[str, ...] = (
    "Admission", "AdmissionPT", "AdmissioPT", "Academic", "AcademicPT",
    "Athletic", "AthleticPT", "Advancement", "Advancement-GR", "Advancement-R",
    "Graduate", "HR-Graduate",
)

# Display: label = funds.fund_long_name, code = funds.fund_short_name (fallback
# str(fund_token)).
# featured = true on exactly one award: the largest scholarship by annual
# amount (tie: alphabetical label). Declined scholarships are not excluded.

# ---------------------------------------------------------------------------
# Fall / spring split of awards
# ---------------------------------------------------------------------------

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
# Scheduled amounts (stu_award_transactions.scheduled_amount) are summed per
# award by term, where the term comes from poe.attend_desc (case-insensitive).
FALL_POE_PATTERN = re.compile(r"^fall", re.IGNORECASE)
SPRING_POE_PATTERN = re.compile(r"^spring", re.IGNORECASE)
# Notes (each one makes the package a draft). {code} is the award code.
NOTE_NON_TERM_DISBURSEMENT = "award {code} has non fall/spring disbursements"
NOTE_SPLIT_EVENLY = "award {code} split evenly, no schedule"
NOTE_SCHEDULE_MISMATCH = "award {code} schedule does not match the award amount"
# Added beyond the brief so an award is never dropped from a letter silently.
NOTE_NO_FUND = "award {code} has no fund record"
NOTE_UNKNOWN_FUND_TYPE = "award {code} has an unrecognized fund type and was left out"
NOTE_NEGATIVE_AMOUNT = "award {code} has a negative amount and was left out"
# Annual amounts without a schedule are split evenly, odd cent to fall.

# ---------------------------------------------------------------------------
# Costs and housing
# ---------------------------------------------------------------------------

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
# (stu_ay_sum_data column, code, label, category). Annual amounts are split
# evenly, odd cent to fall. Every line is omitted when null or zero. If
# tot_tuition_fees is null or zero the package gets NOTE_NO_COA (so it cannot
# be approved). The housing line is omitted when tot_room_board is not > 0.
COST_LINES: tuple[tuple[str, str, str, str], ...] = (
    ("tot_tuition_fees", "TUITION_FEES", "Tuition and fees", "tuition_fees"),
    ("tot_room_board", "HOUSING_MEALS", "Housing and meals", "housing_meals"),
    ("tot_books_supplies", "BOOKS", "Books and supplies", "other"),
    ("tot_transportation", "TRANSPORT", "Transportation", "other"),
    ("tot_other_budget", "PERSONAL", "Personal expenses", "other"),
)
TUITION_COLUMN = "tot_tuition_fees"
NOTE_NO_COA = "no cost of attendance"

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
# housingPlan: "On campus" when tot_room_board > 0, else "Commuter".
ROOM_BOARD_COLUMN = "tot_room_board"
HOUSING_ON_CAMPUS = "On campus"
HOUSING_COMMUTER = "Commuter"

# ---------------------------------------------------------------------------
# Units and clock (verified against the data, not assumed)
# ---------------------------------------------------------------------------

# Confirm with Financial Aid before LIVE_LETTERS_ENABLED.
# PowerFAIDS money is WHOLE DOLLARS. Checked 2026-10-12 against the 2026-2027
# rows of the need_summary and student_awards raw datasets (aggregates only):
# tot_tuition_fees median 33240 (min 510, max 39310), tot_room_board median
# 15704, actual_amt median 3500 (min 24, max 42664), and every value was a
# whole number. AMU tuition is about $33k a year, so these are dollars, not
# cents. Multiply by 100 for the contract.
DOLLARS_TO_CENTS = 100

# PowerFAIDS timestamps (stu_award.created_dt / modified_dt) are naive local
# campus time. Checked 2026-10-12: the newest modified_dt was 03:21 on the day
# of a 07:51 UTC (03:51 ET) pull, so they are Eastern, not UTC.
POWERFAIDS_TIMEZONE = "America/New_York"
