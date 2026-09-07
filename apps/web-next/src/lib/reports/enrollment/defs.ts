/** Hover-tip copy for enrollment KPIs, charts, and table counts. */
export const DEFS = {
  ug: "Undergraduate only: First-Year, Transfer, Re-Admission, and Second Degree. Graduate and Dual Enrollment are excluded.",
  yoy: "The prior column is year-over-year: this calendar date last year, not the finished prior cycle.",
  created:
    "Undergraduate apps with a Slate Created Date. Current cycle: the date is present. Prior cycle: Created Date on or before this date last year.",
  submitted:
    "Undergraduate apps with an Application Submitted Date. Current cycle: the date is present. Prior cycle: submitted on or before this date last year. Created Date can be earlier than Submitted Date.",
  accepted:
    "Undergraduate apps with an Accept Code. Current cycle: the code is present. Prior cycle: Accept Date on or before this date last year.",
  acceptRate: "Accepted divided by Submitted.",
  yield:
    "Gross deposits (any Deposit Date) divided by Accepted. Later withdrawals are still in the numerator.",
  conditional: "Accepted apps whose Accept Code is CA (Conditional Accept).",
  interviewed:
    "Apps with Interview Status = Interviewed. Prior cycle uses that term's interview date on or before this date last year.",
  acRec3:
    "UG apps with AC interview rec 3 on the 1-4 scale (Slate Interview AC Rec 25/26). Counts start FA26. FA25 and earlier used a 0-3 rec and are not included. Current cycle: the rating is present. Prior cycle (FA27 vs FA26 only): rating is 3 and that term's interview date is on or before this date last year.",
  acRec4:
    "UG apps with AC interview rec 4 on the 1-4 scale (Slate Interview AC Rec 25/26). Counts start FA26. FA25 and earlier used a 0-3 rec and are not included. Current cycle: the rating is present. Prior cycle (FA27 vs FA26 only): rating is 4 and that term's interview date is on or before this date last year.",
  acRec34:
    "UG apps with AC interview rec 3 or 4 on the 1-4 scale (Slate Interview AC Rec 25/26). Counts start FA26. FA25 and earlier used a 0-3 rec and are not included. Current cycle: the rating is present. Prior cycle (FA27 vs FA26 only): rating is 3 or 4 and that term's interview date is on or before this date last year.",
  acRecHistory:
    "Same calendar date in each recruiting cycle on the 1-4 rec scale (Slate Interview AC Rec 25/26). Counts start FA26. FA25 and earlier used a 0-3 rec and are not included. FA27 history is FA26 (this date last year) plus FA27 (today). FA26 history is FA26 only.",
  acRecChart:
    "Rec 3s, Rec 4s, and Rec 3s & 4s for the selected cycle. UG apps with AC interview rec 3 or 4 on the 1-4 scale (Slate Interview AC Rec 25/26). Counts start FA26. FA25 and earlier used a 0-3 rec and are not included.",
  depositsGross: "Apps with a Deposit Date, including people who later withdrew.",
  depositsWithdrawn: "Apps that have both a Deposit Date and a Withdrawn Date.",
  depositsNet:
    "Net deposits: Deposit Date present and Withdrawn Date empty. This is Total Deposits.",
  denied: "Apps with a Denied Code. Prior cycle: Denied Date on or before this date last year.",
  delta7d:
    "How many of this event happened in the trailing 7 days (inclusive). Not the change in the running total.",
  history:
    "Same calendar date in each recruiting cycle. The selected term is today; the prior term is this date last year; the term before that is this date two years ago.",
  historyCreated: "Created Date on or before that cycle's as-of date.",
  historySubmitted: "Application Submitted Date on or before that cycle's as-of date.",
  historyAccepted: "Accept Code with Accept Date on or before that cycle's as-of date.",
  historyDeposits:
    "Net deposits as of that cycle's as-of date: deposited by then and not withdrawn by then.",
  gpa: "Average Self-Reported HS GPA among values greater than 0 and at most 5.",
  act: "Average ACT among scores greater than 0.",
  sat: "Average SAT among scores greater than 0.",
  clt: "Average CLT among scores greater than 0.",
  daysSubmitAccept:
    "Median days from Application Submitted Date to Accept Date, among accepted apps where both dates exist and accept is on or after submit.",
  daysAcceptDeposit:
    "Median days from Accept Date to Deposit Date, among net deposits where both dates exist and deposit is on or after accept.",
  aidUnfunded: "Average Unfunded Aid among apps in this group with unfunded aid greater than 0.",
  aidFunded: "Average total scholarship minus average unfunded aid, when both averages exist.",
  aidTotal: "Average Scholarship Amount among apps in this group with scholarship greater than 0.",
  aidDr: "That aid average divided by tuition ($33,315).",
  religion:
    "Catholic = Religion is Catholic. Other is everyone else. Apps use created records; Accepted uses accept-code records; Deposited uses net deposits.",
  gender:
    "Male / Female from Slate Gender (M / F). Apps = created, Accepted = accept code, Deposited = net deposits.",
  counselor:
    "Funnel by Application AC Assignment for the selected cycle. Deposited is net (deposit date, not withdrawn).",
  interviewsByAc: "Interviewed apps by assigned admissions counselor.",
  caseload: "Created applications by assigned admissions counselor.",
  acceptCodes: "Accepted apps in the current cycle, grouped by Accept Code (AT, CA, ADMI, CMRV, CTA, …).",
  ameRegistrants:
    "AME form rows with Registration Status Registered or Attended, grouped by event month (Form Start Date). Cancelled and No Show are excluded.",
  ameRegisteredStatus:
    "AME Registration Status = Registered (not yet attended) for that event month.",
  ameAttendedMonth: "AME Registration Status = Attended for that event month.",
  pswRegisteredStatus: "PSW Registration Status = Registered for that January weekend.",
  ameYoy:
    "Prior AME counts only include people whose AME form Submission Date was on or before this date last year.",
  ameTotal:
    "AME form rows whose event date falls in the selected term's fiscal year (July 1–June 30). Fall 2027 is 7/1/2026–6/30/2027.",
  ameFyRegistered:
    "AME Registration Status Registered plus Attended in the selected term's fiscal year (July 1–June 30).",
  ameFyAttended: "AME Registration Status = Attended in the selected term's fiscal year.",
  ameFyCancelled: "AME Registration Status = Cancelled in the selected term's fiscal year.",
  ameFyNoShow: "AME Registration Status = No Show in the selected term's fiscal year.",
  campusTotal: "All campus-visit form rows in the extract.",
  campusAttended: "Campus visits with Registration Status = Attended.",
  campusRegistered:
    "Campus visits with Registration Status Registered or Attended (people still on the books, including those who already attended).",
  campusCancelled: "Campus visits with Registration Status = Cancelled.",
  campusNoShow: "Campus visits with Registration Status = No Show.",
  pswRegistrants:
    "PSW signups that are not Cancelled, grouped by the January event date (Form Start Date), not the student's application term. Prior cycle uses Form Submission Date on or before this date last year.",
  pswAttended: "Registration Status = Attended for that January weekend.",
  pswNoShow: "Registration Status = No Show for that January weekend.",
  pswCancelled: "Registration Status = Cancelled for that January weekend.",
  pswTotal:
    "All PSW form submissions for that January weekend, including no-shows and cancellations.",
  pswRate: "Attended divided by total registrations (including no-shows and cancellations).",
  slcRegistrants:
    "SLC rows with Registration Status Registered or Attended. FA25 uses last year's ISLC extract; FA26 uses this year's SLC; FA27 is not in the extract yet. Prior cycle is gated on form submission date.",
  slcApplied: "SLC application rows in the extract.",
  slcAccepted: "SLC_Accepted = Accepted.",
  slcRegistered: "SLC Registration Status is Registered or Attended.",
  slcAttended: "SLC Registration Status = Attended.",
  slcDenied: "SLC_Denied = Denied.",
  slcClass: "SLC applications split by high-school class year.",
  slcSession: "Registered or Attended SLC students by session start date and gender.",
  slcBin: "Count of SLC records in each workflow bin / status.",
  wdDeposits: "Students coded Withdrawn Enrolled: they deposited, then withdrew.",
  wdDeferred: "Students coded Withdrawn Deferred.",
  wdAthlete: "Withdrawn deposits whose athlete field indicates athlete (not non-athlete).",
  wdNonAthlete: "Withdrawn deposits that are not coded as athlete.",
  wdInView: "Rows in the table after the cohort, search, and athlete filters.",
  wdCounselors: "Distinct admissions counselors on the rows currently in view.",
  wdLatest: "Most recent withdrawn date among the rows currently in view.",
  wdByAc: "Withdrawals in view, counted by assigned admissions counselor.",
  wdByReason: "Withdrawals in view, counted by withdrawal reason.",
} as const;
