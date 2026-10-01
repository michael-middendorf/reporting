import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countNotes,
  filterDonors,
  kpisFor,
  mdy,
  periodWindow,
  sortDonors,
  truncate,
  usd,
  type MgoAnalysisSnapshot,
  type MgoDonor,
  type MgoNote,
} from "./shape";

function win(asOf: string, period: "week" | "month" | "quarter") {
  const w = periodWindow(asOf, period);
  return [w.start, w.end];
}

describe("periodWindow", () => {
  it("uses Monday through Sunday for the week", () => {
    // 2026-10-01 is a Thursday.
    assert.deepEqual(win("2026-10-01", "week"), ["2026-09-28", "2026-10-04"]);
    // asOf on the Sunday ends the same week, not the next one.
    assert.deepEqual(win("2026-10-04", "week"), ["2026-09-28", "2026-10-04"]);
    // asOf on the Monday starts the week.
    assert.deepEqual(win("2026-09-28", "week"), ["2026-09-28", "2026-10-04"]);
    // Week that spans a year boundary.
    assert.deepEqual(win("2027-01-01", "week"), ["2026-12-28", "2027-01-03"]);
  });

  it("uses the calendar month", () => {
    assert.deepEqual(win("2026-10-01", "month"), ["2026-10-01", "2026-10-31"]);
    assert.deepEqual(win("2027-02-15", "month"), ["2027-02-01", "2027-02-28"]);
    assert.deepEqual(win("2028-02-29", "month"), ["2028-02-01", "2028-02-29"]);
  });

  it("uses fiscal quarters Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun", () => {
    assert.deepEqual(win("2026-10-01", "quarter"), ["2026-10-01", "2026-12-31"]);
    assert.deepEqual(win("2026-07-01", "quarter"), ["2026-07-01", "2026-09-30"]);
    assert.deepEqual(win("2026-09-30", "quarter"), ["2026-07-01", "2026-09-30"]);
    assert.deepEqual(win("2027-03-31", "quarter"), ["2027-01-01", "2027-03-31"]);
    assert.deepEqual(win("2027-04-01", "quarter"), ["2027-04-01", "2027-06-30"]);
  });

  it("labels the window with M/D/YYYY dates", () => {
    assert.equal(periodWindow("2026-10-01", "week").label, "9/28/2026 to 10/4/2026");
  });
});

const notes: MgoNote[] = [
  { mgo: "James Thomas", contactId: 1, kind: "outreach", date: "2026-10-01" },
  { mgo: "James Thomas", contactId: 2, kind: "outreach", date: "2026-09-30" },
  { mgo: "Julie Musselman", contactId: 3, kind: "outreach", date: "2026-10-02" },
  { mgo: "Julie Musselman", contactId: 3, kind: "face_to_face", date: "2026-10-01" },
  { mgo: "James Thomas", contactId: 1, kind: "face_to_face", date: "2026-08-10" },
  // One proposal note on a contact in both portfolios: one row per assigned MGO.
  { mgo: "James Thomas", contactId: 5, kind: "proposal", date: "2026-08-01", noteId: 900 },
  { mgo: "Julie Musselman", contactId: 5, kind: "proposal", date: "2026-08-01", noteId: 900 },
  { mgo: "James Thomas", contactId: 1, kind: "proposal", date: "2026-09-01", noteId: 901 },
];

describe("countNotes", () => {
  const month = periodWindow("2026-10-01", "month");
  const week = periodWindow("2026-10-01", "week");

  it("counts team and single MGO activity in the window", () => {
    assert.equal(countNotes(notes, null, "outreach", month), 2);
    assert.equal(countNotes(notes, null, "outreach", week), 3);
    assert.equal(countNotes(notes, "James Thomas", "outreach", week), 2);
    assert.equal(countNotes(notes, "Julie Musselman", "outreach", month), 1);
    assert.equal(countNotes(notes, null, "face_to_face", month), 1);
    assert.equal(countNotes(notes, "James Thomas", "face_to_face", month), 0);
    assert.equal(countNotes(notes, "James Thomas", "face_to_face", null), 1);
  });

  it("dedupes team proposal notes by noteId but credits each MGO", () => {
    assert.equal(countNotes(notes, null, "proposal", null), 2);
    assert.equal(countNotes(notes, "James Thomas", "proposal", null), 2);
    assert.equal(countNotes(notes, "Julie Musselman", "proposal", null), 1);
  });

  it("falls back to contact and date when noteId is missing", () => {
    const rows: MgoNote[] = [
      { mgo: "A", contactId: 7, kind: "proposal", date: "2026-08-01" },
      { mgo: "B", contactId: 7, kind: "proposal", date: "2026-08-01" },
    ];
    assert.equal(countNotes(rows, null, "proposal", null), 1);
  });
});

