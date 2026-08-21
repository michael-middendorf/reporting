import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cycleForTerm,
  normalizeDate,
  pickAdmissionsApp,
  processWithdrawals,
  statsFrom,
  type WithdrawalRow,
} from "./withdrawals";

test("normalizeDate accepts slash and ISO", () => {
  assert.equal(normalizeDate("4/7/2026"), "2026-04-07");
  assert.equal(normalizeDate("2026-04-07"), "2026-04-07");
  assert.equal(normalizeDate(""), "");
});

test("cycleForTerm maps Fall+following Spring together", () => {
  assert.equal(cycleForTerm("Fall 2026"), "fa26");
  assert.equal(cycleForTerm("Spring 2027"), "fa26");
  assert.equal(cycleForTerm("Summer 2026"), "fa26");
  assert.equal(cycleForTerm("Fall 2027"), "fa27");
  assert.equal(cycleForTerm("Spring 2028"), "fa27");
  assert.equal(cycleForTerm("Fall 2025"), "fa25");
  assert.equal(cycleForTerm(""), "other");
});

test("processWithdrawals splits Enrolled / Deferred / other", () => {
  const wd = [
    { PersonReferenceID: "P1", Name: "One", WithdrawnType: "Withdrawn Enrolled", WithdrawnDate: "2026-03-01" },
    { PersonReferenceID: "P2", Name: "Two", WithdrawnType: "Withdrawn Deferred", WithdrawnDate: "2026-04-01" },
    { PersonReferenceID: "P3", Name: "Three", WithdrawnType: "Withdrawn Accepted", WithdrawnDate: "2026-05-01" },
    { PersonReferenceID: "P4", Name: "Four", WithdrawnType: "Withdrawn No Decision", WithdrawnDate: "2026-05-02" },
  ];
  const adm = [
    { PersonReferenceID: "P1", ApplicationTerm: "Fall 2026", WithdrawnDate: "2026-03-01", DepositCode: "EN", WithdrawnCode: "WT" },
    { PersonReferenceID: "P2", ApplicationTerm: "Spring 2027", WithdrawnDate: "2026-04-01", WithdrawnCode: "WT" },
    { PersonReferenceID: "P3", ApplicationTerm: "Fall 2026", WithdrawnDate: "2026-05-01", WithdrawnCode: "WT" },
    { PersonReferenceID: "P4", ApplicationTerm: "Fall 2026", WithdrawnDate: "2026-05-02", WithdrawnCode: "WT" },
  ];
  const out = processWithdrawals(wd, adm);
  assert.equal(out.fa26.deposits.total, 1);
  assert.equal(out.fa26.deferred.total, 1);
  assert.equal(out.fa26.otherCount, 2);
  assert.equal(out.otherCount, 2);
  assert.equal(out.fa27.deposits.total, 0);
  assert.equal(out.fa26.deposits.rows[0].name, "One");
  assert.equal(out.fa26.deferred.rows[0].name, "Two");
});

test("pickAdmissionsApp uses matching WithdrawnDate over a second app", () => {
  const apps = [
    { PersonReferenceID: "P1", ApplicationTerm: "Fall 2025", WithdrawnDate: "2025-01-01", WithdrawnCode: "WT" },
    { PersonReferenceID: "P1", ApplicationTerm: "Fall 2026", WithdrawnDate: "2026-06-11", DepositCode: "EN", WithdrawnCode: "WT" },
  ];
  const picked = pickAdmissionsApp(
    { PersonReferenceID: "P1", WithdrawnDate: "6/11/2026", WithdrawnType: "Withdrawn Enrolled" },
    apps,
    "deposits",
  );
  assert.equal(picked?.ApplicationTerm, "Fall 2026");
});

test("multi-app without date match prefers DepositCode for deposits", () => {
  const apps = [
    { PersonReferenceID: "P1", ApplicationTerm: "Fall 2025", WithdrawnCode: "WT" },
    { PersonReferenceID: "P1", ApplicationTerm: "Fall 2026", DepositCode: "EN", WithdrawnCode: "WT" },
  ];
  const picked = pickAdmissionsApp(
    { PersonReferenceID: "P1", WithdrawnDate: "2026-08-01" },
    apps,
    "deposits",
  );
  assert.equal(picked?.ApplicationTerm, "Fall 2026");
});

test("unknown WithdrawnType counts as other, not a cohort row", () => {
  const out = processWithdrawals(
    [{ PersonReferenceID: "P9", Name: "X", WithdrawnType: "Something Else", WithdrawnDate: "2026-01-01" }],
    [{ PersonReferenceID: "P9", ApplicationTerm: "Fall 2026" }],
  );
  assert.equal(out.fa26.deposits.total, 0);
  assert.equal(out.fa26.deferred.total, 0);
  assert.equal(out.fa26.otherCount, 1);
  assert.equal(out.otherCount, 1);
});

test("blank reasons become Unspecified in byReason", () => {
  const rows: WithdrawalRow[] = [
    {
      personReferenceId: "P1",
      name: "A",
      term: "Fall 2026",
      cycle: "fa26",
      ac: "abel.cordero",
      withdrawnDate: "2026-03-02",
      enrollingDate: "",
      depositDate: "",
      athlete: "Athlete",
      sport: "",
      scholarship: "",
      reason: "",
      otherSchool: "",
      kind: "deposits",
    },
    {
      personReferenceId: "P2",
      name: "B",
      term: "Fall 2026",
      cycle: "fa26",
      ac: "abel.cordero",
      withdrawnDate: "2026-03-01",
      enrollingDate: "",
      depositDate: "",
      athlete: "Non-Athlete",
      sport: "",
      scholarship: "",
      reason: "Financial",
      otherSchool: "",
      kind: "deposits",
    },
  ];
  const s = statsFrom(rows);
  assert.equal(s.byReason.Unspecified, 1);
  assert.equal(s.byReason.Financial, 1);
  assert.equal(s.athlete, 1);
  assert.equal(s.nonAthlete, 1);
  assert.equal(s.rows[0].name, "A");
  assert.equal(s.latestDate, "2026-03-02");
});
