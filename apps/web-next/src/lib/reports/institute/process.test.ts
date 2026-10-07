import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATH_NOT_SET,
  athleticItems,
  emptyFilters,
  emptyProspectFilters,
  isPurchased,
  normalizeApplicants,
  passes,
  normalizeProspects,
  passesProspect,
  prospectsToCsv,
  type Prospect,
} from "./process";

function row(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    FirstName: "Ada",
    LastName: "Lovelace",
    Status: "Prospect",
    Email: "ada@example.com",
    Phone: "239-555-0100",
    Street1: "1 College Blvd",
    City: "Ave Maria",
    Region: "FL",
    Postal: "34142",
    Country: "United States",
    SAT: "1400",
    HighSchool: "AMU Academy",
    HighSchoolCity: "Ave Maria",
    HighSchoolState: "FL",
    MSATag: "",
    "PersonGPA-Self-Reportedhighschool": "3.9",
    PersonGUID: "guid-ada",
    InstituteRecruitingBin: "Campaign 2 - Hold",
    InstituteRecruitingColumn: "Campaign 2",
    PurchasedList: "N",
    ...partial,
  };
}

test("isPurchased treats Y/Yes/1/true as purchased; blank/N as not", () => {
  for (const v of ["Y", "y", "Yes", "1", "true", "TRUE"]) {
    assert.equal(isPurchased(v), true, String(v));
  }
  for (const v of ["N", "no", "", null, undefined, "0", "false"]) {
    assert.equal(isPurchased(v), false, String(v));
  }
});

test("normalizeProspects maps PurchasedList onto a Yes/No label and Slate URL", () => {
  const [yes, no] = normalizeProspects([
    row({ PurchasedList: "Y", PersonGUID: "abc" }),
    row({ FirstName: "Ben", LastName: "Franklin", PurchasedList: "" }),
  ]);
  assert.equal(yes.purchased, true);
  assert.equal(yes.purchasedLabel, "Yes");
  assert.equal(yes.state, "FL");
  assert.equal(yes.url, "https://apply.avemaria.edu/manage/lookup/record?id=abc");
  assert.equal(no.purchased, false);
  assert.equal(no.purchasedLabel, "No");
  assert.equal(no.name, "Ben Franklin");
});

test("passesProspect filters by purchased flag, state, and search", () => {
  const people = normalizeProspects([
    row({ PurchasedList: "Y", Region: "FL" }),
    row({ FirstName: "Grace", LastName: "Hopper", PurchasedList: "N", Region: "NY" }),
  ]);
  const y = people.filter((d) =>
    passesProspect(d, { ...emptyProspectFilters(), purchased: "Y" }),
  );
  assert.equal(y.length, 1);
  assert.equal(y[0].first, "Ada");

  const ny = people.filter((d) => passesProspect(d, { ...emptyProspectFilters(), state: "NY" }));
  assert.equal(ny.length, 1);
  assert.equal(ny[0].last, "Hopper");

  const search = people.filter((d) =>
    passesProspect(d, { ...emptyProspectFilters(), search: "hopper" }),
  );
  assert.equal(search.length, 1);
});

test("prospectsToCsv includes purchased-list column and escapes commas", () => {
  const people: Prospect[] = normalizeProspects([
    row({ HighSchool: "St. Mary's, Naples", PurchasedList: "Y" }),
  ]);
  const csv = prospectsToCsv(people);
  const [header, line] = csv.split("\n");
  assert.match(header, /Purchased List/);
  assert.match(line, /Yes/);
  assert.match(line, /"St. Mary's, Naples"/);
});

test("athleticItems keeps blank athletic decisions as a Not set slice so the donut reconciles", () => {
  const decisions = ["Athlete", "Athlete", "Non-Athlete", "Need to Review", "", "", "  "];
  const apps = normalizeApplicants(
    decisions.map((d) => ({ ApplicationTerm: "Fall 2026", Gender: "F", ApplicationAthleticDecision: d })),
  );
  const rows = apps.filter((d) => passes(d, emptyFilters("Fall 2026")));
  const items = athleticItems(rows);
  assert.equal(items.reduce((s, x) => s + x.v, 0), rows.length);
  assert.deepEqual(items[items.length - 1], { k: ATH_NOT_SET, v: 3 });
  assert.equal(items.find((x) => x.k === "Athlete")?.v, 2);
});

test("athleticItems adds no Not set slice when every applicant has a decision", () => {
  const rows = normalizeApplicants([{ ApplicationAthleticDecision: "Athlete" }]);
  assert.deepEqual(athleticItems(rows), [{ k: "Athlete", v: 1 }]);
});

test("athleticItems merges a real 'Not set' Slate decision with blank decisions instead of duplicating the key", () => {
  const decisions = ["Not set", "Not set", "Athlete", "", ""];
  const apps = normalizeApplicants(
    decisions.map((d) => ({ ApplicationTerm: "Fall 2026", ApplicationAthleticDecision: d })),
  );
  const rows = apps.filter((d) => passes(d, emptyFilters("Fall 2026")));
  const items = athleticItems(rows);
  // exactly one "Not set" item (no duplicate React keys), holding both the
  // literal "Not set" decisions and the blank ones
  const notSetItems = items.filter((x) => x.k === ATH_NOT_SET);
  assert.equal(notSetItems.length, 1);
  assert.equal(notSetItems[0].v, 4);
  assert.equal(items.reduce((s, x) => s + x.v, 0), rows.length);
  assert.equal(items.find((x) => x.k === "Athlete")?.v, 1);
});
