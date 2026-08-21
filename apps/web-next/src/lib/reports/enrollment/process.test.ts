import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityByAC,
  emptyAcFunnel,
  isActivityCounselorKey,
} from "./counselors";
import { _procAdm, _termStats } from "./process.js";

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
    row({ ApplicationACAssignment: "anna.kaminski", ApplicationStudentType: "Graduate" }),
    row({ ApplicationACAssignment: "" }),
  ];
  const stats = _termStats(rows, 2027, new Date("2026-08-20"));
  assert.ok(stats.byAC["abel.cordero"]);
  assert.ok(stats.byAC["katherine.n.lyons"]); // zero-filled current AC
  assert.equal(stats.byAC["katherine.n.lyons"].created, 0);
  assert.equal(stats.byAC[""].created, 1);
  assert.equal(stats.byAC["dan.donaldson"], undefined);
  assert.equal(stats.byAC["anna.kaminski"], undefined);
  // leftover UG assignee is still in the funnel total
  assert.equal(stats.created, 3);
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

test("activityByAC drops Danielle, Georgiana, and Anna; keeps Unassigned when present", () => {
  const byAC = {
    "abel.cordero": { ...emptyAcFunnel(), created: 10, deposited: 2 },
    "danielle.d.domino": { ...emptyAcFunnel(), created: 2 },
    "georgiana.e.depugh": { ...emptyAcFunnel(), created: 1 },
    "anna.kaminski": { ...emptyAcFunnel(), created: 49 },
    "": { ...emptyAcFunnel(), created: 23 },
  };
  const view = activityByAC(byAC);
  assert.equal(view["danielle.d.domino"], undefined);
  assert.equal(view["georgiana.e.depugh"], undefined);
  assert.equal(view["anna.kaminski"], undefined);
  assert.equal(view[""].created, 23);
  assert.equal(view["abel.cordero"].created, 10);
  assert.equal(view["annie.esposito"].created, 0);
  assert.equal(isActivityCounselorKey("danielle.d.domino"), false);
  assert.equal(isActivityCounselorKey("georgiana.e.depugh"), false);
  assert.equal(isActivityCounselorKey("anna.kaminski"), false);
  assert.equal(isActivityCounselorKey("abel.cordero"), true);
  assert.equal(isActivityCounselorKey(""), true);
});
