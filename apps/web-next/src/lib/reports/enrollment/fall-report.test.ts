import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFallReport,
  canonicalSport,
  isAccepted,
  isConditionalAccepted,
  isNaiaSport,
  mapStudentType,
  type AdmRow,
} from "./fall-report";
import { TUITION } from "./fall-report-config";

function row(partial: AdmRow): AdmRow {
  return {
    ApplicationTerm: "Fall 2026",
    ApplicationStudentType: "First-Year",
    ...partial,
  };
}

test("mapStudentType covers Slate prompt labels", () => {
  assert.equal(mapStudentType("First-Year"), "First-Time Freshmen");
  assert.equal(mapStudentType("First-Time Freshman"), "First-Time Freshmen");
  assert.equal(mapStudentType("Transfer"), "Transfer");
  assert.equal(mapStudentType("Re-Admission"), "Re-Admit");
  assert.equal(mapStudentType("Second Degree"), "Second Bachelor's");
  assert.equal(mapStudentType("Dual Enrollment"), null);
});

test("ADM / COMM / COND count as accepted; CA and COND are conditional", () => {
  assert.equal(isAccepted(row({ AcceptCode: "AT" })), true);
  assert.equal(isAccepted(row({ DecisionCode: "ADM" })), true);
  assert.equal(isAccepted(row({ AllDecisionCodes: "COMM, FOO" })), true);
  assert.equal(isAccepted(row({ DecisionCode: "COND" })), true);
  assert.equal(isAccepted(row({})), false);
  assert.equal(isConditionalAccepted(row({ AcceptCode: "CA" })), true);
  assert.equal(isConditionalAccepted(row({ DecisionCode: "COND" })), true);
  assert.equal(isConditionalAccepted(row({ AcceptCode: "AT" })), false);
});

test("NAIA allowlist matches gender variants and excludes pickleball in FA26", () => {
  assert.equal(canonicalSport("Basketball-Men"), "basketball-men");
  assert.equal(canonicalSport("Men's Basketball"), "basketball-men");
  assert.equal(canonicalSport("Swimming Women"), "swimming-women");
  assert.equal(isNaiaSport("Basketball-Men", 2026), true);
  assert.equal(isNaiaSport("Football", 2026), true);
  assert.equal(isNaiaSport("Pickleball", 2026), false);
  assert.equal(isNaiaSport("Ultimate Frisbee", 2026), false);
  assert.equal(isNaiaSport("Rugby", 2026), false);
});