describe("kpisFor", () => {
  const snapshot: MgoAnalysisSnapshot = {
    asOf: "2026-10-01",
    fiscalYear: { label: "FY 2026-27", start: "2026-07-01", end: "2027-06-30" },
    kpisByMgo: {
      "James Thomas": {
        fyRaised: 100,
        openAskAmount: 50,
        openAskCount: 1,
        fundedAmount: 10,
        fundedCount: 1,
        donorCount: 4,
      },
      __team__: {
        fyRaised: 300,
        openAskAmount: 70,
        openAskCount: 2,
        fundedAmount: 10,
        fundedCount: 1,
        donorCount: 9,
      },
    },
    notes,
  };

  it("reads the team row and derives period counts", () => {
    const team = kpisFor(snapshot, null, "quarter");
    assert.equal(team.fyRaised, 300);
    assert.equal(team.donorCount, 9);
    assert.equal(team.activityNotes, 2); // Oct 1 and Oct 2
    assert.equal(team.faceToFace, 1);
    assert.equal(team.proposalDocs, 2);
    assert.equal(team.window?.start, "2026-10-01");
  });

  it("scopes tiles to one MGO", () => {
    const jim = kpisFor(snapshot, "James Thomas", "week");
    assert.equal(jim.fyRaised, 100);
    assert.equal(jim.activityNotes, 2);
    assert.equal(jim.faceToFace, 0);
    assert.equal(jim.proposalDocs, 2);
  });

  it("returns zeros for an unknown MGO or empty snapshot", () => {
    assert.equal(kpisFor(snapshot, "Nobody").fyRaised, 0);
    assert.equal(kpisFor(null, null).activityNotes, 0);
  });
});

function donor(over: Partial<MgoDonor>): MgoDonor {
  return {
    contactId: 1,
    name: "Donor",
    contactUrl: null,
    assignedMgo: "James Thomas",
    assignedFirstName: "Jim",
    topProspect: false,
    openAskAmount: 0,
    openAskCount: 0,
    formalProposal: false,
    planFy27: null,
    lastGiftDate: null,
    lastMgoActivityDate: null,
    ...over,
  };
}

const donors: MgoDonor[] = [
  donor({ contactId: 1, name: "Alice Able", topProspect: true, planFy27: "Ask in spring", formalProposal: true, openAskAmount: 5000, openAskCount: 1 }),
  donor({ contactId: 2, name: "Bob Baker", topProspect: true, planFy27: "  " }),
  donor({ contactId: 3, name: "Carol Cole", assignedMgo: "Julie Musselman", assignedFirstName: "Julie", openAskAmount: 100, openAskCount: 1 }),
  donor({ contactId: 3, name: "Carol Cole", topProspect: true, formalProposal: true, planFy27: "Visit" }),
];

describe("filterDonors", () => {
  it("shows every row for the team, including a contact in two portfolios", () => {
    assert.equal(filterDonors(donors, {}).length, 4);
  });

  it("scopes to one MGO", () => {
    assert.deepEqual(
      filterDonors(donors, { mgo: "Julie Musselman" }).map((d) => d.contactId),
      [3],
    );
  });

  it("ANDs the checkboxes together", () => {
    assert.deepEqual(
      filterDonors(donors, { topProspect: true }).map((d) => d.name),
      ["Alice Able", "Bob Baker", "Carol Cole"],
    );
    // Whitespace-only plan does not count as a plan.
    assert.deepEqual(
      filterDonors(donors, { topProspect: true, hasPlan: true }).map((d) => d.name),
      ["Alice Able", "Carol Cole"],
    );
    assert.deepEqual(
      filterDonors(donors, { topProspect: true, hasPlan: true, hasProposal: true, hasOpen: true }).map(
        (d) => d.name,
      ),
      ["Alice Able"],
    );
    assert.equal(filterDonors(donors, { mgo: "Julie Musselman", topProspect: true }).length, 0);
  });

  it("searches donor names case-insensitively", () => {
    assert.equal(filterDonors(donors, { q: "carol" }).length, 2);
  });
});

describe("sortDonors", () => {
  it("defaults to top prospects first, then name", () => {
    assert.deepEqual(
      sortDonors(donors).map((d) => `${d.name}:${d.assignedFirstName}`),
      ["Alice Able:Jim", "Bob Baker:Jim", "Carol Cole:Jim", "Carol Cole:Julie"],
    );
  });

  it("sorts amounts with blanks last in both directions", () => {
    assert.deepEqual(
      sortDonors(donors, "openAskAmount", "desc").map((d) => d.openAskAmount),
      [5000, 100, 0, 0],
    );
    assert.deepEqual(
      sortDonors(donors, "openAskAmount", "asc").map((d) => d.openAskAmount),
      [100, 5000, 0, 0],
    );
  });
});

describe("formatting", () => {
  it("formats dates, money, and plan text", () => {
    assert.equal(mdy("2026-02-04"), "2/4/2026");
    assert.equal(mdy(null), "");
    assert.equal(usd(25000), "$25,000");
    assert.equal(usd(null), "");
    assert.equal(truncate("short"), "short");
    const long = "word ".repeat(40).trim();
    const t = truncate(long, 80);
    assert.ok(t.length <= 81, t);
    assert.ok(t.endsWith("…"));
  });
});
