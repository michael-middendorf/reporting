import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyProspectFilters,
  isPurchased,
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