test("student-type matrix composite sums and Dual Enrollment is excluded", () => {
  const rows: AdmRow[] = [
    row({ ApplicationStudentType: "First-Year" }),
    row({ ApplicationStudentType: "First-Year", AcceptCode: "AT", DepositCode: "ENR", DepositDate: "2026-01-15" }),
    row({ ApplicationStudentType: "Transfer", AcceptCode: "AT" }),
    row({ ApplicationStudentType: "Re-Admission" }),
    row({ ApplicationStudentType: "Second Degree", AcceptCode: "AT", DepositCode: "ENR", DepositDate: "2026-02-01" }),
    row({ ApplicationStudentType: "Dual Enrollment", AcceptCode: "AT" }),
  ];
  const rpt = buildFallReport(rows, 2026, "2026-08-20");
  assert.deepEqual(rpt.years, [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  const fresh = rpt.byStudentType.rows.find((r) => r.label === "First-Time Freshmen")!;
  assert.equal(fresh.apps[2026], 2);
  assert.equal(fresh.accepted[2026], 1);
  assert.equal(fresh.deposits[2026], 1);
  assert.equal(rpt.byStudentType.composite.apps[2026], 5);
  assert.equal(rpt.byStudentType.composite.accepted[2026], 3);
  assert.equal(rpt.byStudentType.composite.deposits[2026], 2);
});

test("current-year FINAL is N/A; prior FINAL/GOAL come from config", () => {
  const rpt = buildFallReport([row({})], 2026, "2026-08-20");
  assert.equal(rpt.byStudentType.final.apps[2026], null);
  assert.equal(rpt.byStudentType.final.deposits[2025], 457);
  assert.equal(rpt.byStudentType.goal.apps[2024], 3220);
  assert.equal(rpt.byStudentType.goal.apps[2026], null);
});

test("application status counts denied, withdrawn deposit, conditional, interviewed", () => {
  const rows: AdmRow[] = [
    row({}),
    row({ DeniedCode: "DN" }),
    row({
      AcceptCode: "AT",
      DepositCode: "ENR",
      DepositDate: "2026-01-10",
      WithdrawnCode: "WD",
      WithdrawnDate: "2026-03-01",
    }),
    row({ AcceptCode: "CA" }),
    row({ InterviewStatus: "Interviewed" }),
  ];
  const rpt = buildFallReport(rows, 2026, "2026-08-20");
  assert.equal(rpt.status.total, 5);
  assert.equal(rpt.status.denied, 1);
  assert.equal(rpt.status.withdrawnDeposit, 1);
  assert.equal(rpt.status.conditionalAccepted, 1);
  assert.equal(rpt.status.interviewed, 1);
});

test("NAIA vs others splits active deposits by sport allowlist", () => {
  const rows: AdmRow[] = [
    row({ Sport: "Football", AcceptCode: "AT", DepositCode: "ENR", DepositDate: "2026-01-01" }),
    row({ Sport: "Basketball-Women", AcceptCode: "AT", DepositCode: "ENR", DepositDate: "2026-01-01" }),
    row({ Sport: "Pickleball", AcceptCode: "AT", DepositCode: "ENR", DepositDate: "2026-01-01" }),
    row({ Sport: "", AcceptCode: "AT", DepositCode: "ENR", DepositDate: "2026-01-01" }),
  ];
  const rpt = buildFallReport(rows, 2026, "2026-08-20");
  assert.equal(rpt.naiaDeposits.total, 4);
  assert.equal(rpt.naiaDeposits.athletes, 2);
  assert.equal(rpt.naiaDeposits.nonAthletes, 2);
  assert.equal(rpt.naiaDeposits.athletePct, 50);
});

test("religion and gender slices add to 100% within a stage", () => {
  const rows: AdmRow[] = [
    row({ Religion: "Catholic", Gender: "M" }),
    row({ Religion: "Catholic", Gender: "F", AcceptCode: "AT" }),
    row({ Religion: "Baptist", Gender: "M", AcceptCode: "AT" }),
    row({ Religion: "Catholic", Gender: "F", AcceptCode: "AT", DepositCode: "ENR", DepositDate: "2026-01-01" }),
  ];
  const rpt = buildFallReport(rows, 2026, "2026-08-20");
  const rel = rpt.religion.overall;
  assert.equal(rel.catholic.apps.n + rel.other.apps.n, 4);
  assert.ok(rel.catholic.apps.pct != null && rel.other.apps.pct != null);
  assert.equal(Math.round(rel.catholic.apps.pct + rel.other.apps.pct), 100);
  const gen = rpt.gender.overall;
  assert.equal(gen.male.apps.n + gen.female.apps.n, 4);
  assert.equal(Math.round((gen.male.apps.pct || 0) + (gen.female.apps.pct || 0)), 100);
});

test("$0 unfunded aid is excluded from averages; discount rate uses tuition", () => {
  const rows: AdmRow[] = [
    row({ AcceptCode: "AT", UnfundedAid: "10000" }),
    row({ AcceptCode: "AT", UnfundedAid: "0" }),
    row({ AcceptCode: "AT", UnfundedAid: "" }),
    row({
      AcceptCode: "AT",
      DepositCode: "ENR",
      DepositDate: "2026-01-01",
      UnfundedAid: "20000",
    }),
  ];
  const rpt = buildFallReport(rows, 2026, "2026-08-20");
  assert.equal(rpt.aid.accepted[2026].aid, (10000 + 20000) / 2);
  assert.ok(rpt.aid.accepted[2026].dr != null);
  assert.equal(rpt.aid.accepted[2026].dr, ((15000 / TUITION) * 100));
  assert.equal(rpt.aid.deposited[2026].aid, 20000);
});

test("test scores are freshman-only and split accepted-not-dep vs deposited", () => {
  const rows: AdmRow[] = [
    row({
      ApplicationStudentType: "First-Year",
      AcceptCode: "AT",
      ACT: "28",
      SAT: "1200",
      "Self-ReportedHSGPA": "3.8",
      HonorsDecision: "Awarded",
    }),
    row({
      ApplicationStudentType: "First-Year",
      AcceptCode: "AT",
      DepositCode: "ENR",
      DepositDate: "2026-01-01",
      ACT: "24",
      SAT: "1100",
      CLT: "80",
      "Self-ReportedHSGPA": "3.5",
    }),
    row({
      ApplicationStudentType: "Transfer",
      AcceptCode: "AT",
      ACT: "35",
      SAT: "1600",
      "Self-ReportedHSGPA": "4.0",
    }),
    row({
      ApplicationTerm: "Fall 2025",
      ApplicationStudentType: "First-Year",
      AcceptCode: "AT",
      DepositCode: "ENR",
      DepositDate: "2025-01-01",
      ACT: "26",
      "Self-ReportedHSGPA": "3.6",
    }),
  ];
  const rpt = buildFallReport(rows, 2026, "2026-08-20");
  assert.equal(rpt.scores.acceptedNotDep.n, 1);
  assert.equal(rpt.scores.acceptedNotDep.act.avg, 28);
  assert.equal(rpt.scores.acceptedNotDep.act.n, 1);
  assert.equal(rpt.scores.acceptedNotDep.honorsN, 1);
  assert.equal(rpt.scores.activeDeposited.n, 1);
  assert.equal(rpt.scores.activeDeposited.act.avg, 24);
  assert.equal(rpt.scores.priorClass.n, 1);
  assert.equal(rpt.scores.priorClass.act.avg, 26);
  assert.equal(rpt.scores.priorClassLabel, "Fall 2025 Class");
});

test("resident vs commuter uses classified deposits for completed years only", () => {
  const rows: AdmRow[] = [
    row({
      ApplicationTerm: "Fall 2025",
      AcceptCode: "AT",
      DepositCode: "ENR",
      DepositDate: "2025-01-01",
      ResidencyPreference: "Resident",
    }),
    row({
      ApplicationTerm: "Fall 2025",
      AcceptCode: "AT",
      DepositCode: "ENR",
      DepositDate: "2025-01-01",
      ResidencyPreference: "Commuter",
    }),
    row({
      ApplicationTerm: "Fall 2026",
      AcceptCode: "AT",
      DepositCode: "ENR",
      DepositDate: "2026-01-01",
      ResidencyPreference: "Resident",
    }),
  ];
  const rpt = buildFallReport(rows, 2026, "2026-08-20");
  assert.equal(rpt.hasResidencyField, true);
  assert.ok(!rpt.residentYears.includes(2026));
  assert.equal(rpt.residentCommuter[2025].resident.n, 1);
  assert.equal(rpt.residentCommuter[2025].commuter.n, 1);
  assert.equal(rpt.residentCommuter[2025].resident.pct, 50);
});
