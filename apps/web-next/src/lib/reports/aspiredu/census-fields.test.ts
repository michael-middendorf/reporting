import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CensusRawStudent } from "../census/lists-core";
import { CENSUS_FIELDS, CENSUS_PROFILE_GROUPS, CENSUS_RAW_KEYS, censusProfileGroups } from "./census-fields";

function student(overrides: Partial<CensusRawStudent> = {}): CensusRawStudent {
  const base = Object.fromEntries(CENSUS_RAW_KEYS.map((k) => [k, ""])) as unknown as CensusRawStudent;
  return { ...base, declaredMajors: [], ...overrides };
}

describe("census-fields spec", () => {
  it("covers every CensusRawStudent key exactly once", () => {
    const used = CENSUS_FIELDS.flatMap((f) => f.keys);
    assert.equal(new Set(used).size, used.length, "a census key is used by two columns");
    assert.deepEqual([...used].sort(), [...CENSUS_RAW_KEYS].sort());
    assert.equal(new Set(CENSUS_RAW_KEYS).size, CENSUS_RAW_KEYS.length);
  });

  it("has unique headers and only known groups", () => {
    const headers = CENSUS_FIELDS.map((f) => f.header);
    assert.equal(new Set(headers).size, headers.length);
    const profileGroups = new Set(CENSUS_PROFILE_GROUPS.map((g) => g.group));
    for (const f of CENSUS_FIELDS) {
      if (f.profile === false) continue;
      assert.ok(profileGroups.has(f.group), `${f.header} is in a group the profile never renders`);
    }
  });

  it("reads a real value from every column", () => {
    const filled = student(
      Object.fromEntries(CENSUS_RAW_KEYS.map((k) => [k, k === "declaredMajors" ? ["Theology"] : "7"])) as Partial<CensusRawStudent>,
    );
    for (const f of CENSUS_FIELDS) {
      assert.notEqual(f.get(filled), null, f.header);
    }
  });

  it("keeps census label mappings and numeric cells", () => {
    const s = student({ residency: "Resident", sport: "Football", athleticType: "Varsity", gpa: "3.40", act: 28, pcid: "P000000123" });
    const get = (header: string) => CENSUS_FIELDS.find((f) => f.header === header)!.get(s);
    assert.equal(get("Resident or commuter"), "On Campus");
    assert.equal(get("Cumulative GPA"), 3.4);
    assert.equal(get("ACT"), 28);
    // IDs stay text so leading zeros survive in Excel.
    assert.equal(get("Census PCID"), "P000000123");
    assert.equal(get("Credits"), null);
  });

  it("drops blank values and empty groups on the profile", () => {
    const groups = censusProfileGroups(student({ classLevel: "Junior", household: "-", dob: "2005-05-05" }));
    assert.deepEqual(
      groups.map((g) => [g.group, g.open, g.fields.map((f) => f.label)]),
      [
        ["Enrollment", true, ["Class level"]],
        ["Athletics (census)", true, ["Athlete or non-athlete"]],
        ["Demographics", false, ["Date of birth"]],
      ],
    );
  });
});
