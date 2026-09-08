import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MA_NAMES } from "./config.js";
import { isMonthlyRecurring, parseDate, prepareGifts, scoreAll, scoreGift } from "./points.js";
import { aggregate, weekKey } from "./aggregate.js";
import { buildCalculationCSV, statusOf } from "./report.js";

const ALANNA = MA_NAMES[0];
const NATALIA = "Natalia Abrams";

type WeekRec = {
  key: string;
  gifts: number;
  giftAmount: number;
  points: number;
};

type OwnerRec = {
  name: string;
  gifts: number;
  giftAmount: number;
  points: number;
  weekList: WeekRec[];
};

type Model = {
  totals: { gifts: number; giftAmount: number; points: number; unmatched: number };
  tableOwners: OwnerRec[];
  gifts: Array<{ amount?: number; owner?: string }>;
};

type ScoredRow = {
  bucket: string;
  points: number;
  unmatched?: boolean;
  day?: string;
  amount?: number;
  owner?: string;
  source?: string;
  label?: string;
  type?: string;
};

function donationNote(overrides: Record<string, unknown> = {}) {
  return {
    createdByUser: ALANNA,
    type: "Mission Advancement | New Donation or New AC",
    noteDate: "8/4/2026",
    contactId: 101,
    contactName: "Jane Donor",
    id: 1,
    ...overrides,
  };
}

function postedGift(overrides: Record<string, unknown> = {}) {
  return {
    giftDate: "8/4/2026",
    amount: 50,
    contactId: 101,
    contactName: "Jane Donor",
    id: 501,
    customFields: [],
    ...overrides,
  };
}

function run(notes: unknown[], gifts: unknown[] = [], ownerName: string = ALANNA) {
  const rows = scoreAll({ notes, gifts }) as ScoredRow[];
  const model = aggregate(rows) as Model;
  const owner = model.tableOwners.find((o) => o.name === ownerName);
  assert.ok(owner, `expected ${ownerName} on the MA roster`);
  return { rows, model, owner };
}

function weekOf(dateStr: string) {
  const d = parseDate(dateStr);
  assert.ok(d, `parseDate(${dateStr})`);
  return weekKey(d);
}

function weekRec(owner: OwnerRec, dateStr: string) {
  const key = weekOf(dateStr);
  return owner.weekList.find((w) => w.key === key) || {
    key,
    gifts: 0,
    giftAmount: 0,
    points: 0,
  };
}

