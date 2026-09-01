import assert from "node:assert/strict";
import { test } from "node:test";
import type { Resident } from "../housing/types";
import { censusResidencyOf, isLikelyUgResident, residencyFromErez } from "./residency";

test("eRez price types map to FA25 residency buckets", () => {
  assert.equal(censusResidencyOf({ building: "JPII", price_type: "UGDP" }), "On Campus");
  assert.equal(censusResidencyOf({ building: "Commuter", price_type: "NODM" }), "Commuter");
  assert.equal(censusResidencyOf({ building: "CIARA", price_type: "ISTA" }), "Ireland");
  assert.equal(censusResidencyOf({ building: "MALAC", price_type: "ISTA" }), "Ireland");
  assert.equal(censusResidencyOf({ building: "", price_type: "RSTA" }), "Rome");
  assert.equal(censusResidencyOf({ session: "03MM" }), "Mont Mallary");
  assert.equal(censusResidencyOf({ building: "", price_type: "CSTA" }), "Study Abroad");
  assert.equal(censusResidencyOf({ building: "MBK", price_type: "M2FU" }), "Other");
});

test("graduates and dual enrollment are not in the UG residency mix", () => {
  assert.equal(isLikelyUgResident({ class_status: "Freshman" }), true);
  assert.equal(isLikelyUgResident({ class_status: "Graduate" }), false);
  assert.equal(isLikelyUgResident({ college_attend: "DUAL" }), false);
  assert.equal(isLikelyUgResident({}), true);
});

test("unassigned UG are the census headcount not found in eRez", () => {
  const residents: Resident[] = [
    { pcid: "1", building: "JPII", price_type: "UGDP", class_status: "Freshman" },
    { pcid: "2", building: "Commuter", price_type: "NODM", class_status: "Sophomore" },
    { pcid: "3", building: "CIARA", price_type: "ISTA", class_status: "Junior" },
    { pcid: "4", building: "MBK", price_type: "M2FU", class_status: "Graduate" },
  ];
  const result = residencyFromErez(residents, 5);
  assert.equal(result.housing.ugMatched, 3);
  assert.equal(result.housing.unassigned, 2);
  assert.deepEqual(
    result.rows.map((r) => [r.label, r.n]),
    [
      ["Commuter", 1],
      ["On Campus", 1],
      ["Ireland", 1],
      ["Unassigned", 2],
    ],
  );
  assert.equal(result.ugOnCampusPct, 1 / 5);
});
