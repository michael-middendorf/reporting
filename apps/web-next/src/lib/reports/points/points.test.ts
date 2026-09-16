import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MA_NAMES, SETTINGS, evalStartDate } from "./config.js";
import { assignedNotesFromFlags, eventPointsForHours, isMgoAttributedGift, isMonthlyRecurring, parseDate, prepareGifts, priorAcMonthly, scoreAll, scoreGift, scoreTrackedEvents } from "./points.js";
import { aggregate, daysOfWeek, isTaskListRow, rowMatchesTracker, trackerBreakdown, trackerSpec, weekKey } from "./aggregate.js";
import { buildCalculationCSV, statusOf, virtuousGiftUrl } from "./report.js";

const ALANNA = MA_NAMES[0];
const SEAN = "Sean Kelly";
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
  gifts: Array<{ amount?: number; owner?: string; giftId?: unknown; contactId?: unknown; mgoAssigned?: boolean; removed?: boolean }>;
  possibleGifts?: Array<{
    owner?: string;
    giftId?: unknown;
    amount?: number;
    inRaised?: boolean;
    noteType?: string;
    daysAfterNote?: number;
    contactName?: string;
    kind?: string;
    kindLabel?: string;
    owners?: Array<{ name: string; noteType?: string; daysAfterNote?: number }>;
  }>;
  reviewGifts?: Array<{ amount?: number; owner?: string; giftId?: unknown; needsReview?: boolean; contactName?: string }>;
  rows: Array<{ noteId?: string | number; giftId?: string | number; bucket?: string; removed?: boolean; points?: number; day?: string; mgoAssigned?: boolean }>;
  bests?: {
    teamWeek?: string | null;
    team: Record<string, { value: number; week: string | null }>;
    teamTotalPoints?: number;
    owners?: Array<{ name: string; bestWeek?: string | null; totalPoints?: number } & Record<string, { value: number; week: string | null } | string | number | undefined>>;
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
  giftId?: string | number;
  removed?: boolean;
  needsReview?: boolean;
  mgoAssigned?: boolean;
  conflict?: string | null;
  tracked?: boolean;
  hours?: number;
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

function run(
  notes: unknown[],
  gifts: unknown[] = [],
  ownerName: string = ALANNA,
  flags: Record<string, { status?: string; owner?: string }> = {},
) {
  const rows = scoreAll({ notes, gifts, flags }) as ScoredRow[];
  const model = aggregate(rows, { flags }) as Model;
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

  it("string vs number contactId still pairs the donation note to the gift", () => {
    const { owner, model } = run(
      [donationNote({ contactId: 101 })],
      [postedGift({ contactId: "101", amount: 80 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 80);
    assert.equal(owner.points, 100);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("New Donation / New AC / AC updated notes count without the Mission Advancement prefix", () => {
    const { owner, model } = run(
      [
        donationNote({ type: "New Donation or New AC", contactId: 101, id: 1 }),
        donationNote({ type: "Annunciation Circle Updated", contactId: 102, id: 2, noteDate: "8/5/2026" }),
        donationNote({ type: "Update Recurring Gift", contactId: 103, id: 3, noteDate: "8/6/2026" }),
      ],
      [
        postedGift({ id: 501, contactId: 101, amount: 20 }),
        postedGift({ id: 502, contactId: 102, giftDate: "8/5/2026", amount: 30 }),
        postedGift({
          id: 503,
          contactId: 103,
          giftDate: "8/6/2026",
          amount: 12,
          acIncrease: true,
          priorMonthly: 20,
          newMonthly: 40,
          frequency: "Monthly",
        }),
      ],
    );
    assert.equal(owner.gifts, 3);
    assert.equal(owner.points, 300);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("conversation plus a New Donation note is Raised, not Incoming", () => {
    const { owner, model } = run(
      [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", id: 11 }),
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/11/2026", id: 12 }),
      ],
      [postedGift({ giftDate: "8/11/2026", amount: 51.01 })],
    );
    assert.equal(owner.giftAmount, 51.01);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("note plus amount > 0 gift in the same week is 1 gift, $X, 100 pts", () => {
    const { model, owner, rows } = run(
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
    const secured = rows.find((r) => r.bucket === "gift" && r.points === 100) as ScoredRow & { giftId?: unknown };
    assert.ok(secured);
    assert.equal(String(secured.giftId), "501");
    const csv = buildCalculationCSV(model);
    assert.match(csv, /Open gift in Virtuous/);
    assert.match(csv, /Contact\/Gifts\/101/);
    assert.doesNotMatch(csv, /Gift\/View\//);
    assert.match(csv, /GIFTS — posted gifts/);
    const gift = model.gifts.find((g) => String(g.giftId) === "501");
    assert.ok(gift);
    assert.match(virtuousGiftUrl(gift.contactId), /Contact\/Gifts\/101/);
    assert.equal(virtuousGiftUrl(null), "");
    assert.equal(virtuousGiftUrl(""), "");
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

  it("one note and two later gifts scores the matched gift only", () => {
    const { model, owner } = run(
      [donationNote({ noteDate: "8/4/2026" })],
      [
        postedGift({ id: 501, giftDate: "8/11/2026", amount: 25 }),
        postedGift({ id: 502, giftDate: "8/18/2026", amount: 35 }),
      ],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 25);
    assert.equal(owner.points, 100);
    assert.equal(model.totals.gifts, 1);
    assert.equal(model.totals.giftAmount, 25);
    assert.equal(model.totals.points, 100);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    const first = weekRec(owner, "8/11/2026");
    const second = weekRec(owner, "8/18/2026");
    assert.equal(first.gifts, 1);
    assert.equal(first.giftAmount, 25);
    assert.equal(first.points, 100);
    assert.equal(second.gifts, 0);
    assert.equal(second.giftAmount, 0);
  });

  it("gift dated the day before a donation note still counts (logged after it posted)", () => {
    const { owner, model } = run(
      [donationNote({ noteDate: "9/9/2026" })],
      [postedGift({ giftDate: "9/8/2026", amount: 103.3 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 103.3);
    assert.equal(owner.points, 100);
    assert.equal(model.gifts.length, 1);
  });

  it("gift more than 45 days before a donation note is not attributed", () => {
    const { model, owner, rows } = run(
      [donationNote({ noteDate: "9/9/2026" })],
      [postedGift({ giftDate: "7/20/2026", amount: 90 })],
    );
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.totals.gifts, 0);
    assert.ok(rows.some((r) => r.unmatched && r.bucket === "unmatched" && r.points === 0));
  });

  it("gift with no MA note is dropped even if GFT_Solicitor is on the roster", () => {
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
    }, ALANNA);
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
    }, "Sean Kelly");
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
  it("conversation before a gift is Incoming, not Raised, until a donation note", () => {
    const { owner, model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 51.01 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 10);
    assert.equal(model.possibleGifts?.length, 1);
    assert.equal(model.possibleGifts?.[0].inRaised, false);
  });

  it("dollars follow the MA who logged the donation note, not the solicitor on the account", () => {
    const ELENA = "Elena Barnes";
    const { model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement | New Donation or New AC",
        noteDate: "8/31/2026",
        contactId: 202,
      })],
      [postedGift({
        contactId: 202,
        giftDate: "8/31/2026",
        amount: 40,
        customFields: [{ name: "GFT_Solicitor", value: ALANNA }],
      })],
      ELENA,
    );
    const elena = model.tableOwners.find((o) => o.name === ELENA);
    const alanna = model.tableOwners.find((o) => o.name === ALANNA);
    assert.ok(elena);
    assert.ok(alanna);
    assert.equal(elena.giftAmount, 40);
    assert.equal(elena.gifts, 1);
    assert.equal(elena.points, 100);
    assert.equal(alanna.giftAmount, 0);
    assert.equal(alanna.gifts, 0);
  });

  it("in-person tour 18 days before a gift is Incoming, not Raised", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: "Sean Kelly",
        type: "In Person",
        noteDate: "8/14/2026",
        contactId: 101,
      })],
      [postedGift({ contactId: 101, giftDate: "9/1/2026", amount: 75 })],
      "Sean Kelly",
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 25);
    assert.equal(model.possibleGifts?.length, 1);
  });

  it("Gift Assist with a posted gift is 100 pts and $0", () => {
    const { owner, rows, model } = run(
      [donationNote({ type: "Mission Advancement | Gift Assist", noteDate: "8/20/2026" })],
      [postedGift({ giftDate: "8/20/2026", amount: 150 })],
    );
    assert.equal(owner.points, 100);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(model.gifts.length, 0);
    const assist = rows.find((r) => r.bucket === "gift" && r.points === 100);
    assert.ok(assist);
    assert.equal(String(assist.giftId), "501");
  });

  it("Gift Assist plus a tour is 125 pts and $0", () => {
    const { owner } = run(
      [
        donationNote({ type: "In Person", noteDate: "8/14/2026", id: 1 }),
        donationNote({ type: "Mission Advancement | Gift Assist", noteDate: "8/20/2026", id: 2 }),
      ],
      [postedGift({ giftDate: "9/1/2026", amount: 10000 })],
    );
    assert.equal(owner.points, 125);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("Sean Pfahl $10k assist is 100 pts and $0 without a Gift Assist note", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: "Sean Kelly",
        type: "In Person",
        noteDate: "8/14/2026",
        contactId: 84897,
        id: 9,
      })],
      [postedGift({ id: 451486, contactId: 84897, giftDate: "9/1/2026", amount: 10000 })],
      "Sean Kelly",
    );
    assert.equal(owner.points, 125);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(model.gifts.length, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("Gift Assist with no posted gift is not counted", () => {
    const { owner, rows } = run(
      [donationNote({ type: "Mission Advancement | Gift Assist" })],
    );
    assert.equal(owner.points, 0);
    assert.ok(rows.some((r) => r.unmatched));
  });

  it("note 50 days before a gift is outside the window", () => {
    const { owner } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "6/10/2026" })],
      [postedGift({ giftDate: "8/1/2026", amount: 200 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("donation note more than 45 days before a gift does not get 100 pts", () => {
    const { owner, rows } = run(
      [donationNote({ noteDate: "6/10/2026" })],
      [postedGift({ giftDate: "8/1/2026", amount: 200 })],
    );
    assert.equal(owner.points, 0);
    assert.equal(owner.gifts, 0);
    assert.ok(rows.some((r) => r.unmatched && r.bucket === "unmatched"));
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

  it("a letter or thank-you before a gift does not pull dollars", () => {
    const { owner } = run(
      [
        donationNote({ type: "Letter", noteDate: "8/10/2026", id: 1 }),
        donationNote({ type: "Mission Advancement Call | Email Reach Out", noteDate: "8/7/2026", id: 2 }),
        donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "8/7/2026", id: 3 }),
      ],
      [postedGift({ giftDate: "8/27/2026", amount: 100 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 8);
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

  it("Email Inactive is Bounced at 1 pt", () => {
    const scored = scoreAll({
      notes: [donationNote({ type: "Mission Advancement Call | Email Inactive", id: 23 })],
    }) as ScoredRow[];
    const row = scored.find((r) => r.noteId === 23);
    assert.ok(row);
    assert.equal(row.points, 1);
    const mix = trackerBreakdown(scored);
    const byId = Object.fromEntries(mix.lines.map((l) => [l.id, l]));
    assert.equal(byId.email_bounced.count, 1);
    assert.equal(byId.email_bounced.points, 1);
    assert.equal(byId.email_sent.count, 0);
  });

  it("Email Reach Out is Sent even if the write-up says bounced", () => {
    const scored = scoreAll({
      notes: [
        donationNote({
          type: "Mission Advancement Call | Email Reach Out",
          id: 25,
          note: "email bounced",
        }),
      ],
    }) as ScoredRow[];
    const row = scored.find((r) => r.noteId === 25);
    assert.ok(row);
    assert.equal(row.points, 2);
    const mix = trackerBreakdown(scored);
    const byId = Object.fromEntries(mix.lines.map((l) => [l.id, l]));
    assert.equal(byId.email_sent.count, 1);
    assert.equal(byId.email_bounced.count, 0);
  });

  it("Invalid Address scores 1 pt", () => {
    const { owner, rows } = run([
      donationNote({ type: "AS - Address Change/Update", id: 31 }),
    ]);
    const row = rows.find((r) => r.noteId === 31);
    assert.ok(row);
    assert.equal(row.points, 1);
    assert.equal(owner.points, 1);
    const mix = trackerBreakdown(rows);
    const byId = Object.fromEntries(mix.lines.map((l) => [l.id, l]));
    assert.equal(byId.invalid_updates.points, 1);
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

  it("Donation counts posted gifts and 100 pts from a matching donation note", () => {
    const { rows } = run(
      [donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/4/2026" })],
      [postedGift({ giftDate: "8/4/2026", amount: 75 })],
    );
    const mix = trackerBreakdown(rows);
    const donation = mix.lines.find((l) => l.id === "donation");
    assert.ok(donation);
    assert.equal(donation.count, 1);
    assert.equal(donation.points, 100);
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

describe("leaderboard period", () => {
  it("All range starts Monday of the second week of August 2026", () => {
    assert.equal(SETTINGS.evalStart, "2026-08-10");
    const start = evalStartDate();
    assert.equal(weekKey(start), "2026-08-10");
    const scored = scoreAll({
      notes: [
        donationNote({ type: "Letter", noteDate: "8/9/2026", id: 1 }),
        donationNote({ type: "Letter", noteDate: "8/10/2026", id: 2 }),
      ],
    }) as ScoredRow[];
    const model = aggregate(scored, { start, end: null }) as Model;
    assert.equal(model.rows.length, 1);
    assert.equal(model.rows[0].day, "2026-08-10");
    const owner = model.tableOwners.find((o) => o.name === ALANNA);
    assert.ok(owner);
    assert.equal(owner.points, 5);
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
    const scored = [
      ...scoreAll({
        notes: [
          donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/3/2026", id: 1 }),
          donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/4/2026", id: 2 }),
          donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/5/2026", id: 3 }),
        ],
      }),
      ...scoreTrackedEvents([
        { id: "e-best", owner: ALANNA, day: "2026-08-11", eventType: "event", hours: 12 },
      ]),
    ] as ScoredRow[];
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
    const alanna = model.bests?.owners?.find((o) => o.name === ALANNA);
    assert.ok(alanna);
    assert.equal(alanna.bestWeek, weekB);
    assert.equal(alanna.totalPoints, 330);
    assert.equal(model.bests?.teamTotalPoints, 330);
    const pts = alanna.points as { value: number; week: string | null };
    const conv = alanna.conversations as { value: number; week: string | null };
    assert.equal(pts.value, 300);
    assert.equal(pts.week, weekB);
    assert.equal(conv.value, 0);
    assert.equal(conv.week, weekB);
  });
});

describe("possible gifts", () => {
  it("conversation plus a posted gift with no donation note is a possible gift", () => {
    const { owner, model, rows } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", id: 11 })],
      [postedGift({ giftDate: "8/11/2026", amount: 51.01 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 10);
    assert.equal(rows.filter((r) => r.bucket === "possible").length, 1);
    assert.equal(model.possibleGifts?.length, 1);
    const possible = model.possibleGifts?.[0];
    assert.ok(possible);
    assert.equal(String(possible.giftId), "501");
    assert.equal(possible.amount, 51.01);
    assert.equal(possible.inRaised, false);
    assert.equal(possible.noteType, "Mission Advancement Call | Conversation");
    assert.equal(possible.daysAfterNote, 1);
    assert.equal(possible.owner, ALANNA);
    const csv = buildCalculationCSV(model);
    assert.match(csv, /INCOMING GIFTS/);
    assert.match(csv, /Jane Donor/);
    assert.doesNotMatch(csv, /DETAIL[\s\S]*Incoming gift/);
  });

  it("a matching Gift Assist note removes the gift from possible", () => {
    const { model, owner } = run(
      [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/20/2026", id: 1 }),
        donationNote({ type: "Mission Advancement | Gift Assist", noteDate: "8/20/2026", id: 2 }),
      ],
      [postedGift({ giftDate: "8/20/2026", amount: 150 })],
    );
    assert.equal(owner.points, 110);
    assert.equal(owner.giftAmount, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a matching donation note removes the gift from possible", () => {
    const { model, owner } = run(
      [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/4/2026", id: 1 }),
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/4/2026", id: 2 }),
      ],
      [postedGift({ giftDate: "8/4/2026", amount: 75 })],
    );
    assert.equal(owner.points, 110);
    assert.equal(owner.gifts, 1);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("voicemail or letter does not put a gift on possible", () => {
    const { model } = run(
      [
        donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "8/10/2026", id: 1 }),
        donationNote({ type: "Letter", noteDate: "8/10/2026", id: 2 }),
      ],
      [postedGift({ giftDate: "8/11/2026", amount: 200 })],
    );
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("gift 46 days after a conversation is not possible", () => {
    const { model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "6/10/2026" })],
      [postedGift({ giftDate: "8/1/2026", amount: 200 })],
    );
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("in-person meeting before a gift is possible when there is no donation note", () => {
    const { model } = run(
      [donationNote({
        createdByUser: "Sean Kelly",
        type: "In Person",
        noteDate: "8/14/2026",
        contactId: 84897,
        contactName: "Ursula Pfahl",
      })],
      [postedGift({ contactId: 84897, contactName: "Ursula Pfahl", giftDate: "9/1/2026", amount: 10000 })],
      "Sean Kelly",
    );
    assert.equal(model.possibleGifts?.length, 1);
    assert.equal(model.possibleGifts?.[0].owner, "Sean Kelly");
    assert.equal(model.possibleGifts?.[0].contactName, "Ursula Pfahl");
    assert.equal(model.possibleGifts?.[0].amount, 10000);
  });

  it("possible gifts are not points and stay out of the tracker mix", () => {
    const { owner, model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 80 })],
    );
    const mix = trackerBreakdown(model.rows);
    assert.equal(mix.totalPoints, 10);
    const donationLine = mix.lines.find((l) => l.id === "donation");
    assert.ok(donationLine);
    assert.equal(donationLine.count, 0);
    assert.equal(donationLine.points, 0);
    assert.equal(owner.points, 10);
    assert.equal(owner.giftAmount, 0);
    assert.equal(model.totals.points, 10);
  });

  it("lists every MA who spoke with the donor, one row per gift", () => {
    const { model } = run(
      [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", id: 1 }),
        donationNote({
          createdByUser: "Sean Kelly",
          type: "In Person",
          noteDate: "8/12/2026",
          id: 2,
        }),
      ],
      [postedGift({ giftDate: "8/20/2026", amount: 250, project: "Mission Fund" })],
    );
    assert.equal(model.possibleGifts?.length, 1);
    const g = model.possibleGifts?.[0];
    assert.ok(g);
    assert.equal(g.kind, "mission-fund");
    const names = (g.owners || []).map((o) => o.name).sort();
    assert.deepEqual(names, [ALANNA, "Sean Kelly"]);
  });

  it("labels an AC increase as incoming when there is no donation note", () => {
    const { model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({
        giftDate: "8/20/2026",
        amount: 240,
        acIncrease: true,
        priorMonthly: 20,
        newMonthly: 40,
        segment: "Annunciation Circle",
        frequency: "Monthly",
      })],
    );
    assert.equal(model.possibleGifts?.length, 1);
    assert.equal(model.possibleGifts?.[0].kind, "ac-increase");
  });

  it("a dismissed incoming gift leaves the Incoming list and does not score", () => {
    const { model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 80 })],
    );
    assert.equal(model.possibleGifts?.length, 1);
    const dismissed = aggregate(model.rows, {
      start: evalStartDate(),
      end: null,
      flags: { "gift:501": { status: "removed" } },
    }) as Model;
    assert.equal(dismissed.possibleGifts?.length ?? 0, 0);
    assert.equal(dismissed.totals.points, 10);
  });

  it("an assigned incoming gift scores 100 pts for that MA and leaves Incoming", () => {
    const flags = {
      "gift:501": {
        status: "assigned",
        owner: ALANNA,
        contactId: "101",
        contactName: "Jane Donor",
        day: "2026-08-11",
        type: "Mission Advancement | New Donation or New AC",
        noteId: "gift:501",
      },
    };
    const extra = assignedNotesFromFlags(flags);
    assert.equal(extra.length, 1);
    const { owner, model } = run(
      [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", id: 11 }),
        extra[0],
      ],
      [postedGift({ giftDate: "8/11/2026", amount: 51.01 })],
    );
    assert.equal(owner.points, 110);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 51.01);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });
});

describe("MGO-coded gifts do not credit MAs", () => {
  it("conversation note plus Direct Solicitation (MGO) gift is $0 for that MA", () => {
    const gift = postedGift({
      contactId: 84897,
      giftDate: "9/1/2026",
      amount: 10000,
      segment: "Direct Solicitation (MGO)",
    });
    assert.equal(isMgoAttributedGift(gift), true);
    assert.equal(scoreGift(gift, SEAN), null);
    const { owner, rows } = run(
      [donationNote({
        createdByUser: SEAN,
        type: "Mission Advancement Call | Conversation",
        noteDate: "8/14/2026",
        contactId: 84897,
      })],
      [gift],
      SEAN,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 10);
    assert.equal(rows.filter((r) => r.bucket === "donation" && !r.needsReview).length, 0);
    assert.equal(rows.filter((r) => r.bucket === "possible").length, 0);
  });

  it("MGO gift with an MA note is a review row, not Raised, until assigned", () => {
    const gift = postedGift({
      id: 9001,
      contactId: 84897,
      contactName: "QCD Donor",
      giftDate: "9/1/2026",
      amount: 10000,
      segment: "Direct Solicitation (MGO)",
    });
    const notes = [donationNote({
      createdByUser: SEAN,
      type: "Mission Advancement Call | Conversation",
      noteDate: "8/14/2026",
      contactId: 84897,
    })];
    const { owner, rows, model } = run(notes, [gift], SEAN);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 10);
    const review = rows.find((r) => r.needsReview);
    assert.ok(review);
    assert.equal(review.owner, SEAN);
    assert.equal(review.amount, 10000);
    assert.equal(review.giftId, 9001);
    assert.equal(review.bucket, "donation");
    assert.equal((model.reviewGifts || []).length, 1);
    assert.equal(model.reviewGifts?.[0].owner, SEAN);
    assert.equal(model.reviewGifts?.[0].amount, 10000);
    assert.equal(model.gifts.length, 0);
    assert.equal(isTaskListRow(review), false);
    const csv = buildCalculationCSV(model);
    assert.match(csv, /MGO-CODED GIFTS — listed for review, not in Raised until assigned/);
    assert.match(csv, /not in Raised until assigned/);
    assert.match(csv, /QCD Donor/);
  });

  it("assigned MGO gift credits the roster MA and leaves the review list", () => {
    const gift = postedGift({
      id: 9001,
      contactId: 84897,
      giftDate: "9/1/2026",
      amount: 10000,
      segment: "Direct Solicitation (MGO)",
    });
    const notes = [donationNote({
      createdByUser: SEAN,
      type: "Mission Advancement Call | Conversation",
      noteDate: "8/14/2026",
      contactId: 84897,
    })];
    const { owner, rows, model } = run(
      notes,
      [gift],
      SEAN,
      { "gift:9001": { status: "assigned", owner: SEAN } },
    );
    assert.equal(owner.giftAmount, 10000);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(rows.filter((r) => r.needsReview).length, 0);
    assert.equal((model.reviewGifts || []).length, 0);
    assert.equal(model.gifts.length, 1);
    assert.equal(model.gifts[0].owner, SEAN);
    assert.equal(model.gifts[0].amount, 10000);
    assert.equal(model.gifts[0].mgoAssigned, true);
    assert.equal(model.gifts[0].removed, false);
    const credited = model.rows.find((r) => r.giftId === 9001) as ScoredRow | undefined;
    assert.ok(credited);
    assert.equal(credited.mgoAssigned, true);
    assert.equal(credited.removed, false);
    assert.equal(isTaskListRow(credited), false);
    assert.equal(scoreGift(gift, SEAN, SEAN)?.owner, SEAN);
  });

  it("auto-credited gift dollar rows stay on the Tasks list", () => {
    const { model } = run(
      [donationNote()],
      [postedGift({ amount: 75 })],
    );
    const donation = model.rows.find((r) => r.bucket === "donation") as ScoredRow | undefined;
    assert.ok(donation);
    assert.equal(donation.mgoAssigned, undefined);
    assert.equal(isTaskListRow(donation), true);
  });

  it("assigned owner must be on the MA roster", () => {
    const gift = postedGift({
      id: 9002,
      contactId: 84897,
      giftDate: "9/1/2026",
      amount: 10000,
      segment: "Direct Solicitation (MGO)",
    });
    const { owner, model } = run(
      [donationNote({
        createdByUser: SEAN,
        type: "Mission Advancement Call | Conversation",
        noteDate: "8/14/2026",
        contactId: 84897,
      })],
      [gift],
      SEAN,
      { "gift:9002": { status: "assigned", owner: "Colleen Dolnick" } },
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(model.totals.giftAmount, 0);
    assert.equal((model.reviewGifts || []).length, 1);
    assert.equal(model.reviewGifts?.[0].owner, SEAN);
  });

  it("MGO gift with no MA note is skipped, not listed for review", () => {
    const gift = postedGift({
      id: 9004,
      amount: 10000,
      giftDate: "9/1/2026",
      segment: "Direct Solicitation (MGO)",
    });
    const { owner, rows, model } = run([], [gift]);
    assert.equal(owner.giftAmount, 0);
    assert.equal(rows.filter((r) => r.needsReview).length, 0);
    assert.equal((model.reviewGifts || []).length, 0);
  });

  it("assigned flag with missing owner falls back to the MA hint", () => {
    const gift = postedGift({
      id: 9005,
      contactId: 84897,
      giftDate: "9/1/2026",
      amount: 10000,
      segment: "Direct Solicitation (MGO)",
    });
    const { owner } = run(
      [donationNote({
        createdByUser: SEAN,
        type: "Mission Advancement Call | Conversation",
        noteDate: "8/14/2026",
        contactId: 84897,
      })],
      [gift],
      SEAN,
      { "gift:9005": { status: "assigned" } },
    );
    assert.equal(owner.giftAmount, 10000);
    assert.equal(owner.gifts, 1);
  });

  it("assigned MGO gift can pair with a donation note for 100 pts", () => {
    const gift = postedGift({
      id: 9003,
      contactId: 84897,
      giftDate: "9/1/2026",
      amount: 10000,
      segment: "Direct Solicitation (MGO)",
    });
    const { owner, model } = run(
      [donationNote({
        createdByUser: SEAN,
        type: "Mission Advancement | New Donation or New AC",
        noteDate: "8/14/2026",
        contactId: 84897,
      })],
      [gift],
      SEAN,
      { "gift:9003": { status: "assigned", owner: SEAN } },
    );
    assert.equal(owner.giftAmount, 10000);
    assert.equal(owner.points, 100);
    assert.equal((model.reviewGifts || []).length, 0);
  });

  it("Direct Solicitation (MGO)-HIST_DS is excluded", () => {
    const gift = postedGift({
      amount: 100,
      giftDate: "8/11/2026",
      segment: "Direct Solicitation (MGO)-HIST_DS",
    });
    assert.equal(isMgoAttributedGift(gift), true);
    assert.equal(scoreGift(gift, ALANNA), null);
    const { owner } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [gift],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("White Mail and Annunciation Circle still credit with a donation note", () => {
    const { owner } = run(
      [
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/10/2026", contactId: 101, id: 1 }),
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/10/2026", contactId: 102, id: 2 }),
      ],
      [
        postedGift({ id: 501, contactId: 101, giftDate: "8/11/2026", amount: 50, segment: "White Mail" }),
        postedGift({ id: 502, contactId: 102, giftDate: "8/11/2026", amount: 75, segment: "Annunciation Circle" }),
      ],
    );
    assert.equal(owner.giftAmount, 125);
    assert.equal(owner.gifts, 2);
    assert.equal(owner.points, 200);
    assert.equal(isMgoAttributedGift(postedGift({ segment: "White Mail" })), false);
  });

  it("Spring Appeal Chapel Direct Mail is not treated as MGO", () => {
    const gift = postedGift({
      amount: 40,
      giftDate: "8/11/2026",
      segment: "FYE26 Spring Appeal Chapel Direct Mail",
    });
    assert.equal(isMgoAttributedGift(gift), false);
    const { owner } = run(
      [donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/10/2026" })],
      [gift],
    );
    assert.equal(owner.giftAmount, 40);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 100);
  });

  it("non-MA GFT_Solicitor is excluded even on White Mail", () => {
    const gift = postedGift({
      amount: 200,
      giftDate: "8/11/2026",
      segment: "White Mail",
      solicitor: "Colleen Dolnick",
    });
    const viaField = postedGift({
      id: 502,
      amount: 150,
      contactId: 102,
      giftDate: "8/11/2026",
      segment: "White Mail",
      customFields: [{ name: "GFT_Solicitor", value: "Colleen Dolnick" }],
    });
    assert.equal(isMgoAttributedGift(gift), true);
    assert.equal(isMgoAttributedGift(viaField), true);
    assert.equal(scoreGift(gift, ALANNA), null);
    const { owner } = run(
      [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", contactId: 101, id: 1 }),
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", contactId: 102, id: 2 }),
      ],
      [gift, viaField],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("roster solicitor with no note does not attribute (GFT_Solicitor is not the owner)", () => {
    const gift = postedGift({ amount: 50, solicitor: SEAN });
    assert.equal(isMgoAttributedGift(gift), false);
    assert.equal(scoreGift(gift), null);
    const { owner } = run([], [gift], SEAN);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("monthly AC with MGO segment does not add dollars after prepareGifts", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 451107,
          contactId: 70510,
          giftDate: "8/11/2026",
          amount: 51.01,
          segment: "Direct Solicitation (MGO)",
        }),
      ],
      [
        {
          id: 3834,
          contactId: 70510,
          startDate: "2026-08-11",
          amount: 51.01,
          frequency: "Monthly",
          segment: "Direct Solicitation (MGO)",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    assert.equal(merged.length, 1);
    assert.equal(isMgoAttributedGift(merged[0]), true);
    const { owner } = run(
      [donationNote({ contactId: 70510, type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      merged,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("posted MGO installment plus AC RecurringGift stays MGO and does not auto-credit", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 451107,
          contactId: 70510,
          contactName: "Dustin and Margaret Hamacher",
          giftDate: "8/11/2026",
          amount: 51.01,
          segment: "Direct Solicitation (MGO)",
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
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    assert.equal(merged.length, 1);
    assert.equal(isMgoAttributedGift(merged[0]), true);
    assert.equal(String(merged[0].segment), "Direct Solicitation (MGO)");
    const notes = [donationNote({
      contactId: 70510,
      type: "Mission Advancement Call | Conversation",
      noteDate: "8/10/2026",
    })];
    const { owner, rows, model } = run(notes, merged);
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.notEqual(owner.giftAmount, 612.12);
    const review = rows.find((r) => r.needsReview);
    assert.ok(review);
    assert.equal(review.amount, 612.12);
    assert.equal((model.reviewGifts || []).length, 1);
    assert.equal(model.gifts.length, 0);

    const assigned = run(
      notes,
      merged,
      ALANNA,
      { "gift:rg-3834": { status: "assigned", owner: ALANNA } },
    );
    assert.equal(assigned.owner.giftAmount, 612.12);
    assert.equal(assigned.owner.gifts, 1);
    assert.equal(assigned.model.gifts[0].mgoAssigned, true);
    assert.equal(isTaskListRow(assigned.model.rows.find((r) => r.giftId === "rg-3834") as ScoredRow), false);
  });
});

describe("dashboard-tracked event hours", () => {
  it("hours × 25 points per hour", () => {
    assert.equal(eventPointsForHours(1), 25);
    assert.equal(eventPointsForHours(4), 100);
    assert.equal(eventPointsForHours(1.5), 37.5);
    assert.equal(eventPointsForHours(0), 0);
    assert.equal(eventPointsForHours(-2), 0);
  });

  it("adds event points to the MA dashboard totals", () => {
    const eventRows = scoreTrackedEvents([
      { id: "e1", owner: ALANNA, day: "2026-08-12", eventType: "event", hours: 4, name: "Homecoming" },
    ]) as ScoredRow[];
    assert.equal(eventRows.length, 1);
    assert.equal(eventRows[0].points, 100);
    assert.equal(eventRows[0].bucket, "event");
    assert.equal(eventRows[0].owner, ALANNA);
    assert.equal(eventRows[0].noteId, "event:e1");
    assert.equal(eventRows[0].day, "2026-08-12");
    assert.equal(eventRows[0].hours, 4);
    assert.equal(eventRows[0].tracked, true);
    const noteRows = scoreAll({ notes: [donationNote({ type: "Letter" })] }) as ScoredRow[];
    const model = aggregate([...noteRows, ...eventRows], {}) as Model;
    const owner = model.tableOwners.find((o) => o.name === ALANNA);
    assert.ok(owner);
    assert.equal(owner.points, 105);
    const mix = trackerBreakdown([...noteRows, ...eventRows]);
    const events = mix.lines.find((l) => l.id === "events");
    assert.ok(events);
    assert.equal(events.count, 1);
    assert.equal(events.points, 100);
  });

  it("Marketing Event hours also score 25 per hour", () => {
    const rows = scoreTrackedEvents([
      { id: "m1", owner: SEAN, day: "2026-08-13", eventType: "marketing", hours: 2 },
    ]) as ScoredRow[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].points, 50);
    assert.equal(rows[0].type, "Mission Advancement | Marketing Event");
    const model = aggregate(rows, {}) as Model;
    const owner = model.tableOwners.find((o) => o.name === SEAN);
    assert.ok(owner);
    assert.equal(owner.points, 50);
  });

  it("Virtuous Event notes do not score", () => {
    const { owner, rows } = run([
      donationNote({ type: "Mission Advancement | Event", id: 9 }),
      donationNote({ type: "Mission Advancement | Marketing Event", id: 10 }),
    ]);
    assert.equal(owner.points, 0);
    assert.equal(rows.filter((r) => r.bucket === "event" || r.noteId === 9 || r.noteId === 10).length, 0);
  });

  it("ignores events before the MA start date and unknown owners", () => {
    const rows = scoreTrackedEvents([
      { id: "early", owner: NATALIA, day: "2026-07-10", eventType: "event", hours: 3 },
      { id: "ok", owner: NATALIA, day: "2026-08-12", eventType: "event", hours: 2 },
      { id: "ghost", owner: "Not An MA", day: "2026-08-12", eventType: "event", hours: 8 },
    ]) as ScoredRow[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].noteId, "event:ok");
    assert.equal(rows[0].points, 50);
  });
});




