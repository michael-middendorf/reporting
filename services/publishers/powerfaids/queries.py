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
# "agi" is whole-token so packaging_status / date_packaged are not flagged.
WHOLE_IDENTIFIER_TOKENS: tuple[str, ...] = ("tin", "dob", "agi")

# ---------------------------------------------------------------------------
# Window: award years whose award_year_defn.date_begin is on/after min_date
# (default 7 years back). Every student-level query is limited to those years.
# Person key is student_token plus campus_id (alternate_id masked to P + 9 digits). No SSN, ITIN,
# names, contact details, birth date, ISIR income or parent data.
# ---------------------------------------------------------------------------

_YEAR_WINDOW = (
    "SELECT ayd.award_year_token FROM dbo.award_year_defn AS ayd "
    "WHERE ayd.date_begin >= %(min_date)s"
)

AWARD_YEARS = (
    "SELECT ayd.award_year_token, ayd.award_year_name, ayd.date_begin, ayd.date_end, "
    "ayd.enabled, ayd.Archived "
    "FROM dbo.award_year_defn AS ayd "
    "OPTION (MAXDOP 1)"
)

PERIODS_OF_ENROLLMENT = (
    "SELECT p.poe_token, p.award_year_token, p.attend_desc, p.display_name, "
    "p.attend_calendar, p.start_date, p.end_date "
    "FROM dbo.poe AS p "
    f"WHERE p.award_year_token IN ({_YEAR_WINDOW}) "
    "OPTION (MAXDOP 1)"
)

FUNDS = (
    "SELECT f.fund_token, f.award_year_token, f.fund_ledger_number, f.fund_long_name, "
    "f.fund_short_name, f.fund_desc, f.fund_type, f.fund_source, f.fund_family, "
    "f.fund_family_2, f.fund_need_based, f.ext_fund_code, f.fund_grant_subtype, "
    "f.fund_loan_subtype, f.fund_job_subtype, f.active_fund, f.renewable, "
    "f.include_in_IPEDS, f.include_in_CDS "
    "FROM dbo.funds AS f "
    f"WHERE f.award_year_token IN ({_YEAR_WINDOW}) "
    "OPTION (MAXDOP 1)"
)

# alternate_id is published only when it is a PowerCampus ID (P + 9 digits).
# Discovery on 2026-10-01 found 21 rows where alternate_id equals the SSN and
# 163 other 9-digit values, so anything else is returned as NULL.
STUDENTS = (
    "SELECT s.student_token, "
    "CASE WHEN s.alternate_id LIKE 'P[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' "
    "THEN s.alternate_id END AS campus_id, s.restricted_access "
    "FROM dbo.student AS s "
    "WHERE s.student_token IN (SELECT say.student_token FROM dbo.stu_award_year AS say "
    f"WHERE say.award_year_token IN ({_YEAR_WINDOW})) "
    "OPTION (MAXDOP 1)"
)

STUDENT_AWARD_YEARS = (
    "SELECT say.stu_award_year_token, say.student_token, say.award_year_token, "
    "say.packaging_status, say.tracking_status, say.date_packaged, say.date_offer_accepted, "
    "say.year_in_school, say.class_load, say.career_code, say.academic_division, "
    "say.admit_status, say.transfer_flag, say.major_code, say.program_token, "
    "say.degree_seeking, say.date_enrolled, say.date_withdrew, say.grad_dt, "
    "say.satisfatory_progress, say.start_date, say.end_date "
    "FROM dbo.stu_award_year AS say "
    f"WHERE say.award_year_token IN ({_YEAR_WINDOW}) "
    "OPTION (MAXDOP 1)"
)

STUDENT_AWARDS = (
    "SELECT sa.stu_award_token, sa.stu_award_year_token, sa.fund_ay_token, sa.fund_name, "
    "sa.status, sa.actual_amt, sa.disbursed_amt, sa.pell_flag, sa.external_award_flag, "
    "sa.estimated_award, sa.begin_date, sa.end_date, sa.award_period_begin_dt, "
    "sa.award_period_end_dt, sa.ack_date, sa.can_date, sa.created_dt, sa.modified_dt "
    "FROM dbo.stu_award AS sa "
    "WHERE sa.stu_award_year_token IN (SELECT say.stu_award_year_token FROM dbo.stu_award_year AS say "
    f"WHERE say.award_year_token IN ({_YEAR_WINDOW})) "
    "OPTION (MAXDOP 1)"
)

