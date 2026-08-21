import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityByAC,
  emptyAcFunnel,
  isActivityCounselorKey,
} from "./counselors";
import { _procAdm, _procAME, _procPSW, _termStats } from "./process.js";

function row(partial: Record<string, unknown> = {}) {
  return {
    ApplicationTerm: "Fall 2027",
    ApplicationStudentType: "First-Year",
    ApplicationACAssignment: "abel.cordero",
    ...partial,
  };
}

test("UG student types count; Graduate and Dual Enrollment do not", () => {
  const rows = [
    row({ ApplicationStudentType: "First-Year" }),
    row({ ApplicationStudentType: "Transfer", ApplicationACAssignment: "lillian.doyle" }),
    row({ ApplicationStudentType: "Re-Admission", ApplicationACAssignment: "caroline.g.savoie" }),
    row({ ApplicationStudentType: "Second Degree", ApplicationACAssignment: "madelyn.r.byers" }),
    row({
      ApplicationStudentType: "Graduate",
      ApplicationACAssignment: "danielle.d.domino",
      AcceptCode: "AT",
    }),
    row({
      ApplicationStudentType: "Dual Enrollment",
      ApplicationACAssignment: "georgiana.e.depugh",
    }),
  ];
  const stats = _termStats(rows, 2027, new Date("2026-08-20"));
  assert.equal(stats.created, 4);
  assert.equal(stats.accepted, 0);
  assert.equal(stats.byAC["abel.cordero"].created, 1);
  assert.equal(stats.byAC["lillian.doyle"].created, 1);
  assert.equal(stats.byAC["caroline.g.savoie"].created, 1);
  assert.equal(stats.byAC["madelyn.r.byers"].created, 1);
  assert.equal(stats.byAC["danielle.d.domino"], undefined);
  assert.equal(stats.byAC["georgiana.e.depugh"], undefined);
});

test("current UG roster is always present in byAC; leftover assignees are omitted", () => {
  const rows = [
    row({ ApplicationACAssignment: "abel.cordero" }),
    row({ ApplicationACAssignment: "dan.donaldson" }),
    row({ ApplicationACAssignment: "annie.esposito" }),
    row({ ApplicationACAssignment: "anna.kaminski", ApplicationStudentType: "Graduate" }),
    row({ ApplicationACAssignment: "" }),
  ];
  const stats = _termStats(rows, 2027, new Date("2026-08-20"));
  assert.ok(stats.byAC["abel.cordero"]);
  assert.ok(stats.byAC["katherine.n.lyons"]); // zero-filled current AC
  assert.equal(stats.byAC["katherine.n.lyons"].created, 0);
  assert.equal(stats.byAC[""].created, 1);
  assert.equal(stats.byAC["dan.donaldson"], undefined);
  assert.equal(stats.byAC["annie.esposito"], undefined);
  assert.equal(stats.byAC["anna.kaminski"], undefined);
  // leftover UG assignee is still in the funnel total
  assert.equal(stats.created, 4);
});

test("allRows stays unfiltered so the Fall report can apply its own type filter", () => {
  const rows = [
    row({ ApplicationStudentType: "Graduate", ApplicationACAssignment: "danielle.d.domino" }),
    row({ ApplicationStudentType: "First-Year" }),
  ];
  const adm = _procAdm(rows, "2026-08-20");
  assert.equal(adm.allRows.length, 2);
  assert.equal(adm.fa27.created, 1);
});

test("enrollment funnel drops graduate and dual enrollment", () => {
  const rows = [
    row({ ApplicationTerm: "Fall 2027", ApplicationStudentType: "First-Year", CreatedDate: "2026-08-01" }),
    row({ ApplicationTerm: "Fall 2027", ApplicationStudentType: "Graduate", CreatedDate: "2026-08-01" }),
    row({ ApplicationTerm: "Fall 2027", ApplicationStudentType: "Dual Enrollment", CreatedDate: "2026-08-01" }),
    row({ ApplicationTerm: "Fall 2026", ApplicationStudentType: "Transfer", CreatedDate: "2025-08-01" }),
    row({ ApplicationTerm: "Fall 2026", ApplicationStudentType: "Graduate", CreatedDate: "2025-08-01" }),
  ];
  const adm = _procAdm(rows, "2026-08-21");
  assert.equal(adm.fa27.created, 1);
  assert.equal(adm.fa26.created, 1);
  assert.equal(adm.fa26Yoy.created, 1);
});

test("PSW YoY uses FormSubmissionDate and is 0 when nobody had signed up yet", () => {
  const rows = [
    {
      Term: "Fall 2026",
      RegistrationStatus: "Attended",
      FormCreatedDate: "2025-11-10",
      FormStartDateTime: "2026-01-16",
      FormSubmissionDate: "2025-12-01",
    },
    {
      Term: "Fall 2025",
      RegistrationStatus: "Attended",
      FormCreatedDate: "2024-11-01",
      FormStartDateTime: "2025-01-17",
      FormSubmissionDate: "2024-12-01",
    },
  ];
  const psw = _procPSW(rows, "2026-08-21");
  assert.equal(psw.byCycle["Fall 2026"].total, 1);
  assert.equal(psw.byCycleYoy["Fall 2026"], undefined);
  assert.equal(psw.byCycleYoy["Fall 2025"].total, 1);
});

test("AME overview counts registrants and YoY-gates the prior cycle", () => {
  const rows = [
    { FormStartDateTime: "2026-09-12", RegistrationStatus: "Registered", SubmissionDate: "2026-08-01" },
    { FormStartDateTime: "2025-09-10", RegistrationStatus: "Attended", SubmissionDate: "2025-07-01" },
    { FormStartDateTime: "2025-09-10", RegistrationStatus: "Registered", SubmissionDate: "2025-09-01" },
    { FormStartDateTime: "2025-09-10", RegistrationStatus: "Cancelled", SubmissionDate: "2025-06-01" },
  ];
  const ame = _procAME(rows, "2026-08-21");
  assert.equal(ame.byCycle["Fall 2027"].Sep.registrants, 1);
  assert.equal(ame.byCycle["Fall 2026"].Sep.registrants, 2);
  assert.equal(ame.byCycleYoy["Fall 2026"].Sep.registrants, 1);
});

test("activityByAC drops Danielle, Georgiana, Anna, and Annie; keeps Unassigned when present", () => {
  const byAC = {
    "abel.cordero": { ...emptyAcFunnel(), created: 10, deposited: 2 },
    "danielle.d.domino": { ...emptyAcFunnel(), created: 2 },
    "georgiana.e.depugh": { ...emptyAcFunnel(), created: 1 },
    "anna.kaminski": { ...emptyAcFunnel(), created: 49 },
    "annie.esposito": { ...emptyAcFunnel(), created: 8 },
    "": { ...emptyAcFunnel(), created: 23 },
  };
  const view = activityByAC(byAC);
  assert.equal(view["danielle.d.domino"], undefined);
  assert.equal(view["georgiana.e.depugh"], undefined);
  assert.equal(view["anna.kaminski"], undefined);
  assert.equal(view["annie.esposito"], undefined);
  assert.equal(view[""].created, 23);
  assert.equal(view["abel.cordero"].created, 10);
  assert.equal(isActivityCounselorKey("danielle.d.domino"), false);
  assert.equal(isActivityCounselorKey("georgiana.e.depugh"), false);
  assert.equal(isActivityCounselorKey("anna.kaminski"), false);
  assert.equal(isActivityCounselorKey("annie.esposito"), false);
  assert.equal(isActivityCounselorKey("abel.cordero"), true);
  assert.equal(isActivityCounselorKey(""), true);
});
