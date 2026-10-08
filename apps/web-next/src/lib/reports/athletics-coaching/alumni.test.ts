import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAlumniSummary, slateSportKeys } from "./alumni";

// Synthetic people only.
function grad(pcid: string, first: string, last: string, classYear: number, extra: Record<string, unknown> = {}) {
  return {
    PEOPLE_CODE_ID: pcid,
    FIRST_NAME: first,
    MIDDLE_NAME: null,
    LAST_NAME: last,
    SUFFIX: null,
    NICKNAME: null,
    DEGREE: "BARTS",
    FORMAL_TITLE: "Bachelor of Arts",
    GRADUATION_DATE: `${classYear}-05-10 00:00:00`,
    CLASS_YEAR: classYear,
    EMAIL: `${first.toLowerCase()}@example.invalid`,
    EMAIL_TYPE: "PEMA",
    ...extra,
  };
}

function athletic(code: string, first: number, last: number, count: number, person: Record<string, unknown>) {
  return { ASSOCIATION: code, FIRST_YEAR: String(first), LAST_YEAR: String(last), YEARS_COUNT: count, ...person };
}

const ANNA = grad("P000000101", "Anna", "Zeller", 2019);
const BEN = grad("P000000102", "Ben", "Adams", 2019);
const CARL = grad("P000000103", "Carl", "Moore", 2021);
const DORA = grad("P000000104", "Dora", "Quinn", 2016);

describe("buildAlumniSummary", () => {
  it("reports awaiting PowerCampus when neither PC feed exists", () => {
    const summary = buildAlumniSummary({
      sport: "football",
      athleticAlumniRows: null,
      graduateRows: null,
      slateRows: [],
      showEmails: true,
    });
    assert.equal(summary.available, false);
    assert.equal(summary.reason, "awaiting_powercampus");
    assert.equal(summary.total, 0);
    assert.equal(summary.slateAvailable, true);
  });

  it("maps varsity, JV, and legacy codes, merges spans, sorts by class year then last name", () => {
    const summary = buildAlumniSummary({
      sport: "football",
      athleticAlumniRows: [
        athletic("ICFBM", 2015, 2018, 4, ANNA),
        athletic("ICFBM", 2016, 2018, 3, BEN),
        athletic("AFBALM", 2005, 2005, 1, DORA),
        athletic("ICFBM", 2012, 2015, 4, DORA),
        athletic("ICBASE", 2018, 2021, 4, CARL),
        athletic("ICCG", 2015, 2016, 2, ANNA),
      ],
      graduateRows: [ANNA, BEN, CARL, DORA],
      slateRows: null,
      showEmails: true,
    });
    assert.equal(summary.available, true);
    assert.equal(summary.slateAvailable, false);
    assert.deepEqual(
      summary.rows.map((row) => row.lastName),
      ["Adams", "Zeller", "Quinn"],
    );
    const dora = summary.rows.find((row) => row.pcid === "P000000104")!;
    assert.equal(dora.firstYear, 2005);
    assert.equal(dora.lastYear, 2015);
    assert.equal(dora.yearsCount, 5);
    assert.equal(dora.graduationDate, "2016-05-10");
    assert.equal(dora.degreeTitle, "Bachelor of Arts");
    assert.deepEqual(summary.byClassYear, [
      { label: "2019", count: 2 },
      { label: "2016", count: 1 },
    ]);
    // Color Guard (ICCG) has no coaching sport, so Anna lists only Football.
    const anna = summary.rows.find((row) => row.pcid === "P000000101")!;
    assert.deepEqual(anna.sports, ["Football"]);
    assert.equal(anna.email, "anna@example.invalid");
  });

  it("caps merged varsity and JV seasons at the first-to-last span", () => {
    const summary = buildAlumniSummary({
      sport: "mens-basketball",
      athleticAlumniRows: [
        athletic("ICBBM", 2016, 2019, 4, BEN),
        athletic("ICJBBM", 2016, 2017, 2, BEN),
      ],
      graduateRows: [BEN],
      slateRows: null,
      showEmails: false,
    });
    assert.equal(summary.rows[0]?.yearsCount, 4);
  });

  it("adds Slate sport memberships only for PowerCampus graduates", () => {
    const summary = buildAlumniSummary({
      sport: "mens-soccer",
      athleticAlumniRows: [athletic("ICBASE", 2018, 2021, 4, CARL)],
      graduateRows: [ANNA, BEN, CARL],
      slateRows: [
        { PCID: "102", CurrentSport: "Soccer", MF: "M", FirstName: "Ben", LastName: "Adams" },
        { PCID: "P000000103", CurrentSport: "Baseball", SecondSport: "Soccer", MF: "M" },
        { PCID: "P000000999", CurrentSport: "Soccer", MF: "M", FirstName: "Not", LastName: "Graduated" },
        { PCID: "P000000101", CurrentSport: "Soccer", MF: "", FirstName: "Anna" },
      ],
      showEmails: true,
    });
    assert.deepEqual(
      summary.rows.map((row) => row.pcid),
      ["P000000103", "P000000102"],
    );
    const carl = summary.rows[0]!;
    assert.deepEqual(carl.sports, ["Men's Soccer", "Baseball"]);
    assert.equal(carl.firstYear, null);
    assert.deepEqual(carl.sources, ["powercampus", "slate"]);
    const ben = summary.rows[1]!;
    assert.deepEqual(ben.sources, ["slate"]);
    assert.equal(ben.classYear, 2019);
  });

  it("ignores Slate rows when the graduates feed is missing", () => {
    const summary = buildAlumniSummary({
      sport: "mens-soccer",
      athleticAlumniRows: [athletic("ICBASE", 2018, 2021, 4, CARL)],
      graduateRows: null,
      slateRows: [{ PCID: "P000000103", CurrentSport: "Soccer", MF: "M" }],
      showEmails: true,
    });
    assert.equal(summary.available, true);
    assert.equal(summary.total, 0);
  });

  it("strips every email when emails are hidden", () => {
    const summary = buildAlumniSummary({
      sport: "football",
      athleticAlumniRows: [athletic("ICFBM", 2015, 2018, 4, ANNA), athletic("ICFBM", 2016, 2018, 3, BEN)],
      graduateRows: [ANNA, BEN],
      slateRows: null,
      showEmails: false,
    });
    assert.equal(summary.emailsHidden, true);
    assert.equal(summary.total, 2);
    assert.equal(JSON.stringify(summary).includes("@example.invalid"), false);
  });

  it("falls back to the graduation year when CLASS_YEAR is missing", () => {
    const noClassYear = grad("P000000105", "Eve", "Long", 2020, { CLASS_YEAR: null });
    const summary = buildAlumniSummary({
      sport: "womens-softball",
      athleticAlumniRows: [athletic("ICSOFT", 2016, 2019, 4, noClassYear)],
      graduateRows: null,
      slateRows: null,
      showEmails: true,
    });
    assert.equal(summary.rows[0]?.classYear, 2020);
  });
});

describe("slateSportKeys", () => {
  it("resolves current and second sport with MF", () => {
    assert.deepEqual(slateSportKeys({ CurrentSport: "Basketball", SecondSport: "Golf", MF: "F" }), [
      "womens-basketball",
      "womens-golf",
    ]);
    assert.deepEqual(slateSportKeys({ CurrentSport: "Football", MF: "M" }), ["football"]);
    assert.deepEqual(slateSportKeys({ CurrentSport: "Basketball", MF: "" }), []);
    assert.deepEqual(slateSportKeys({ CurrentSport: "Marching Band", MF: "M" }), []);
  });
});
