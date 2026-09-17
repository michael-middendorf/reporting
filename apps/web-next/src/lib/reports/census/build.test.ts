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
  assert.equal(isDegreeSeekingUg({ Program: "GRAD", College_Attend: "GRAD", Degree: "BARTS" }), true);
});

test("FA26 draft snapshot has the registration spine totals", () => {
  assert.equal(snapshot.term, "Fall 2026");
  assert.equal(snapshot.status, "draft");
  assert.equal(snapshot.kpis.allStudents, 1628);
  assert.equal(snapshot.summary.ftca.headcount, 398);
  assert.equal(snapshot.summary.degreeSeeking.headcount, 1400);
  assert.ok(snapshot.pending.length > 0);
});

test("Historical prior years are Fall 2025 Census - NEW.xlsx, not live FA26", () => {
  const h = snapshot.historical;
  assert.deepEqual(h.years, [2026, 2025, 2024, 2023, 2022, 2021, 2020]);
  assert.equal(h.newStudents.hc[1], 458);
  assert.equal(h.ftca.hc[1], 391);
  assert.equal(h.returning.hc[1], 884);
  assert.equal(h.degreeSeeking.hc[1], 1342);
  assert.equal(h.degreeSeeking.fullTime[1], 1333);
  assert.equal(h.totalUndergraduate.hc[1], 1369);
  assert.equal(h.gradMa.hc[1], 19);
  assert.equal(h.gradPhd.hc[1], 23);
  assert.equal(h.gradMba.hc[1], 45);
  assert.equal(h.gradMedcl.hc[1], 31);
  assert.equal(h.gradMaPhil.hc[1], 4);
  assert.equal(h.gradMaCrw.hc[1], 8);
  assert.equal(h.totalGraduate.hc[1], 130);
  assert.equal(h.totalGraduate.fte[1], 107);
  assert.equal(h.totalEnrollment.hc[1], 1499);
  assert.equal(h.totalEnrollment.hc[6], 1149);
  assert.equal(h.totalGraduate.hc[6], 47);
});