SCHEDULED_DISBURSEMENTS = (
    "SELECT sat.award_trans_token, sat.stu_award_token, sat.stu_award_year_token, sat.poe_token, "
    "sat.disbursement_number, sat.scheduled_date, sat.scheduled_amount, "
    "sat.gross_disbursement_amount, sat.net_disbursement_amount, sat.enrollment_status, "
    "sat.payment_period_start_date, sat.payment_period_end_date "
    "FROM dbo.stu_award_transactions AS sat "
    "WHERE sat.stu_award_year_token IN (SELECT say.stu_award_year_token FROM dbo.stu_award_year AS say "
    f"WHERE say.award_year_token IN ({_YEAR_WINDOW})) "
    "OPTION (MAXDOP 1)"
)

DISBURSEMENTS = (
    "SELECT dt.disbursement_transactions_token, dt.stu_award_token, dt.award_trans_token, "
    "dt.poe_token, dt.award_year_token, dt.xaction_date, dt.amount, dt.gross_amount, "
    "dt.net_disbursement_amount, dt.disbursement_number, dt.disbursement_type, "
    "dt.source_type, dt.ledger_number, dt.cod_disbursement_date "
    "FROM dbo.disbursement_transactions AS dt "
    f"WHERE dt.award_year_token IN ({_YEAR_WINDOW}) "
    "OPTION (MAXDOP 1)"
)

NEED_SUMMARY = (
    "SELECT sd.stu_award_year_token, sd.tot_budget, sd.tot_tuition_fees, sd.tot_room_board, "
    "sd.tot_books_supplies, sd.tot_transportation, sd.tot_other_budget, sd.tot_aid, "
    "sd.tot_grants_awd, sd.tot_grants_disb, sd.tot_loans_awd, sd.tot_loans_disb, "
    "sd.tot_jobs_awd, sd.tot_jobs_disb, sd.tot_inst_funds_awd, sd.tot_inst_funds_disb, "
    "sd.tot_inst_grants_awd, sd.tot_inst_grants_disb, sd.tot_fed_funds_awd, sd.tot_fed_funds_disb, "
    "sd.tot_state_funds_awd, sd.tot_state_funds_disb, sd.tot_private_funds_awd, "
    "sd.tot_private_funds_disb, sd.tot_external_aid, sd.percent_need, sd.fm_need_based, "
    "sd.im_need_based, sd.recip_of_title4_aid "
    "FROM dbo.stu_ay_sum_data AS sd "
    "WHERE sd.stu_award_year_token IN (SELECT say.stu_award_year_token FROM dbo.stu_award_year AS say "
    f"WHERE say.award_year_token IN ({_YEAR_WINDOW})) "
    "OPTION (MAXDOP 1)"
)

# Federal EFC/SAI only, from the need-analysis row. No other ISIR fields.
EFC_SAI = (
    "SELECT fm.stu_award_year_token, fm.primary_efc, fm.federal_efc, fm.primary_sai, "
    "fm.federal_sai, fm.simplified_needs_test "
    "FROM dbo.say_fm_stu AS fm "
    "WHERE fm.stu_award_year_token IN (SELECT say.stu_award_year_token FROM dbo.stu_award_year AS say "
    f"WHERE say.award_year_token IN ({_YEAR_WINDOW})) "
    "OPTION (MAXDOP 1)"
)

PELL = (
    "SELECT pd.stu_award_year_token, pd.pell_status, pd.pell_sai, pd.efc_reported, "
    "pd.pell_budget, pd.award_ft, pd.award_amt, pd.payment_amount, pd.pell_leu, "
    "pd.pell_max_indicator, pd.pell_min_indicator, pd.iasg_eligible, pd.cfh_eligible, "
    "pd.workforce_pell_eligible "
    "FROM dbo.stu_pell_data AS pd "
    "WHERE pd.stu_award_year_token IN (SELECT say.stu_award_year_token FROM dbo.stu_award_year AS say "
    f"WHERE say.award_year_token IN ({_YEAR_WINDOW})) "
    "OPTION (MAXDOP 1)"
)

DATASETS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("award_years", AWARD_YEARS, ()),
    ("periods_of_enrollment", PERIODS_OF_ENROLLMENT, ("min_date",)),
    ("funds", FUNDS, ("min_date",)),
    ("students", STUDENTS, ("min_date",)),
    ("student_award_years", STUDENT_AWARD_YEARS, ("min_date",)),
    ("student_awards", STUDENT_AWARDS, ("min_date",)),
    ("scheduled_disbursements", SCHEDULED_DISBURSEMENTS, ("min_date",)),
    ("disbursements", DISBURSEMENTS, ("min_date",)),
    ("need_summary", NEED_SUMMARY, ("min_date",)),
    ("efc_sai", EFC_SAI, ("min_date",)),
    ("pell", PELL, ("min_date",)),
)

# Every statement in this module, for the guard and exclusion tests.
ALL_STATEMENTS: tuple[str, ...] = (
    SESSION_CHECK,
    VERSION_CHECK,
    *(sql for _, sql, _ in DATASETS),
)
