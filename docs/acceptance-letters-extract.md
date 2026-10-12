# PowerFAIDS acceptance letters export (DST-3070)

The nightly PowerFAIDS job (`services/publishers/powerfaids`) publishes a second,
derived export after every raw dataset succeeds. It feeds the virtual acceptance
letters app. The raw `sources/powerfaids/` prefix and its key stay closed to that
app.

Ticket: https://services.avemaria.edu/t/9a37310a-e717-45ea-b001-ae350612dc43

## Where it lands

| Item | Value |
|------|-------|
| Data object (written first) | `s3://$DATA_BUCKET/sources/acceptance-letters/exports/<generatedAt compact UTC>.json` |
| Manifest (written last) | `s3://$DATA_BUCKET/sources/acceptance-letters/manifest.json` |
| Encryption | SSE-KMS, key alias `alias/amu-reporting-acceptance-letters` (env `PF_ACCEPT_KMS_KEY_ID`) |
| Award year | env `ACCEPT_AWARD_YEAR_NAME`, default `2027-2028` |
| Reader | `dst-2608-virtual-acceptance-TaskRole-IDUz1y5V6W8f` (GetObject + Decrypt via S3, no ListBucket) |

If `PF_ACCEPT_KMS_KEY_ID` is unset the export is skipped with a warning (same as
`PF_NEED_KMS_KEY_ID`). A failure (query, transform or write) is recorded in the run
manifest under `derived_failed` and never fails the raw run. If the data object
write fails, the manifest is not written, so the consumer keeps the last good one.
Old `exports/` objects are not pruned (about one small file per night); add an S3
lifecycle rule if that matters.

## Contract v2

Manifest:

```json
{"schemaVersion":2,"success":true,"generatedAt":"2026-10-13T07:55:01Z","dataKey":"sources/acceptance-letters/exports/2026-10-13T075501Z.json","summary":{"packages":0,"approved":0,"draft":0,"withdrawn":0,"packagesWithNotes":0,"awards":0,"awardsSkippedStatus":0,"awardsSkippedFundType":0,"awardsSkippedNoFund":0,"awardsSkippedNegative":0,"studentsExcludedNoCampusId":0,"campusIdsDuplicate":0,"studentsExcludedDuplicate":0}}
```

Data object: `{"schemaVersion":2,"generatedAt":...,"awardYear":"2027-2028","packages":[...]}`.
Each package:

| Field | Meaning |
|-------|---------|
| `schemaVersion` | 2 |
| `slatePersonReferenceId` | PowerCampus ID, `^P\d{9}$` (v1 called this `slateApplicationReferenceId`) |
| `powerfaidsStudentId` | `str(student_token)` |
| `awardYear` | `2027-2028` |
| `status` | `approved`, `draft` or `withdrawn` |
| `sourceVersion` | sha256 hex of the canonical JSON (sorted keys, compact separators) of the package without `sourceVersion` and `effectiveAt`. Awards are sorted, so row order never changes it. |
| `effectiveAt` | UTC, `...Z`. Latest award `modified_dt`/`created_dt` (PowerFAIDS local time converted to UTC), else the run time. |
| `housingPlan` | `On campus` or `Commuter` |
| `costs` | `{code,label,category,fallCents,springCents}`; may be empty (see below) |
| `awards` | `{code,label,category,status,fallCents,springCents,featured}` |
| `notes` | Strings explaining why a package is draft (new in v2) |

Money is integer cents. Differences the consumer must handle versus v1
(`virtual-acceptance-letters/src/lib/contract.ts`): `schemaVersion` 2, the renamed
ID field, `notes`, and `costs` can be empty on draft packages (v1 requires at least
one). The manifest also has `summary`, and the data object has `awardYear`. The
current consumer rejects this export until its follow-up PR lands.

## Rules module

Every business rule is a named constant in
`services/publishers/powerfaids/acceptance_rules.py`, each marked "Confirm with
Financial Aid before LIVE_LETTERS_ENABLED". `acceptance.py` is mechanics only.
SQL is in `queries.py` (`ACCEPT_*`): six scoped reads for one award year, only
columns already selected by a raw dataset query (so the SQL login's column grants
cover them), and students without a PowerCampus-shaped `alternate_id` are filtered
in SQL so an SSN-shaped value never leaves the database.

