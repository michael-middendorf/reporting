import assert from "node:assert/strict";
import { test } from "node:test";
import { fteFromStatus, isDegreeSeekingUg } from "./types";
import snapshot from "./snapshot.json";

test("FULL / HALF / LESS / THRE FTE weights match last year's census", () => {
  assert.equal(fteFromStatus("FULL"), 1);
  assert.equal(fteFromStatus("THRE"), 0.75);
  assert.equal(fteFromStatus("HALF"), 0.5);
  assert.equal(fteFromStatus("LESS"), 0.25);
  assert.equal(fteFromStatus(""), 0);
  assert.equal(fteFromStatus(null), 0);
});

test("dual enrollment and non-degree are not degree-seeking UG", () => {
  assert.equal(isDegreeSeekingUg({ Program: "UNDERG", College_Attend: "FTCA", Degree: "BARTS" }), true);
  assert.equal(isDegreeSeekingUg({ Program: "UNDERG", College_Attend: "DUAL", Degree: "HSDE" }), false);
  assert.equal(isDegreeSeekingUg({ Program: "NDEG", College_Attend: "ND", Degree: "PENRIC" }), false);
  assert.equal(isDegreeSeekingUg({ Program: "GRAD", College_Attend: "GRAD", Degree: "MBA" }), false);
});

test("FA26 draft snapshot has the registration spine totals", () => {
  assert.equal(snapshot.term, "Fall 2026");
  assert.equal(snapshot.status, "draft");
  assert.equal(snapshot.kpis.allStudents, 1629);
  assert.equal(snapshot.summary.ftca.headcount, 398);
  assert.equal(snapshot.summary.degreeSeeking.headcount, 1400);
  assert.ok(snapshot.pending.length > 0);
});