describe("MA points require a posted gift with dollars", () => {
  it("uses a roster MA as createdByUser", () => {
    assert.equal(ALANNA, "Alanna McCann");
  });

  it("donation note with no gift scores 0 gifts, $0, 0 pts", () => {
    const { model, owner, rows } = run([donationNote()]);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.totals.gifts, 0);
    assert.equal(model.totals.giftAmount, 0);
    assert.equal(model.totals.points, 0);
    assert.equal(rows.filter((r) => r.bucket === "gift").length, 0);
    assert.ok(rows.some((r) => r.unmatched && r.bucket === "unmatched" && r.points === 0));
    const waiting = rows.find((r) => r.unmatched);
    assert.ok(waiting);
    assert.notEqual(waiting.source, "unmatched");
    assert.equal(statusOf(waiting), "NOT COUNTED: awaiting posted gift");
    const csv = buildCalculationCSV(model);
    assert.match(csv, /NOT COUNTED: awaiting posted gift/);
    assert.doesNotMatch(csv, /type not in rubric/);
  });

  it("unknown MA note type is still a coverage gap, not awaiting a gift", () => {
    const { rows, model } = run([
      {
        createdByUser: ALANNA,
        type: "Mission Advancement | Mystery Type",
        noteDate: "8/4/2026",
        contactId: 101,
        contactName: "Jane Donor",
        id: 99,
      },
    ]);
    const gap = rows.find((r) => r.unmatched);
    assert.ok(gap);
    assert.equal(gap.source, "unmatched");
    assert.equal(statusOf(gap), "NOT COUNTED — type not in rubric");
    const csv = buildCalculationCSV(model);
    assert.match(csv, /type not in rubric/);
    assert.doesNotMatch(csv, /awaiting posted gift/);
  });

  it("note plus amount 0 gift scores 0 gifts, $0, 0 pts", () => {
    const { model, owner, rows } = run(
      [donationNote()],
      [postedGift({ amount: 0 })],
    );
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.totals.gifts, 0);
    assert.equal(model.totals.giftAmount, 0);
    assert.equal(model.totals.points, 0);
    assert.equal(model.gifts.length, 0);
    assert.ok(rows.some((r) => r.unmatched && r.bucket === "unmatched"));
  });

  it("note plus amount > 0 gift in the same week is 1 gift, $X, 100 pts", () => {
    const { model, owner } = run(
      [donationNote()],
      [postedGift({ amount: 75 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 75);
    assert.equal(owner.points, 100);
    assert.equal(model.totals.gifts, 1);
    assert.equal(model.totals.giftAmount, 75);
    assert.equal(model.totals.points, 100);
    const wk = weekRec(owner, "8/4/2026");
    assert.equal(wk.gifts, 1);
    assert.equal(wk.giftAmount, 75);
    assert.equal(wk.points, 100);
  });

  it("note week 1 and gift week 2 put gifts, dollars, and 100 pts on week 2", () => {
    const { owner } = run(
      [donationNote({ noteDate: "8/4/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 40 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 40);
    assert.equal(owner.points, 100);
    const week1 = weekRec(owner, "8/4/2026");
    const week2 = weekRec(owner, "8/11/2026");
    assert.notEqual(week1.key, week2.key);
    assert.equal(week1.gifts, 0);
    assert.equal(week1.giftAmount, 0);
    assert.equal(week1.points, 0);
    assert.equal(week2.gifts, 1);
    assert.equal(week2.giftAmount, 40);
    assert.equal(week2.points, 100);
  });

  it("two notes and one gift score 1 gift, $X, 100 pts", () => {
    const { model, owner, rows } = run(
      [
        donationNote({ id: 1, noteDate: "8/4/2026" }),
        donationNote({ id: 2, noteDate: "8/5/2026" }),
      ],
      [postedGift({ giftDate: "8/11/2026", amount: 60 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 60);
    assert.equal(owner.points, 100);
    assert.equal(model.totals.gifts, 1);
    assert.equal(model.totals.giftAmount, 60);
    assert.equal(model.totals.points, 100);
    assert.equal(rows.filter((r) => r.bucket === "gift" && r.points === 100).length, 1);
    assert.equal(rows.filter((r) => r.unmatched && r.bucket === "unmatched").length, 1);
  });

  it("one note and two later gifts score 2 gifts, sum dollars, 100 pts once", () => {
    const { model, owner } = run(
      [donationNote({ noteDate: "8/4/2026" })],
      [
        postedGift({ id: 501, giftDate: "8/11/2026", amount: 25 }),
        postedGift({ id: 502, giftDate: "8/18/2026", amount: 35 }),
      ],
    );
    assert.equal(owner.gifts, 2);
    assert.equal(owner.giftAmount, 60);
    assert.equal(owner.points, 100);
    assert.equal(model.totals.gifts, 2);
    assert.equal(model.totals.giftAmount, 60);
    assert.equal(model.totals.points, 100);
    const first = weekRec(owner, "8/11/2026");
    const second = weekRec(owner, "8/18/2026");
    assert.equal(first.gifts, 1);
    assert.equal(first.giftAmount, 25);
    assert.equal(first.points, 100);
    assert.equal(second.gifts, 1);
    assert.equal(second.giftAmount, 35);
    assert.equal(second.points, 0);
  });

  it("gift dated before the note on that contact is not attributed", () => {
    const { model, owner, rows } = run(
      [donationNote({ noteDate: "8/11/2026" })],
      [postedGift({ giftDate: "8/4/2026", amount: 90 })],
    );
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.totals.gifts, 0);
    assert.equal(model.totals.giftAmount, 0);
    assert.equal(model.gifts.length, 0);
    assert.ok(rows.some((r) => r.unmatched && r.bucket === "unmatched" && r.points === 0));
  });

  it("gift with no donation note and no roster solicitor is dropped", () => {
    const { model, owner, rows } = run(
      [],
      [postedGift({ amount: 120, customFields: [] })],
    );
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.totals.gifts, 0);
    assert.equal(model.totals.giftAmount, 0);
    assert.equal(model.gifts.length, 0);
    assert.equal(rows.length, 0);
  });
});

describe("MA startDate is a local calendar floor", () => {
  it("includes Natalia Abrams on the roster", () => {
    assert.ok(MA_NAMES.includes(NATALIA));
  });

  it("voicemail or letter on 7/19/2026 is not scored", () => {
    const { owner, rows } = run(
      [
        donationNote({
          createdByUser: NATALIA,
          type: "Mission Advancement Call | Voicemail",
          noteDate: "7/19/2026",
          id: 1,
        }),
        donationNote({
          createdByUser: NATALIA,
          type: "Letter",
          noteDate: "7/19/2026",
          id: 2,
        }),
      ],
      [],
      NATALIA,
    );
    assert.equal(owner.points, 0);
    assert.equal(rows.length, 0);
  });

  it("same type on 7/20/2026 still scores", () => {
    const { owner, rows } = run(
      [
        donationNote({
          createdByUser: NATALIA,
          type: "Mission Advancement Call | Voicemail",
          noteDate: "7/20/2026",
          id: 1,
        }),
        donationNote({
          createdByUser: NATALIA,
          type: "Letter",
          noteDate: "7/20/2026",
          id: 2,
        }),
      ],
      [],
      NATALIA,
    );
    assert.equal(owner.points, 6);
    assert.equal(rows.filter((r) => r.bucket === "dial" && r.points === 1).length, 1);
    assert.equal(rows.filter((r) => r.bucket === "note" && r.points === 5).length, 1);
  });

  it("donation note 6/1/2026 plus gift 8/1/2026 is not attributed", () => {
    const { model, owner, rows } = run(
      [donationNote({ createdByUser: NATALIA, noteDate: "6/1/2026" })],
      [postedGift({ giftDate: "8/1/2026", amount: 80 })],
      NATALIA,
    );
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.totals.gifts, 0);
    assert.equal(model.totals.giftAmount, 0);
    assert.equal(model.totals.points, 0);
    assert.equal(rows.length, 0);
    assert.equal(model.gifts.length, 0);
  });

  it("donation note 7/21/2026 plus gift 8/1/2026 scores 1 gift and 100 pts on the gift week", () => {
    const { owner } = run(
      [donationNote({ createdByUser: NATALIA, noteDate: "7/21/2026" })],
      [postedGift({ giftDate: "8/1/2026", amount: 80 })],
      NATALIA,
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 80);
    assert.equal(owner.points, 100);
    const wk = weekRec(owner, "8/1/2026");
    assert.equal(wk.gifts, 1);
    assert.equal(wk.giftAmount, 80);
    assert.equal(wk.points, 100);
  });

  it("gift 7/19/2026 with GFT_Solicitor Natalia Abrams and no note is dropped", () => {
    const { model, owner, rows } = run(
      [],
      [
        postedGift({
          giftDate: "7/19/2026",
          amount: 90,
          customFields: [{ name: "GFT_Solicitor", value: NATALIA }],
        }),
      ],
      NATALIA,
    );
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.totals.gifts, 0);
    assert.equal(model.gifts.length, 0);
    assert.equal(rows.length, 0);
  });

  it("MA with no startDate still scores a 6/4/2026 note", () => {
    const { owner, rows } = run([
      donationNote({ type: "Letter", noteDate: "6/4/2026" }),
    ]);
    assert.equal(ALANNA, "Alanna McCann");
    assert.equal(owner.points, 5);
    assert.ok(rows.some((r) => r.bucket === "note" && r.points === 5 && r.owner === ALANNA));
  });
});

describe("monthly AC annualization", () => {
  it("detects monthly recurring from frequency, payments, or notes", () => {
    assert.equal(isMonthlyRecurring({ frequency: "Monthly" }), true);
    assert.equal(isMonthlyRecurring({ recurringGiftPayments: [{ id: 1 }] }), true);
    assert.equal(isMonthlyRecurring({ notes: "This is an instance of a recurring gift." }), true);
    assert.equal(isMonthlyRecurring({ giftType: "Credit", amount: 51.01 }), false);
  });

  it("annualizes a monthly gift as amount × 12", () => {
    const row = scoreGift({
      id: 3834,
      contactId: 70510,
      contactName: "Dustin and Margaret Hamacher",
      giftDate: "2026-08-11",
      amount: 51.01,
      frequency: "Monthly",
      solicitor: ALANNA,
    });
    assert.ok(row);
    assert.equal(row.postedAmount, 51.01);
    assert.equal(row.amount, 612.12);
    assert.equal(row.annualized, true);
    assert.equal(row.owner, ALANNA);
  });

  it("leaves a one-time gift at the posted amount", () => {
    const row = scoreGift({
      id: 1,
      contactId: 99,
      contactName: "Ursula Pfahl",
      giftDate: "9/1/2026",
      amount: 10000,
      giftType: "Credit",
      solicitor: "Sean Kelly",
    });
    assert.ok(row);
    assert.equal(row.amount, 10000);
    assert.equal(row.annualized, false);
  });

  it("replaces the posted installment with the monthly commitment", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 451107,
          contactId: 70510,
          contactName: "Dustin and Margaret Hamacher",
          giftDate: "8/11/2026",
          amount: "$51.01",
          giftType: "Electronic Funds Transfer",
          segment: "Annunciation Circle",
        }),
        postedGift({
          id: 8,
          contactId: 70510,
          contactName: "Dustin and Margaret Hamacher",
          giftDate: "8/11/2026",
          amount: 100,
          giftType: "Credit",
        }),
      ],
      [
        {
          id: 3834,
          contactId: 70510,
          startDate: "2026-08-11",
          amount: 51.01,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    assert.equal(merged.length, 2);
    const monthly = merged.find((g: { frequency?: string }) => g.frequency === "Monthly") as {
      amount: number;
      id: string;
    };
    const oneTime = merged.find((g: { id: number | string }) => g.id === 8) as { amount: number };
    assert.ok(monthly);
    assert.equal(monthly.id, "rg-3834");
    assert.equal(monthly.amount, 51.01);
    assert.equal(oneTime.amount, 100);
  });

  it("rolls annualized dollars into the MA total once", () => {
    const { owner } = run(
      [donationNote({ contactId: 70510, noteDate: "8/10/2026" })],
      prepareGifts(
        [
          postedGift({
            id: 451107,
            contactId: 70510,
            contactName: "Dustin and Margaret Hamacher",
            giftDate: "8/11/2026",
            amount: 51.01,
          }),
        ],
        [
          {
            id: 3834,
            contactId: 70510,
            contactName: "Dustin and Margaret Hamacher",
            startDate: "2026-08-11",
            amount: 51.01,
            frequency: "Monthly",
            designations: [{ project: "Annunciation Circle" }],
          },
        ],
      ),
    );
    assert.equal(owner.giftAmount, 612.12);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 100);
  });
});

describe("gift dollars follow MA activity notes", () => {
  it("conversation before a gift attributes dollars without 100 pts", () => {
    const { owner } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 51.01 })],
    );
    assert.equal(owner.giftAmount, 51.01);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 10);
  });

  it("in-person tour 18 days before a gift still attributes", () => {
    const { owner } = run(
      [donationNote({
        createdByUser: "Sean Kelly",
        type: "In Person",
        noteDate: "8/14/2026",
        contactId: 84897,
      })],
      [postedGift({ contactId: 84897, giftDate: "9/1/2026", amount: 10000 })],
      "Sean Kelly",
    );
    assert.equal(owner.giftAmount, 10000);
    assert.equal(owner.points, 25);
  });

  it("note 50 days before a gift is outside the window", () => {
    const { owner } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "6/10/2026" })],
      [postedGift({ giftDate: "8/1/2026", amount: 200 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("obituary note does not attribute a gift", () => {
    const { owner } = run(
      [donationNote({ type: "Obituary", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 200 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 5);
  });

  it("thank-you call after a gift does not claim that gift", () => {
    const { owner } = run(
      [donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "8/6/2026" })],
      [postedGift({ giftDate: "7/27/2026", amount: 1500 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });
});