Summary of the rules as built:

- Population: `dbo.student` with a `P` + 9 digit `alternate_id` and a
  `stu_award_year` row for the award year. One package per student. If two students
  (or two award year rows) share a `campus_id`, neither is emitted and they are
  counted.
- Status: `withdrawn` if `date_withdrew` is set; `approved` only if
  `packaging_status` is in `PACKAGED_STATUSES` and the package has no notes;
  otherwise `draft`.
- Awards: `stu_award.status` through `AWARD_STATUS_MAP`; other statuses are skipped
  and counted. Category from `funds.fund_type`: `L` loan, `J` work, `G` scholarship
  when `fund_source` is `I` and `fund_family` is in `SCHOLARSHIP_FAMILIES`, else
  grant. Other fund types are skipped, counted, and (beyond the brief) noted so the
  package stays draft. `featured` is the single largest scholarship (tie:
  alphabetical label).
- Fall/spring: scheduled amounts per award by `poe.attend_desc` (`^fall`,
  `^spring`, case-insensitive). No schedule: even split, odd cent to fall, with a
  note. Non fall/spring disbursements and schedule/amount mismatches add notes.
- Costs and housing: `stu_ay_sum_data` lines (`TUITION_FEES`, `HOUSING_MEALS`,
  `BOOKS`, `TRANSPORT`, `PERSONAL`), zero or null lines omitted, annual split evenly
  with the odd cent to fall. Tuition null or 0 adds `no cost of attendance`.
  `housingPlan` is `On campus` when `tot_room_board > 0`.

## Units and clock

PowerFAIDS money is whole dollars. Checked 2026-10-12 against the 2026-2027 rows of
the raw `need_summary` and `student_awards` datasets (aggregates only): median
`tot_tuition_fees` 33240, median `tot_room_board` 15704, median `actual_amt` 3500, no
fractional values. The transform multiplies by 100 using `Decimal`.

`created_dt`/`modified_dt` are naive local (America/New_York) time: the newest value
(03:21 on 2026-10-12) sits just before the 03:51 ET pull. They are converted to UTC.

## What the 2027-2028 data looks like today (2026-10-12 pull)

Counts only: 6,961 `stu_award_year` rows; `packaging_status` is null on all of them;
none withdrawn; no student has more than one row; no duplicate `campus_id`; 219 rows
have no PowerCampus ID and are excluded. 41 awards, all status `A`, all fund type `G`
with fund source `F` (federal grants, so category `grant`, none `scholarship`), every
award has a Fall and a Spring scheduled row. 5,261 rows have no tuition budget yet.
Expected output right now: every package is `draft` (or carries "no cost of
attendance"), none `approved`.

## What Financial Aid must confirm before LIVE_LETTERS_ENABLED

1. `PACKAGED_STATUSES`: which `stu_award_year.packaging_status` code(s) mean the
   package is final. Empty today, so nothing can be approved.
2. `AWARD_STATUS_MAP`: `O` offered, `A` accepted, `D` declined, and that every other
   status (cancelled, etc.) should be left off the letter. Only `A` exists so far.
3. `SCHOLARSHIP_FAMILIES` and `SCHOLARSHIP_FUND_SOURCE`: which funds are shown as
   scholarships versus grants (and the odd `AdmissioPT` spelling), plus loan `L` and
   work `J` fund types. Also whether a declined scholarship can be the featured one.
4. Housing rule: `On campus` when `tot_room_board > 0`, else `Commuter`.
5. Dollars versus cents: confirm whole dollars (the data says so) and that the cost
   lines, including `tot_other_budget` as "Personal expenses" and the even fall/spring
   split of annual costs, match what the letter should show.
6. Fall/spring: terms are read from `poe.attend_desc`; summer and other terms are left
   out of both columns and flagged.
7. A sample comparison of the export against PowerFAIDS screens.

## Tests

```bash
PYTHONPATH=services/publishers python3 -m unittest discover -s services/publishers/powerfaids -t services/publishers/powerfaids
```

Covers the transform (`test_acceptance.py`), the new SQL under the same guard,
exclusion and column-grant tests as the raw queries, and handler behavior including
write order (`test_handler.py`).
