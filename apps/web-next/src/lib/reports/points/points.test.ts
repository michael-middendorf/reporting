import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MA_NAMES } from "./config.js";
import { isMonthlyRecurring, parseDate, prepareGifts, priorAcMonthly, scoreAll, scoreGift } from "./points.js";
import { aggregate, daysOfWeek, rowMatchesTracker, trackerBreakdown, trackerSpec, weekKey } from "./aggregate.js";
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
  dials?: number;
  obituaries?: number;
  weekList: WeekRec[];
};

type Model = {
  totals: { gifts: number; giftAmount: number; points: number; unmatched: number };
  tableOwners: OwnerRec[];
  gifts: Array<{ amount?: number; owner?: string }>;
  rows: Array<{ noteId?: string | number; removed?: boolean; points?: number }>;
  bests?: {
    teamWeek?: string | null;
    team: Record<string, { value: number; week: string | null }>;
  };
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
  noteId?: string | number;
  removed?: boolean;
  conflict?: string | null;
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

  it("counts only the AC increase, not the new full monthly amount", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 443204,
          contactId: 88058,
          contactName: "Prior AC member",
          giftDate: "11/13/2025",
          amount: 32.5,
          segment: "FundraiseUp - Annunciation Circle",
        }),
        postedGift({
          id: 450744,
          contactId: 88058,
          contactName: "Prior AC member",
          giftDate: "7/30/2026",
          amount: 40,
          segment: "Annunciation Circle",
        }),
      ],
      [
        {
          id: 3823,
          contactId: 88058,
          contactName: "Prior AC member",
          startDate: "2026-07-30",
          amount: 40,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    const monthly = merged.find((g: { frequency?: string }) => g.frequency === "Monthly") as {
      amount: number;
      acIncrease?: boolean;
      priorMonthly?: number;
      newMonthly?: number;
    };
    assert.ok(monthly);
    assert.equal(monthly.amount, 7.5);
    assert.equal(monthly.acIncrease, true);
    assert.equal(monthly.priorMonthly, 32.5);
    assert.equal(monthly.newMonthly, 40);
    assert.equal(merged.some((g: { id?: number | string }) => g.id === 450744), false);

    const { owner, rows } = run(
      [donationNote({ contactId: 88058, noteDate: "7/28/2026", type: "Mission Advancement | Annunciation Circle Updated" })],
      merged,
    );
    assert.equal(owner.giftAmount, 90);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 100);
    const giftRow = rows.find((r) => r.bucket === "donation");
    assert.ok(giftRow);
    assert.equal(giftRow.amount, 90);
    assert.match(String(giftRow.label), /AC increase/);
  });

  it("does not re-count a same-rate AC continuation", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 1,
          contactId: 41491,
          giftDate: "12/8/2025",
          amount: 27.2,
          segment: "FundraiseUp - Annunciation Circle",
        }),
        postedGift({
          id: 2,
          contactId: 41491,
          giftDate: "1/8/2026",
          amount: 27.2,
          segment: "Annunciation Circle",
        }),
      ],
      [
        {
          id: 3513,
          contactId: 41491,
          startDate: "2026-01-08",
          amount: 27.2,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    assert.equal(merged.some((g: { frequency?: string }) => g.frequency === "Monthly"), false);
    assert.equal(merged.length, 0);
    assert.equal(priorAcMonthly(
      [
        postedGift({
          contactId: 41491,
          giftDate: "12/8/2025",
          amount: 27.2,
          segment: "FundraiseUp - Annunciation Circle",
        }),
      ],
      41491,
      "2026-01-08",
    ), 27.2);
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
    assert.equal(owner.points, 3);
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

describe("invalid numbers count as 1-pt dials", () => {
  it("Mission Advancement Call | Invalid Number scores 1 pt and counts as a dial", () => {
    const { owner, rows } = run([
      donationNote({ type: "Mission Advancement Call | Invalid Number", id: 88 }),
    ]);
    const row = rows.find((r) => r.noteId === 88);
    assert.ok(row);
    assert.equal(row.points, 1);
    assert.equal(row.bucket, "failed");
    assert.equal(statusOf(row), "counted");
    assert.equal(owner.points, 1);
    assert.equal(owner.dials, 1);
  });
});

describe("email points follow the tracker sheet", () => {
  it("Email Reach Out scores 2 pts (sheet Email Sent)", () => {
    const { owner, rows } = run([
      donationNote({ type: "Mission Advancement Call | Email Reach Out", id: 21 }),
    ]);
    const row = rows.find((r) => r.noteId === 21);
    assert.ok(row);
    assert.equal(row.points, 2);
    assert.equal(row.bucket, "email");
    assert.equal(owner.points, 2);
  });

  it("Email Conversation scores 3 pts (sheet Response Rec'd)", () => {
    const { owner, rows } = run([
      donationNote({ type: "Mission Advancement Call | Email Conversation", id: 22 }),
    ]);
    const row = rows.find((r) => r.noteId === 22);
    assert.ok(row);
    assert.equal(row.points, 3);
    assert.equal(row.bucket, "email");
    assert.equal(owner.points, 3);
  });
});

describe("tracker category layout", () => {
  it("rolls LVM, disconnected, conversation, letter, and obituary into the sheet mix", () => {
    const scored = scoreAll({
      notes: [
        donationNote({ type: "Mission Advancement Call | Voicemail", id: 1 }),
        donationNote({ type: "Mission Advancement Call | Invalid Number", id: 2 }),
        donationNote({ type: "Mission Advancement Call | Conversation", id: 3 }),
        donationNote({ type: "Letter", id: 4 }),
        donationNote({ type: "Obituary", id: 5 }),
        donationNote({ type: "In Person", id: 6 }),
        donationNote({ type: "Mission Advancement Call | Email Reach Out", id: 7 }),
        donationNote({ type: "Mission Advancement Call | Email Conversation", id: 8 }),
      ],
    }) as ScoredRow[];
    const mix = trackerBreakdown(scored);
    const byId = Object.fromEntries(mix.lines.map((l) => [l.id, l]));
    assert.equal(byId.lvm.points, 1);
    assert.equal(byId.disconnected.points, 1);
    assert.equal(byId.conversation.points, 10);
    assert.equal(byId.letter_sent.points, 5);
    assert.equal(byId.obituaries.points, 3);
    assert.equal(byId.tours.points, 25);
    assert.equal(byId.email_sent.points, 2);
    assert.equal(byId.email_response.points, 3);
    assert.equal(mix.totalPoints, 50);
  });

  it("filters rows to a tracker category", () => {
    const scored = scoreAll({
      notes: [
        donationNote({ type: "Mission Advancement Call | Voicemail", id: 1 }),
        donationNote({ type: "Letter", id: 2 }),
        donationNote({ type: "Obituary", id: 3 }),
      ],
    }) as ScoredRow[];
    const lvm = scored.filter((r) => rowMatchesTracker(r, trackerSpec("lvm")));
    assert.equal(lvm.length, 1);
    assert.equal(lvm[0].type, "Mission Advancement Call | Voicemail");
    const letters = scored.filter((r) => rowMatchesTracker(r, trackerSpec("letter")));
    assert.equal(letters.length, 2);
  });

  it("daysOfWeek is Monday through Sunday", () => {
    assert.deepEqual(daysOfWeek("2026-08-31"), [
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("week range bounds", () => {
  it("includes Sunday of the To week and excludes the next Monday", () => {
    const scored = scoreAll({
      notes: [
        donationNote({ type: "Letter", noteDate: "8/3/2026", id: 1 }),
        donationNote({ type: "Letter", noteDate: "8/9/2026", id: 2 }),
        donationNote({ type: "Letter", noteDate: "8/10/2026", id: 3 }),
      ],
    }) as ScoredRow[];
    const model = aggregate(scored, {
      start: parseDate("8/3/2026"),
      end: parseDate("8/9/2026"),
    }) as Model;
    const owner = model.tableOwners.find((o) => o.name === ALANNA);
    assert.ok(owner);
    assert.equal(owner.points, 10);
    assert.equal(model.rows.length, 2);
  });
});

describe("count/remove overrides", () => {
  it("obituary is counted at 3 points by default", () => {
    const { owner, rows, model } = run([donationNote({ type: "Obituary", id: 77 })]);
    assert.equal(owner.points, 3);
    assert.equal(owner.obituaries, 1);
    const row = rows.find((r) => r.noteId === 77);
    assert.ok(row);
    assert.equal(row.points, 3);
    assert.equal(statusOf(row), "counted");
    assert.doesNotMatch(buildCalculationCSV(model), /removed/i);
  });

  it("removing a row drops its points from totals and keeps it listed", () => {
    const scored = scoreAll({ notes: [donationNote({ type: "Obituary", id: 77 })] }) as ScoredRow[];
    const model = aggregate(scored, { flags: { "77": { status: "removed" } } }) as Model;
    const owner = model.tableOwners.find((o) => o.name === ALANNA);
    assert.ok(owner);
    assert.equal(owner.points, 0);
    assert.equal(owner.obituaries, 0);
    const row = model.rows.find((r) => String(r.noteId) === "77");
    assert.ok(row);
    assert.equal(row.removed, true);
    assert.equal(row.points, 3);
    assert.equal(statusOf(row), "removed");
    assert.match(buildCalculationCSV(model, { flags: { "77": { status: "removed" } } }), /removed/i);
  });

  it("old resolved flags do not exclude the row", () => {
    const scored = scoreAll({ notes: [donationNote({ type: "Obituary", id: 77 })] }) as ScoredRow[];
    const model = aggregate(scored, { flags: { "77": { status: "resolved" } } }) as Model;
    const owner = model.tableOwners.find((o) => o.name === ALANNA);
    assert.ok(owner);
    assert.equal(owner.points, 3);
    const row = model.rows.find((r) => String(r.noteId) === "77");
    assert.equal(row?.removed, false);
  });
});

describe("team bests", () => {
  it("uses one all-time best week, not a mix of different weeks", () => {
    const scored = scoreAll({
      notes: [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/3/2026", id: 1 }),
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/4/2026", id: 2 }),
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/5/2026", id: 3 }),
        donationNote({ type: "Mission Advancement | Event", noteDate: "8/11/2026", id: 4 }),
      ],
    }) as ScoredRow[];
    const model = aggregate(scored) as Model;
    const weekA = weekOf("8/3/2026");
    const weekB = weekOf("8/11/2026");
    assert.equal(weekA, "2026-08-03");
    assert.equal(weekB, "2026-08-10");
    assert.equal(model.bests?.teamWeek, weekB);
    assert.equal(model.bests?.team.points.value, 300);
    assert.equal(model.bests?.team.points.week, weekB);
    assert.equal(model.bests?.team.conversations.value, 0);
    assert.equal(model.bests?.team.conversations.week, weekB);
    assert.equal(model.bests?.team.dials.week, weekB);
    assert.equal(model.bests?.team.gifts.week, weekB);
    assert.equal(model.bests?.team.giftAmount.week, weekB);
  });
});



