import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MA_NAMES, SETTINGS, evalStartDate, tierFor } from "./config.js";
import { assignedNotesFromFlags, contactDisplayName, eventPointsForHours, giftKindOf, isGalaGift, isMgoAttributedGift, isMonthlyRecurring, isPendingGalaSiteTicket, outreachBeforeGift, parseDate, portfolioOwnersFromSnapshot, prepareGifts, priorAcMonthly, scoreAll, scoreGift, scoreTrackedEvents } from "./points.js";
import { galaSiteGiftId, mergeGalaSiteTickets, uniqueEmailContactIndex } from "./gala-site-tickets.js";
import { COUNTED_SPREADSHEET_GIFTS, matchCountedSpreadsheetGift } from "./counted-gifts.js";
import { aggregate, daysOfWeek, isTaskListRow, rowMatchesTracker, trackerBreakdown, trackerSpec, weekKey } from "./aggregate.js";
import { buildCalculationCSV, statusOf, virtuousGiftUrl } from "./report.js";
import { projectTypeFor } from "./tracked-events";

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
    galaSite?: boolean;
    emailMatch?: string | null;
    schedule?: string | null;
    lastGiftDay?: string | null;
    lastGiftSchedule?: string | null;
    lastNoteDay?: string | null;
    lastNoteType?: string | null;
    owners?: Array<{ name: string; noteType?: string; daysAfterNote?: number }>;
  }>;
  reviewGifts?: Array<{
    amount?: number;
    owner?: string;
    giftId?: unknown;
    needsReview?: boolean;
    contactName?: string;
    label?: string;
    schedule?: string;
    lastGiftDay?: string | null;
    lastGiftSchedule?: string | null;
    lastNoteDay?: string | null;
    lastNoteType?: string | null;
  }>;
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
  touchCount?: number;
  touchLabel?: string;
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
  countedGifts: unknown[] = [],
  portfolios: Record<string, string> = {},
) {
  const rows = scoreAll({ notes, gifts, flags, countedGifts, portfolios }) as ScoredRow[];
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
    const secured = rows.filter((r) => r.bucket === "donation" && r.points === 100);
    assert.equal(secured.length, 1);
    assert.equal(String(secured[0].giftId), "501");
    assert.equal(secured[0].label, "Gift");
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
    assert.equal(rows.filter((r) => r.bucket === "donation" && r.points === 100).length, 1);
    assert.equal(rows.filter((r) => r.bucket === "gift" && r.points === 100).length, 0);
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

  it("gift more than 90 days before a donation note is not attributed", () => {
    const { model, owner, rows } = run(
      [donationNote({ noteDate: "9/9/2026" })],
      [postedGift({ giftDate: "6/10/2026", amount: 90 })],
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
    // Last AC was Nov 2025 — lapsed. Restart is the full $40 × 12, not the $7.50 raise.
    assert.equal(monthly.amount, 40);
    assert.equal(monthly.acIncrease, false);
    assert.equal(monthly.priorMonthly, null);
    assert.equal(merged.some((g: { id?: number | string }) => g.id === 450744), false);

    const { owner, rows } = run(
      [donationNote({ contactId: 88058, noteDate: "7/28/2026", type: "Mission Advancement | New Donation or New AC" })],
      merged,
    );
    assert.equal(owner.giftAmount, 480);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 100);
    const giftRow = rows.find((r) => r.bucket === "donation");
    assert.ok(giftRow);
    assert.equal(giftRow.amount, 480);
    assert.match(String(giftRow.label), /Gift \(monthly ×12\)/);
    assert.equal(giftRow.points, 100);
  });

  it("credits only the increase when an active AC is raised", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 1,
          contactId: 88058,
          contactName: "Active AC member",
          giftDate: "7/15/2026",
          amount: 32.5,
          segment: "Annunciation Circle",
        }),
        postedGift({
          id: 450744,
          contactId: 88058,
          contactName: "Active AC member",
          giftDate: "7/30/2026",
          amount: 40,
          segment: "Annunciation Circle",
        }),
      ],
      [
        {
          id: 3823,
          contactId: 88058,
          contactName: "Active AC member",
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
    };
    assert.ok(monthly);
    assert.equal(monthly.amount, 7.5);
    assert.equal(monthly.acIncrease, true);
    assert.equal(monthly.priorMonthly, 32.5);
    const { owner } = run(
      [donationNote({ contactId: 88058, noteDate: "7/28/2026", type: "Mission Advancement | Annunciation Circle Updated" })],
      merged,
    );
    assert.equal(owner.giftAmount, 90);
  });

  it("a lapsed AC who signs up again is the full monthly amount × 12", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 1,
          contactId: 77001,
          contactName: "Patrick and Erica Applegate",
          giftDate: "1/12/2025",
          amount: 31.2,
          segment: "Annunciation Circle",
        }),
        postedGift({
          id: 2,
          contactId: 77001,
          contactName: "Patrick and Erica Applegate",
          giftDate: "8/12/2026",
          amount: 31.2,
          segment: "Annunciation Circle",
        }),
      ],
      [
        {
          id: 4001,
          contactId: 77001,
          contactName: "Patrick and Erica Applegate",
          startDate: "2026-08-12",
          amount: 31.2,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    const monthly = merged.find((g: { frequency?: string }) => g.frequency === "Monthly") as { amount: number; acIncrease?: boolean };
    assert.ok(monthly);
    assert.equal(monthly.amount, 31.2);
    assert.equal(monthly.acIncrease, false);
    const { owner } = run(
      [donationNote({
        createdByUser: ALANNA,
        contactId: 77001,
        contactName: "Patrick and Erica Applegate",
        noteDate: "8/12/2026",
        type: "Mission Advancement | New Donation or New AC",
      })],
      merged,
    );
    assert.equal(owner.giftAmount, 374.4);
    assert.equal(owner.gifts, 1);
  });

  it("counts a cancelled Mission Fund monthly gift as the prior when the new Circle starts within 45 days", () => {
    // Contact 82800: $25 Mission Fund cancelled 2026-07-24, $50 Annunciation Circle started 2026-07-30.
    const merged = prepareGifts(
      [
        postedGift({
          id: 450745,
          contactId: 82800,
          contactName: "Kai and Josephine Olander",
          giftDate: "7/30/2026",
          amount: 50,
          segment: "Annunciation Circle",
        }),
      ],
      [
        {
          id: 1817,
          contactId: 82800,
          contactName: "Kai and Josephine Olander",
          startDate: "2020-04-22T00:00:00",
          amount: 25,
          frequency: "Monthly",
          status: "Cancelled",
          cancelDateTimeUtc: "2026-07-24T20:12:04.07",
          segment: "Expired Appeal-HIST_OT",
          designations: [{ project: "AMU Mission Fund" }],
          priorOnly: true,
        },
        {
          id: 3824,
          contactId: 82800,
          contactName: "Kai and Josephine Olander",
          startDate: "2026-07-30T00:00:00",
          amount: 50,
          frequency: "Monthly",
          status: "UpToDate",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    assert.equal(merged.some((g: { id?: number | string }) => g.id === "rg-1817" || g.id === 1817), false);
    assert.equal(merged.some((g: { id?: number | string }) => g.id === 450745), false);
    const monthly = merged.find((g: { id?: number | string }) => g.id === "rg-3824") as {
      amount: number;
      acIncrease?: boolean;
      priorMonthly?: number;
      newMonthly?: number;
    };
    assert.ok(monthly);
    assert.equal(monthly.amount, 25);
    assert.equal(monthly.acIncrease, true);
    assert.equal(monthly.priorMonthly, 25);
    assert.equal(monthly.newMonthly, 50);

    const { owner, rows } = run(
      [donationNote({
        createdByUser: "Caleb Metzen",
        contactId: 82800,
        contactName: "Kai and Josephine Olander",
        noteDate: "7/30/2026",
        type: "Mission Advancement | New Donation or New AC",
      })],
      merged,
      "Caleb Metzen",
    );
    assert.equal(owner.giftAmount, 300);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 100);
    const giftRow = rows.find((r) => r.bucket === "donation");
    assert.ok(giftRow);
    assert.match(String(giftRow.label), /AC increase \(\$25 → \$50\/mo, ×12\)/);
  });

  it("uses the higher of a recent Circle payment and a cancelled monthly gift", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 1,
          contactId: 82800,
          giftDate: "7/15/2026",
          amount: 32.5,
          segment: "Annunciation Circle",
        }),
      ],
      [
        {
          id: 1817,
          contactId: 82800,
          startDate: "2020-04-22T00:00:00",
          amount: 25,
          frequency: "Monthly",
          status: "Cancelled",
          cancelDateTimeUtc: "2026-07-24T20:12:04.07",
          priorOnly: true,
        },
        {
          id: 3824,
          contactId: 82800,
          startDate: "2026-07-30T00:00:00",
          amount: 40,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    const monthly = merged.find((g: { id?: number | string }) => g.id === "rg-3824") as {
      amount: number;
      priorMonthly?: number;
    };
    assert.equal(monthly.amount, 7.5);
    assert.equal(monthly.priorMonthly, 32.5);
  });

  it("a monthly gift cancelled more than 45 days earlier stays a new gift", () => {
    const merged = prepareGifts(
      [],
      [
        {
          id: 1817,
          contactId: 82800,
          startDate: "2020-04-22T00:00:00",
          amount: 25,
          frequency: "Monthly",
          status: "Cancelled",
          cancelDateTimeUtc: "2026-05-01T00:00:00",
          priorOnly: true,
        },
        {
          id: 3824,
          contactId: 82800,
          startDate: "2026-07-30T00:00:00",
          amount: 50,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    const monthly = merged.find((g: { id?: number | string }) => g.id === "rg-3824") as {
      amount: number;
      acIncrease?: boolean;
    };
    assert.ok(monthly);
    assert.equal(monthly.amount, 50);
    assert.equal(monthly.acIncrease, false);
    assert.equal(merged.some((g: { id?: number | string }) => g.id === "rg-1817"), false);
  });

  it("a same or lower monthly gift after a recent cancellation is not a new gift", () => {
    const merged = prepareGifts(
      [],
      [
        {
          id: 1817,
          contactId: 82800,
          startDate: "2020-04-22T00:00:00",
          amount: 50,
          frequency: "Monthly",
          status: "Cancelled",
          cancelDateTimeUtc: "2026-07-24T00:00:00",
          priorOnly: true,
        },
        {
          id: 3824,
          contactId: 82800,
          startDate: "2026-07-30T00:00:00",
          amount: 25,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    const monthly = merged.find((g: { id?: number | string }) => g.id === "rg-3824") as { amount: number; acIncrease?: boolean };
    assert.ok(monthly);
    assert.equal(monthly.amount, 0);
    assert.equal(monthly.acIncrease, false);
  });

  it("still scores a cancelled monthly gift that started inside the feed", () => {
    const merged = prepareGifts([], [
      {
        id: 9,
        contactId: 82800,
        contactName: "Recent cancel",
        startDate: "2026-07-01T00:00:00",
        amount: 30,
        frequency: "Monthly",
        status: "Cancelled",
        cancelDateTimeUtc: "2026-07-20T00:00:00",
        segment: "Annunciation Circle",
        designations: [{ project: "Annunciation Circle" }],
      },
    ]);
    const monthly = merged.find((g: { id?: number | string }) => g.id === "rg-9") as { amount: number };
    assert.ok(monthly);
    assert.equal(monthly.amount, 30);
  });

  it("a tracker row does not raise a same-rate AC continuation", () => {
    const merged = prepareGifts(
      [
        postedGift({
          id: 1,
          contactId: 77001,
          contactName: "Patrick and Erica Applegate",
          giftDate: "7/12/2026",
          amount: 31.2,
          segment: "Annunciation Circle",
        }),
        postedGift({
          id: 2,
          contactId: 77001,
          contactName: "Patrick and Erica Applegate",
          giftDate: "8/12/2026",
          amount: 31.2,
          segment: "Annunciation Circle",
        }),
      ],
      [
        {
          id: 4001,
          contactId: 77001,
          contactName: "Patrick and Erica Applegate",
          startDate: "2026-08-12",
          amount: 31.2,
          frequency: "Monthly",
          segment: "Annunciation Circle",
          designations: [{ project: "Annunciation Circle" }],
        },
      ],
    );
    const { owner, model } = run(
      [donationNote({
        createdByUser: ALANNA,
        contactId: 77001,
        contactName: "Patrick and Erica Applegate",
        noteDate: "8/12/2026",
        type: "Mission Advancement Call | Conversation",
      })],
      merged,
      ALANNA,
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 10);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
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
    const monthly = merged.find((g: { frequency?: string; amount?: number }) => g.frequency === "Monthly");
    assert.ok(monthly);
    assert.equal(monthly.amount, 0);
    assert.equal(merged.some((g: { id?: number | string }) => g.id === 2), false);
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
  it("a conversation before a gift counts the dollars", () => {
    const { owner, model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 51.01 })],
    );
    assert.equal(owner.giftAmount, 51.01);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
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

  it("an in-person visit 18 days before a gift counts the dollars", () => {
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
    assert.equal(owner.giftAmount, 75);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 125);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
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

  it("note 91 days before a gift is outside the window", () => {
    const { owner } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "6/16/2026" })],
      [postedGift({ giftDate: "9/15/2026", amount: 200 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("donation note more than 90 days before a gift does not get 100 pts", () => {
    const { owner, rows } = run(
      [donationNote({ noteDate: "6/16/2026" })],
      [postedGift({ giftDate: "9/15/2026", amount: 200 })],
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

  it("a voicemail, email, or letter before a gift counts the dollars", () => {
    const { owner } = run(
      [
        donationNote({ type: "Letter", noteDate: "8/10/2026", id: 1 }),
        donationNote({ type: "Mission Advancement Call | Email Reach Out", noteDate: "8/7/2026", id: 2 }),
        donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "8/7/2026", id: 3 }),
      ],
      [postedGift({ giftDate: "8/27/2026", amount: 100 })],
    );
    assert.equal(owner.giftAmount, 100);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 108);
  });

  it("a thank-you the day after a gift does not claim it", () => {
    const { owner, model } = run(
      [donationNote({
        type: "Mission Advancement Call | Voicemail",
        noteDate: "8/12/2026",
        note: "TY CC vm",
      })],
      [postedGift({ giftDate: "8/11/2026", amount: 100 })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(model.gifts.length, 0);
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

  it("counts contacts before the gift and names the closest one", () => {
    const { rows, owner } = run(
      [
        donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "7/20/2026", id: 1 }),
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/1/2026", id: 2 }),
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/4/2026", id: 3 }),
      ],
      [postedGift({ giftDate: "8/4/2026", amount: 75 })],
    );
    const gift = rows.find((r) => r.bucket === "donation");
    assert.ok(gift);
    assert.equal(gift.touchCount, 2);
    assert.equal(gift.touchLabel, "Phone conversation");
    assert.equal(owner.points, 111);
    assert.equal(owner.gifts, 1);
  });

  it("a verbal gift commitment is a follow-up, not points", () => {
    const { rows, model, owner } = run(
      [donationNote({
        type: "Mission Advancement | Verbal Gift Commitment",
        noteDate: "8/4/2026",
        id: 9,
        note: "She said she will send $500 next week",
      })],
      [],
    );
    const note = rows.find((r) => r.bucket === "commitment");
    assert.ok(note);
    assert.equal(note.points, 0);
    assert.equal(note.label, "Verbal commitment");
    assert.equal(owner.points, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(model.rows.filter((r) => r.bucket === "commitment").length, 0);
    assert.equal(isTaskListRow(note), false);
  });

  it("an obituary that says commitment is not a verbal commitment", () => {
    const notes = [{
      owner: ALANNA,
      type: "Obituary",
      bucket: "obituary",
      label: "Obituary",
      date: parseDate("8/4/2026"),
      text: "His unwavering commitment to his family",
    }];
    const touch = outreachBeforeGift(parseDate("8/11/2026"), notes, ALANNA);
    assert.equal(touch.touchCount, 0);
    assert.equal(touch.touchLabel, "No contact logged");
  });

  it("a counted gift uses the closest contact type when outreach is older than 90 days", () => {
    const { rows, owner } = run(
      [
        donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "6/1/2026", id: 1 }),
        donationNote({ type: "Letter", noteDate: "6/10/2026", id: 2 }),
        donationNote({ type: "Mission Advancement Call | Invalid Number", noteDate: "6/20/2026", id: 3 }),
        donationNote({ type: "Obituary", noteDate: "6/21/2026", id: 4 }),
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "9/16/2026", id: 5 }),
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "9/15/2026", id: 6 }),
      ],
      [postedGift({ giftDate: "9/15/2026", amount: 80 })],
    );
    const gift = rows.find((r) => r.bucket === "donation");
    assert.ok(gift);
    assert.equal(gift.touchCount, 2);
    assert.equal(gift.touchLabel, "Handwritten note / letter");
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 80);
  });

  it("outreach older than 90 days does not count a gift by itself", () => {
    const { owner, rows } = run(
      [donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "6/1/2026", id: 1 })],
      [postedGift({ giftDate: "9/15/2026", amount: 80 })],
    );
    assert.equal(owner.gifts, 0);
    assert.equal(rows.filter((r) => r.bucket === "donation" && r.points === 100).length, 0);
  });

  it("a contact inside 90 days stays the reached-by label when older outreach exists", () => {
    const { rows } = run(
      [
        donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "6/1/2026", id: 1 }),
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "9/1/2026", id: 2 }),
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "9/15/2026", id: 3 }),
      ],
      [postedGift({ giftDate: "9/15/2026", amount: 80 })],
    );
    const gift = rows.find((r) => r.bucket === "donation");
    assert.ok(gift);
    assert.equal(gift.touchCount, 1);
    assert.equal(gift.touchLabel, "Phone conversation");
  });

  it("a counted gift with only a non-contact note stays No contact logged", () => {
    const { rows } = run(
      [
        donationNote({ type: "Obituary", noteDate: "6/1/2026", id: 1 }),
        donationNote({ type: "Mission Advancement Call | Invalid Number", noteDate: "6/2/2026", id: 2 }),
        donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/4/2026", id: 3 }),
      ],
      [postedGift({ giftDate: "8/4/2026", amount: 40 })],
    );
    const gift = rows.find((r) => r.bucket === "donation");
    assert.ok(gift);
    assert.equal(gift.touchCount, 0);
    assert.equal(gift.touchLabel, "No contact logged");
  });

  it("Gift chart counts one row per posted gift, with the 100 pts on that row", () => {
    const { rows } = run(
      [donationNote({ type: "Mission Advancement | New Donation or New AC", noteDate: "8/4/2026" })],
      [postedGift({ giftDate: "8/4/2026", amount: 75, contactName: "Jane Donor" })],
    );
    const gifts = rows.filter((r) => r.bucket === "donation");
    assert.equal(gifts.length, 1);
    assert.equal(gifts[0].label, "Gift");
    assert.equal(gifts[0].points, 100);
    assert.equal(gifts[0].amount, 75);
    assert.equal(rows.filter((r) => r.points === 100).length, 1);
    const mix = trackerBreakdown(rows);
    const donation = mix.lines.find((l) => l.id === "donation");
    assert.ok(donation);
    assert.equal(donation.label, "Gift");
    assert.equal(donation.count, 1);
    assert.equal(donation.points, 100);
    const listed = rows.filter((r) => rowMatchesTracker(r, trackerSpec("donation")));
    assert.equal(listed.length, 1);
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

describe("sheet tier names", () => {
  it("uses Tier 1 for far exceeds, Tier 2 for exceeds, and Tier 3 for meets", () => {
    assert.equal(tierFor(200).label, "Tier 1");
    assert.equal(tierFor(200).meaning, "Far Exceeds Expectation");
    assert.equal(tierFor(100).label, "Tier 2");
    assert.equal(tierFor(100).meaning, "Exceeds Expectation");
    assert.equal(tierFor(99).label, "Tier 3");
    assert.equal(tierFor(0).meaning, "Meets Expectation");
  });
});

describe("leaderboard period", () => {
  it("All range starts Monday June 1, 2026", () => {
    assert.equal(SETTINGS.evalStart, "2026-06-01");
    const start = evalStartDate();
    assert.equal(weekKey(start), "2026-06-01");
    const scored = scoreAll({
      notes: [
        donationNote({ type: "Letter", noteDate: "5/31/2026", id: 1 }),
        donationNote({ type: "Letter", noteDate: "6/1/2026", id: 2 }),
      ],
    }) as ScoredRow[];
    const model = aggregate(scored, { start, end: null }) as Model;
    assert.equal(model.rows.length, 1);
    assert.equal(model.rows[0].day, "2026-06-01");
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

  it("removing a counted gift drops Raised and the 100 points and keeps the row", () => {
    const notes = [donationNote({ type: "Letter", noteDate: "8/1/2026", id: 1 })];
    const gifts = [postedGift({ id: 501, giftDate: "8/4/2026", amount: 80 })];
    const kept = run(notes, gifts);
    assert.equal(kept.owner.gifts, 1);
    assert.equal(kept.owner.giftAmount, 80);
    assert.equal(kept.owner.points, 105);

    const dropped = run(notes, gifts, ALANNA, { "gift-remove:501": { status: "removed" } });
    assert.equal(dropped.owner.gifts, 0);
    assert.equal(dropped.owner.giftAmount, 0);
    assert.equal(dropped.owner.points, 5);
    assert.equal(dropped.model.gifts.length, 0);
    const row = dropped.model.rows.find((r) => String(r.giftId) === "501");
    assert.ok(row);
    assert.equal(row.removed, true);
  });

  it("removing a portfolio gift drops it and leaves the row to count again", () => {
    const gift = postedGift({
      contactId: 84897,
      id: 908,
      giftDate: "9/15/2026",
      amount: 150,
      segment: "Direct Solicitation (MGO)",
    });
    const kept = run([], [gift], SEAN, {}, [], { "84897": SEAN });
    assert.equal(kept.owner.gifts, 1);
    assert.equal(kept.owner.giftAmount, 150);

    const dropped = run([], [gift], SEAN, { "gift-remove:908": { status: "removed" } }, [], { "84897": SEAN });
    assert.equal(dropped.owner.gifts, 0);
    assert.equal(dropped.owner.giftAmount, 0);
    assert.equal(dropped.owner.points, 0);
    const row = dropped.model.rows.find((r) => String(r.giftId) === "908");
    assert.ok(row);
    assert.equal(row.removed, true);
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
    assert.equal(owner.giftAmount, 51.01);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(rows.filter((r) => r.bucket === "possible").length, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
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

  it("a conversation 52 days before the gift is Raised", () => {
    const { owner, model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "6/10/2026" })],
      [postedGift({ giftDate: "8/1/2026", amount: 200 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 200);
    assert.equal(owner.points, 110);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a recurring gift waiting on review shows the previous gift as one-time or recurring", () => {
    const { model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [
        postedGift({ id: 1, giftDate: "5/1/2026", amount: 25 }),
        postedGift({ id: 2, giftDate: "8/20/2026", amount: 40, frequency: "Monthly" }),
      ],
    );
    const waiting = model.reviewGifts?.find((g) => g.giftId === 2);
    assert.ok(waiting);
    assert.equal(waiting.schedule, "Recurring");
    assert.equal(waiting.lastGiftDay, "2026-05-01");
    assert.equal(waiting.lastGiftSchedule, "One-time");
    assert.equal(waiting.lastNoteDay, "2026-08-10");
    assert.equal(waiting.lastNoteType, "Phone conversation");
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
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal(model.gifts[0].owner, "Sean Kelly");
    assert.equal(model.gifts[0].contactName, "Ursula Pfahl");
    assert.equal(model.gifts[0].amount, 10000);
  });

  it("possible gifts are not points and stay out of the tracker mix", () => {
    const { owner, model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 80 })],
    );
    const mix = trackerBreakdown(model.rows);
    assert.equal(mix.totalPoints, 110);
    const donationLine = mix.lines.find((l) => l.id === "donation");
    assert.ok(donationLine);
    assert.equal(donationLine.count, 1);
    assert.equal(donationLine.points, 100);
    assert.equal(owner.points, 110);
    assert.equal(owner.giftAmount, 80);
    assert.equal(model.totals.points, 110);
  });

  it("Incoming uses the note contact name when the gift has none", () => {
    const { model } = run(
      [donationNote({
        type: "Mission Advancement Call | Conversation",
        noteDate: "8/10/2026",
        contactName: "Adrian and Josie Visocky",
      })],
      [postedGift({ giftDate: "8/11/2026", amount: 25, contactName: "" })],
    );
    assert.equal(model.gifts[0].contactName, "Adrian and Josie Visocky");
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
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal(model.gifts.length, 1);
    assert.equal(model.gifts[0].owner, "Sean Kelly");
    assert.equal(model.gifts[0].amount, 250);
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
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal(model.gifts.length, 1);
    assert.equal(model.gifts[0].amount, 2880);
  });

  it("a dismissed incoming gift leaves the Incoming list and does not score", () => {
    const { model } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [postedGift({ giftDate: "8/11/2026", amount: 80 })],
    );
    assert.equal(model.gifts.length, 1);
    const dismissed = aggregate(model.rows, {
      start: evalStartDate(),
      end: null,
      flags: { "gift:501": { status: "removed" } },
    }) as Model;
    assert.equal(dismissed.possibleGifts?.length ?? 0, 0);
    assert.equal(dismissed.totals.giftAmount, 0);
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

describe("a contact within 90 days assigns the gift", () => {
  it("a letter 45 days before the gift still assigns it", () => {
    const { owner, model } = run(
      [donationNote({ type: "Letter", noteDate: "8/1/2026", id: 45 })],
      [postedGift({ giftDate: "9/15/2026", amount: 100, id: 900 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 100);
    assert.equal(owner.points, 105);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a letter 60 days before the gift assigns it", () => {
    const { owner, model } = run(
      [donationNote({ type: "Letter", noteDate: "7/17/2026", id: 60 })],
      [postedGift({ giftDate: "9/15/2026", amount: 100, id: 901 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 100);
    assert.equal(owner.points, 105);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a contact 46 days before assigns the gift and 90 days before still assigns it", () => {
    const early = run(
      [donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "7/31/2026", id: 46 })],
      [postedGift({ giftDate: "9/15/2026", amount: 25, id: 902 })],
    );
    assert.equal(early.owner.gifts, 1);
    assert.equal(early.owner.giftAmount, 25);
    assert.equal(early.owner.points, 101);
    assert.equal(early.model.possibleGifts?.length ?? 0, 0);

    const edge = run(
      [donationNote({ type: "Mission Advancement Call | Email Reach Out", noteDate: "6/17/2026", id: 90 })],
      [postedGift({ giftDate: "9/15/2026", amount: 25, id: 903 })],
    );
    assert.equal(edge.owner.gifts, 1);
    assert.equal(edge.owner.giftAmount, 25);
    assert.equal(edge.owner.points, 102);
    assert.equal(edge.model.possibleGifts?.length ?? 0, 0);
  });

  it("a contact 91 days before the gift is not listed", () => {
    const { owner, model } = run(
      [donationNote({ type: "Letter", noteDate: "6/16/2026", id: 91 })],
      [postedGift({ giftDate: "9/15/2026", amount: 100, id: 904 })],
    );
    assert.equal(owner.gifts, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal((model.reviewGifts || []).length, 0);
  });

  it("a thank-you the day after the gift does not enter the 90-day review", () => {
    const { owner, model } = run(
      [donationNote({ type: "Letter", noteDate: "9/16/2026", id: 92 })],
      [postedGift({ giftDate: "9/15/2026", amount: 100, id: 905 })],
    );
    assert.equal(owner.gifts, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a closer contact assigns the gift even if an older note exists", () => {
    const { owner, model } = run(
      [
        donationNote({ type: "Letter", noteDate: "7/7/2026", id: 70 }),
        donationNote({ type: "Mission Advancement Call | Voicemail", noteDate: "8/26/2026", id: 20 }),
      ],
      [postedGift({ giftDate: "9/15/2026", amount: 40, id: 906 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 40);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("assigning a gift whose only contact is older than 90 days scores 100 points", () => {
    const flags = {
      "gift:907": {
        status: "assigned",
        owner: ALANNA,
        contactId: "101",
        contactName: "Jane Donor",
        day: "2026-09-15",
        type: "Mission Advancement | New Donation or New AC",
        noteId: "gift:907",
      },
    };
    const extra = assignedNotesFromFlags(flags);
    const { owner, model } = run(
      [
        donationNote({ type: "Letter", noteDate: "6/16/2026", id: 61 }),
        extra[0],
      ],
      [postedGift({ giftDate: "9/15/2026", amount: 80, id: 907 })],
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 80);
    assert.equal(owner.points, 105);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("an MGO gift with a letter 60 days before is Raised", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: SEAN,
        type: "Letter",
        noteDate: "7/17/2026",
        contactId: 84897,
        id: 62,
      })],
      [postedGift({
        contactId: 84897,
        giftDate: "9/15/2026",
        amount: 150,
        id: 908,
        segment: "Direct Solicitation (MGO)",
      })],
      SEAN,
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 150);
    assert.equal(owner.points, 105);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal(model.reviewGifts?.length ?? 0, 0);
  });

  it("an MGO gift on that MA portfolio counts without Assign", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: SEAN,
        type: "Letter",
        noteDate: "7/17/2026",
        contactId: 84897,
        id: 62,
      })],
      [postedGift({
        contactId: 84897,
        giftDate: "9/15/2026",
        amount: 150,
        id: 908,
        segment: "Direct Solicitation (MGO)",
      })],
      SEAN,
      {},
      [],
      { "84897": SEAN },
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 150);
    assert.equal(owner.points, 105);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal(model.reviewGifts?.length ?? 0, 0);
    assert.equal(model.gifts[0].owner, SEAN);
  });

  it("a donor on two MA portfolios is not auto-assigned", () => {
    const owners = portfolioOwnersFromSnapshot({
      solicitors: [
        { team: "ma", name: ALANNA, stages: [{ donors: [{ contactId: 84897 }] }] },
        { team: "ma", name: SEAN, stages: [{ donors: [{ contactId: 84897 }] }] },
      ],
    });
    assert.equal(owners["84897"], undefined);
    const { owner, model } = run(
      [],
      [postedGift({
        contactId: 84897,
        giftDate: "9/15/2026",
        amount: 150,
        id: 908,
        segment: "Direct Solicitation (MGO)",
      })],
      SEAN,
      {},
      [],
      owners,
    );
    assert.equal(owner.gifts, 0);
    assert.equal(model.reviewGifts?.length ?? 0, 0);
  });
});

describe("MGO-coded gifts follow the same contact rule", () => {
  it("conversation note plus Direct Solicitation (MGO) gift is Raised for that MA", () => {
    const gift = postedGift({
      contactId: 84897,
      giftDate: "9/1/2026",
      amount: 10000,
      segment: "Direct Solicitation (MGO)",
    });
    assert.equal(isMgoAttributedGift(gift), true);
    assert.equal(scoreGift(gift, SEAN)?.owner, SEAN);
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
    assert.equal(owner.giftAmount, 10000);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(rows.filter((r) => r.bucket === "donation" && !r.needsReview).length, 1);
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
    assert.equal(owner.giftAmount, 10000);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(rows.filter((r) => r.needsReview).length, 0);
    assert.equal((model.reviewGifts || []).length, 0);
    assert.equal(model.gifts.length, 1);
    assert.equal(model.gifts[0].amount, 10000);
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
    assert.equal(model.gifts[0].removed, false);
    const credited = model.rows.find((r) => r.giftId === 9001) as ScoredRow | undefined;
    assert.ok(credited);
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
    assert.equal(owner.giftAmount, 10000);
    assert.equal(owner.gifts, 1);
    assert.equal(model.totals.giftAmount, 10000);
    assert.equal((model.reviewGifts || []).length, 0);
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

  it("Direct Solicitation (MGO)-HIST_DS uses the same contact rule", () => {
    const gift = postedGift({
      amount: 100,
      giftDate: "8/11/2026",
      segment: "Direct Solicitation (MGO)-HIST_DS",
    });
    assert.equal(isMgoAttributedGift(gift), true);
    assert.equal(scoreGift(gift, ALANNA)?.owner, ALANNA);
    const { owner } = run(
      [donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      [gift],
    );
    assert.equal(owner.giftAmount, 100);
    assert.equal(owner.gifts, 1);
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

  it("non-MA GFT_Solicitor still credits when an MA contacted the donor", () => {
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
    assert.equal(scoreGift(gift, ALANNA)?.owner, ALANNA);
    const { owner } = run(
      [
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", contactId: 101, id: 1 }),
        donationNote({ type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026", contactId: 102, id: 2 }),
      ],
      [gift, viaField],
    );
    assert.equal(owner.giftAmount, 350);
    assert.equal(owner.gifts, 2);
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
    const { owner, model } = run(
      [donationNote({ contactId: 70510, type: "Mission Advancement Call | Conversation", noteDate: "8/10/2026" })],
      merged,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(model.reviewGifts?.[0]?.label, "Recurring — needs review");
    assert.equal(model.reviewGifts?.[0]?.schedule, "Recurring");
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
    assert.equal(rows.filter((r) => r.needsReview).length, 1);
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

describe("contactDisplayName", () => {
  it("reads FullContact first/last and nested contact objects", () => {
    assert.equal(contactDisplayName({ firstName: "Adrian", lastName: "Visocky" }), "Adrian Visocky");
    assert.equal(contactDisplayName({ formalName: "Adrian and Josie Visocky" }), "Adrian and Josie Visocky");
    assert.equal(contactDisplayName({ contact: { name: "Jane Donor" } }), "Jane Donor");
    assert.equal(contactDisplayName({
      individuals: [{ firstName: "Mike" }, { firstName: "Carla", lastName: "Pellegrini" }],
    }), "Mike and Carla Pellegrini");
    assert.equal(contactDisplayName({ contactName: "" }), "");
  });
});

describe("spreadsheet tracker gifts", () => {
  it("still recognizes a close name and amount, without assigning Raised", () => {
    const hit = matchCountedSpreadsheetGift({
      contactName: "Tobin Finizio",
      day: "2026-08-13",
      postedAmount: 75,
      amount: 75,
    });
    assert.ok(hit);
    assert.equal(hit.owner, "Sean Kelly");
    const { owner, model } = run(
      [],
      [postedGift({
        contactId: 1867,
        contactName: "Tobin Finizio",
        giftDate: "8/13/2026",
        amount: 75,
      })],
      "Sean Kelly",
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("does not raise Anna Clark for Natalia without a donation note", () => {
    const { owner, model } = run(
      [],
      [postedGift({
        contactId: 99014,
        contactName: "Anna Clark",
        giftDate: "8/14/2026",
        amount: 200,
      })],
      "Natalia Abrams",
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("does not raise a tracker gift when there is no MA note on the contact", () => {
    const { owner, model } = run(
      [],
      [postedGift({
        contactId: 88001,
        contactName: "Phillip Arencibia",
        giftDate: "8/31/2026",
        amount: 624,
        segment: "Annunciation Circle",
      })],
      "Joseph Blaso",
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(owner.points, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a conversation on a tracker donor stays Incoming", () => {
    const ELENA = "Elena Barnes";
    const { owner, model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "8/31/2026",
        contactId: 909,
      })],
      [postedGift({
        contactId: 909,
        contactName: "Mike and Carla Pellegrini",
        giftDate: "8/31/2026",
        amount: 721,
      })],
      ELENA,
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    assert.equal(owner.giftAmount, 721);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a blank Virtuous name does not claim another donor's tracker row", () => {
    const hit = matchCountedSpreadsheetGift({
      contactName: "",
      day: "2026-09-15",
      postedAmount: 20,
      amount: 20,
    });
    assert.equal(hit, null);
    const { model } = run(
      [
        donationNote({
          createdByUser: NATALIA,
          type: "Mission Advancement Call | Voicemail",
          noteDate: "9/16/2026",
          contactId: 79588,
          id: 1,
          note: "TY CC -VM",
        }),
        donationNote({
          createdByUser: NATALIA,
          type: "Mission Advancement Call | Email Reach Out",
          noteDate: "9/16/2026",
          contactId: 79588,
          id: 2,
          note: "TY CC -Email",
        }),
        donationNote({
          createdByUser: NATALIA,
          type: "Letter",
          noteDate: "9/16/2026",
          contactId: 79588,
          id: 3,
          note: "TY CC -Letter",
        }),
      ],
      [postedGift({
        id: 451929,
        contactId: 79588,
        contactName: "",
        giftDate: "9/15/2026",
        amount: 20,
        segment: "FYE27 Fall 2026 Appeal Lapsed 24-48 Direct Mail 1",
      })],
      ALANNA,
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    const alanna = model.tableOwners.find((o) => o.name === ALANNA);
    const natalia = model.tableOwners.find((o) => o.name === NATALIA);
    assert.ok(alanna);
    assert.ok(natalia);
    assert.equal(alanna.giftAmount, 0);
    assert.equal(alanna.gifts, 0);
    assert.equal(natalia.giftAmount, 0);
    assert.equal(natalia.gifts, 0);
    assert.equal(natalia.points, 8);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal(model.gifts.length, 0);
  });

  it("a donation note after the gift credits the MA who logged it", () => {
    const { owner, rows } = run(
      [donationNote({
        createdByUser: ALANNA,
        type: "Mission Advancement | New Donation or New AC",
        noteDate: "9/16/2026",
        contactId: 79588,
        contactName: "Arthur and Janet De Cook",
      })],
      [postedGift({
        id: 451929,
        contactId: 79588,
        contactName: "Arthur and Janet De Cook",
        giftDate: "9/15/2026",
        amount: 20,
      })],
      ALANNA,
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    assert.equal(owner.giftAmount, 20);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 100);
    assert.equal(rows.some((r) => r.source === "spreadsheet"), false);
  });

  it("a donation note before the gift credits the MA who logged it", () => {
    const { owner } = run(
      [donationNote({
        createdByUser: ALANNA,
        type: "Mission Advancement | New Donation or New AC",
        noteDate: "9/1/2026",
        contactId: 79588,
      })],
      [postedGift({
        id: 451929,
        contactId: 79588,
        contactName: "Arthur and Janet De Cook",
        giftDate: "9/15/2026",
        amount: 20,
      })],
    );
    assert.equal(owner.giftAmount, 20);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 100);
  });

  it("an in-person note does not split an MGO gift across a tracker row", () => {
    const { model } = run(
      [
        donationNote({
          createdByUser: "Betsy Scaletty",
          type: "In Person",
          noteDate: "9/3/2026",
          contactId: 501,
          id: 1,
        }),
        donationNote({
          createdByUser: "Caleb Metzen",
          type: "In Person",
          noteDate: "9/3/2026",
          contactId: 501,
          id: 2,
        }),
      ],
      [postedGift({
        contactId: 501,
        contactName: "",
        giftDate: "9/4/2026",
        amount: 40,
        segment: "Direct Solicitation (MGO)",
      })],
      "Betsy Scaletty",
      {},
      COUNTED_SPREADSHEET_GIFTS,
    );
    const betsy = model.tableOwners.find((o) => o.name === "Betsy Scaletty");
    const caleb = model.tableOwners.find((o) => o.name === "Caleb Metzen");
    assert.ok(betsy);
    assert.ok(caleb);
    assert.equal(betsy.giftAmount, 40);
    assert.equal(caleb.giftAmount, 0);
    assert.equal(betsy.points, 125);
    assert.equal(caleb.points, 25);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
    assert.equal((model.reviewGifts || []).length, 0);
  });

  it("a Pending tracker row does not raise the gift", () => {
    const ELENA = "Elena Barnes";
    const counted = [{
      owner: "Elena",
      donor: "Jane Tracker",
      amount: 88,
      day: "2026-08-15",
      monthly: false,
      received: "Pending",
    }];
    const { owner, model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "8/15/2026",
        contactId: 911,
      })],
      [postedGift({
        contactId: 911,
        contactName: "Jane Tracker",
        giftDate: "8/15/2026",
        amount: 88,
      })],
      ELENA,
      {},
      counted,
    );
    assert.equal(owner.giftAmount, 88);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("does not match a different amount on two shared name tokens", () => {
    const hit = matchCountedSpreadsheetGift({
      contactName: "Rosemarie Dotro",
      day: "2026-09-12",
      postedAmount: 515.24,
      amount: 515.24,
    });
    assert.equal(hit, null);
  });

  it("skips a tracker row marked received No", () => {
    const hit = matchCountedSpreadsheetGift(
      {
        contactName: "Jane Tracker",
        day: "2026-08-15",
        postedAmount: 88,
        amount: 88,
      },
      [{
        owner: "Elena",
        donor: "Jane Tracker",
        amount: 88,
        day: "2026-08-15",
        monthly: false,
        received: "No",
      }],
    );
    assert.equal(hit, null);
  });
});

describe("any contact before a gift, and a short grace after", () => {
  const BETSY = "Betsy Scaletty";

  it("uses the chapel conversation even when a thank-you letter is later the same day", () => {
    const { owner } = run(
      [
        donationNote({
          createdByUser: BETSY,
          type: "Mission Advancement Call | Conversation",
          noteDate: "8/12/2026",
          contactId: 18828,
          id: 1,
          note: "She wanted to give a one-time gift to the chapel, so I set that up with her over the phone.",
        }),
        donationNote({
          createdByUser: BETSY,
          type: "Letter",
          noteDate: "8/12/2026",
          contactId: 18828,
          id: 2,
          note: "I sent Joyce a letter to thank her for giving to the chapel.",
        }),
      ],
      [postedGift({
        id: 450987,
        contactId: 18828,
        contactName: "Dick and Joyce Platfoot",
        giftDate: "8/11/2026",
        amount: 100,
        segment: "Direct Solicitation (MGO)",
      })],
      BETSY,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("a restarted monthly gift from voicemails before it waits for review", () => {
    const { owner, model } = run(
      [
        donationNote({
          createdByUser: BETSY,
          type: "Mission Advancement Call | Voicemail",
          noteDate: "8/7/2026",
          contactId: 41524,
          id: 1,
          note: "follow up vm to (404) 784-4600",
        }),
        donationNote({
          createdByUser: BETSY,
          type: "Mission Advancement Call | Email Reach Out",
          noteDate: "7/30/2026",
          contactId: 41524,
          id: 2,
          note: "AC Lapsed CC - Email",
        }),
        donationNote({
          createdByUser: BETSY,
          type: "Mission Advancement Call | Voicemail",
          noteDate: "9/18/2026",
          contactId: 41524,
          id: 3,
          note: "TY CC vm",
        }),
      ],
      [postedGift({
        id: 451787,
        contactId: 41524,
        contactName: "James and Patricia Miles",
        giftDate: "9/12/2026",
        amount: 26.06,
        segment: "Annunciation Circle",
        frequency: "Monthly",
      })],
      BETSY,
    );
    assert.equal(owner.gifts, 0);
    assert.equal(owner.giftAmount, 0);
    assert.equal(model.reviewGifts?.length ?? 0, 1);
    assert.equal(model.reviewGifts?.[0].label, "Recurring — needs review");
    assert.equal(model.reviewGifts?.[0].amount, 312.72);
  });

  it("a general note before the gift can tie the dollars and adds no points of its own", () => {
    const { rows, owner } = run(
      [donationNote({
        createdByUser: BETSY,
        type: "General",
        noteDate: "9/1/2026",
        contactId: 131536,
        id: 8,
        note: "Spoke about a scholarship gift",
      })],
      [postedGift({
        id: 451555,
        contactId: 131536,
        contactName: "David Hermann",
        giftDate: "9/4/2026",
        amount: 1000,
        segment: "Main Donation Page",
      })],
      BETSY,
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 1000);
    assert.equal(owner.points, 100);
    const note = rows.find((r) => r.bucket === "general");
    assert.ok(note);
    assert.equal(note.points, 0);
    assert.equal(isTaskListRow(note), false);
  });

  it("does not count a general note logged after the gift", () => {
    const { owner } = run(
      [donationNote({
        createdByUser: BETSY,
        type: "General",
        noteDate: "9/6/2026",
        contactId: 131536,
        note: "He gave $1000 for scholarships the next day.",
      })],
      [postedGift({
        id: 451555,
        contactId: 131536,
        contactName: "David Hermann",
        giftDate: "9/4/2026",
        amount: 1000,
        segment: "Main Donation Page",
      })],
      BETSY,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("does not count a general note four days after the gift", () => {
    const { owner } = run(
      [donationNote({
        createdByUser: BETSY,
        type: "General",
        noteDate: "9/8/2026",
        contactId: 131536,
        note: "The next day we received his $1000 gift for scholarships.",
      })],
      [postedGift({
        contactId: 131536,
        giftDate: "9/4/2026",
        amount: 1000,
      })],
      BETSY,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });
});

describe("gala ticket purchases", () => {
  const ELENA = "Elena Barnes";

  it("recognizes a gala segment as a gala gift", () => {
    assert.equal(isGalaGift({ segment: "2026 Chancellor's Gala" }), true);
    assert.equal(isGalaGift({ project: "Gala tickets" }), true);
    assert.equal(isGalaGift({ segment: "Main Donation Page" }), false);
    assert.equal(giftKindOf({ segment: "2026 Chancellor's Gala" }), "gala");
  });

  it("counts the ticket purchase when an MA conversation is within 90 days", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "9/15/2026",
        contactId: 8801,
        contactName: "Jay Hamilton",
      })],
      [postedGift({
        id: 88011,
        contactId: 8801,
        contactName: "Jay Hamilton",
        giftDate: "9/18/2026",
        amount: 1275,
        segment: "2026 Chancellor's Gala",
      })],
      ELENA,
    );
    assert.equal(owner.giftAmount, 1275);
    assert.equal(owner.gifts, 1);
    assert.equal(owner.points, 110);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("does not count a gala conversation logged after the gift posts", () => {
    const { owner } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "9/19/2026",
        contactId: 8801,
      })],
      [postedGift({
        id: 88012,
        contactId: 8801,
        contactName: "Jay Hamilton",
        giftDate: "9/18/2026",
        amount: 1275,
        segment: "Gala",
      })],
      ELENA,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
  });

  it("counts a gala gift from a voicemail in the 90 days before", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Voicemail",
        noteDate: "9/15/2026",
        contactId: 8801,
      })],
      [postedGift({
        id: 88013,
        contactId: 8801,
        contactName: "Jay Hamilton",
        giftDate: "9/18/2026",
        amount: 1275,
        segment: "Gala",
      })],
      ELENA,
    );
    assert.equal(owner.giftAmount, 1275);
    assert.equal(owner.gifts, 1);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("a conversation on the gift day counts that gift even when the talk is about the gala", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: NATALIA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "9/17/2026",
        contactId: 106479,
        contactName: "Paul and Mechelle Wagner",
      })],
      [postedGift({
        id: 452002,
        contactId: 106479,
        contactName: "Paul and Mechelle Wagner",
        giftDate: "9/17/2026",
        amount: 20.91,
        segment: "Main Donation Page",
      })],
      NATALIA,
    );
    assert.equal(owner.giftAmount, 20.91);
    assert.equal(owner.gifts, 1);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("treats a gala-site flag as a gala gift", () => {
    assert.equal(isGalaGift({ galaSite: true, amount: 875.7 }), true);
    assert.equal(isPendingGalaSiteTicket({ galaSite: true, inVirtuous: false }), true);
    assert.equal(isPendingGalaSiteTicket({ segment: "26-27 Chancellor's Gala" }), false);
  });

  it("keeps an unsynced gala-site ticket on Incoming even with a conversation", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "9/15/2026",
        contactId: 40026,
        contactName: "Jay Hamilton",
      })],
      [postedGift({
        id: "gala-stripe-pi_jay",
        contactId: 40026,
        contactName: "Jay Hamilton",
        giftDate: "2026-09-17",
        amount: 1275,
        segment: "26-27 Chancellor's Gala",
        galaSite: true,
        inVirtuous: false,
        emailMatch: "unique",
      })],
      ELENA,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(owner.gifts, 0);
    assert.equal(model.possibleGifts?.length, 1);
    assert.equal(model.possibleGifts?.[0].galaSite, true);
    assert.equal(model.possibleGifts?.[0].amount, 1275);
    assert.equal(model.possibleGifts?.[0].kind, "gala");
    assert.equal(model.possibleGifts?.[0].owners?.[0].name, ELENA);
  });

  it("lists a same-day conversation on a gala-site ticket dated YYYY-MM-DD", () => {
    const { owner, model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "9/18/2026",
        contactId: 40026,
        contactName: "Jay Hamilton",
      })],
      [postedGift({
        id: "gala-stripe-pi_3UH6aYQNgURefLuY1o4Fz8ir",
        contactId: 40026,
        contactName: "Jay Hamilton",
        giftDate: "2026-09-18",
        amount: 1275,
        segment: "26-27 Chancellor's Gala",
        galaSite: true,
        inVirtuous: false,
        emailMatch: "unique",
      })],
      ELENA,
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(model.possibleGifts?.length, 1);
    assert.equal(model.possibleGifts?.[0].contactName, "Jay Hamilton");
    assert.equal(model.possibleGifts?.[0].owners?.[0].name, ELENA);
    assert.equal(model.possibleGifts?.[0].owners?.[0].daysAfterNote, 0);
  });

  it("omits a gala-site ticket with no MA contact from Incoming", () => {
    const { model, owner } = run(
      [],
      [postedGift({
        id: "gala-stripe-pi_open",
        contactId: 37276,
        contactName: "Jeffrey and Donna Langton",
        giftDate: "2026-09-29",
        amount: 2000,
        segment: "26-27 Chancellor's Gala",
        galaSite: true,
        inVirtuous: false,
        emailMatch: "unique",
      })],
    );
    assert.equal(owner.giftAmount, 0);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("omits a gala-site ticket whose only note is a voicemail", () => {
    const { model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Voicemail",
        noteDate: "9/22/2026",
        contactId: 37276,
        contactName: "Jeffrey and Donna Langton",
      })],
      [postedGift({
        id: "gala-stripe-pi_vm",
        contactId: 37276,
        contactName: "Jeffrey and Donna Langton",
        giftDate: "2026-09-29",
        amount: 2000,
        segment: "26-27 Chancellor's Gala",
        galaSite: true,
        inVirtuous: false,
        emailMatch: "unique",
      })],
    );
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("keeps a snapshot contact id when the checkout email is unmatched", () => {
    const merged = mergeGalaSiteTickets(
      [],
      [{ id: 64738, contactName: "Don and Mary Huffines", email: "rhuffines@hotmail.com" }],
      [{
        paymentIntentId: "pi_3UKiFEQNgURefLuY1vB1MFud",
        day: "2026-09-28",
        email: "attach257@yahoo.com",
        amountCents: 455747,
        inVirtuous: false,
        giftId: null,
        contactId: 64738,
        contactName: "Don and Mary Huffines",
        emailMatch: "unique",
      }],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].contactId, 64738);
    assert.equal(merged[0].contactName, "Don and Mary Huffines");
  });

  it("lists Huffines on Incoming when Elena spoke the same day as the unmatched-email checkout", () => {
    const { model } = run(
      [donationNote({
        createdByUser: ELENA,
        type: "Mission Advancement Call | Conversation",
        noteDate: "9/28/2026",
        contactId: 64738,
        contactName: "Don and Mary Huffines",
      })],
      [postedGift({
        id: "gala-stripe-pi_3UKiFEQNgURefLuY1vB1MFud",
        contactId: 64738,
        contactName: "Don and Mary Huffines",
        giftDate: "2026-09-28",
        amount: 4557.47,
        segment: "26-27 Chancellor's Gala",
        galaSite: true,
        inVirtuous: false,
        emailMatch: "unique",
      })],
    );
    assert.equal(model.possibleGifts?.length, 1);
    assert.equal(model.possibleGifts?.[0].contactName, "Don and Mary Huffines");
    assert.equal(model.possibleGifts?.[0].owners?.[0].name, ELENA);
  });

  it("omits an unmatched gala-site ticket with no contact id", () => {
    const { model } = run(
      [],
      [postedGift({
        id: "gala-stripe-pi_unmatched",
        contactId: null,
        contactName: "Greg Trum",
        giftDate: "2026-09-28",
        amount: 2000,
        segment: "26-27 Chancellor's Gala",
        galaSite: true,
        inVirtuous: false,
        emailMatch: "unmatched",
      })],
    );
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("credits an assigned gala-site ticket", () => {
    const flags = {
      "gift:gala-stripe-pi_assign": {
        status: "assigned",
        owner: ELENA,
        contactId: "40026",
        contactName: "Jay Hamilton",
        day: "2026-09-17",
        type: "Mission Advancement | New Donation or New AC",
        noteId: "gift:gala-stripe-pi_assign",
      },
    };
    const extra = assignedNotesFromFlags(flags);
    const { owner, model } = run(
      extra,
      [postedGift({
        id: "gala-stripe-pi_assign",
        contactId: 40026,
        contactName: "Jay Hamilton",
        giftDate: "2026-09-17",
        amount: 1275,
        segment: "26-27 Chancellor's Gala",
        galaSite: true,
        inVirtuous: false,
      })],
      ELENA,
      flags,
    );
    assert.equal(owner.gifts, 1);
    assert.equal(owner.giftAmount, 1275);
    assert.equal(owner.points, 100);
    assert.equal(model.possibleGifts?.length ?? 0, 0);
  });

  it("skips a Stripe ticket already posted in Virtuous", () => {
    const merged = mergeGalaSiteTickets(
      [{ id: 451459, contactId: 54618, giftDate: "2026-08-28", amount: 875.7, segment: "26-27 Chancellor's Gala" }],
      [],
      [{
        paymentIntentId: "pi_posted",
        day: "2026-08-28",
        email: "joeguernsey@gmail.com",
        amountCents: 87570,
        inVirtuous: true,
        giftId: 451459,
        contactId: 54618,
        contactName: "Joe and Hannah Guernsey",
        emailMatch: "unique",
      }],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 451459);
  });

  it("adds a synthetic gift for a unique email and skips an ambiguous one", () => {
    const contacts = [
      { id: 40026, contactName: "Jay Hamilton", email: "jayhamilton.law@outlook.com" },
      { id: 1, contactName: "A McManus", email: "sydneymfl@icloud.com" },
      { id: 2, contactName: "B McManus", email: "sydneymfl@icloud.com" },
    ];
    const unique = uniqueEmailContactIndex(contacts);
    assert.equal(unique.get("jayhamilton.law@outlook.com")?.contactId, 40026);
    assert.equal(unique.has("sydneymfl@icloud.com"), false);
    const merged = mergeGalaSiteTickets(
      [],
      contacts,
      [
        {
          paymentIntentId: "pi_jay",
          day: "2026-09-17",
          email: "jayhamilton.law@outlook.com",
          amountCents: 127500,
          inVirtuous: false,
          giftId: null,
          contactId: 40026,
          contactName: "Jay Hamilton",
          emailMatch: "unique",
        },
        {
          paymentIntentId: "pi_syd",
          day: "2026-09-28",
          email: "sydneymfl@icloud.com",
          amountCents: 411977,
          inVirtuous: false,
          giftId: null,
          contactId: null,
          contactName: "Sydney McManus",
          emailMatch: "ambiguous",
          stripeName: "Sydney McManus",
        },
      ],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0].id, galaSiteGiftId("pi_jay"));
    assert.equal(merged[0].contactId, 40026);
    assert.equal(merged[0].galaSite, true);
    assert.equal(merged[1].contactId, null);
    assert.equal(merged[1].emailMatch, "ambiguous");
  });
});

describe("dashboard-tracked event hours", () => {
  it("keeps a typed project type only on Projects events", () => {
    assert.equal(projectTypeFor("projects", "  American   House "), "American House");
    assert.equal(projectTypeFor("Projects", "Del Webb"), "Del Webb");
    assert.equal(projectTypeFor("meetings", "American House"), "");
    assert.equal(projectTypeFor("tours", "Campus"), "");
    assert.equal(projectTypeFor("projects", "   "), "");
  });

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

  it("Projects and Meetings hours score 25 per hour", () => {
    const rows = scoreTrackedEvents([
      { id: "p1", owner: SEAN, day: "2026-08-13", eventType: "projects", hours: 2, projectType: "American House", name: "Open house" },
      { id: "mtg", owner: SEAN, day: "2026-08-13", eventType: "meetings", hours: 1, projectType: "Should stay off a meeting" },
    ]) as ScoredRow[];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].points, 50);
    assert.equal(rows[0].type, "Projects");
    assert.equal(rows[0].label, "Projects · American House · 2 hrs · Open house");
    assert.equal(rows[1].points, 25);
    assert.equal(rows[1].type, "Meetings");
    assert.equal(rows[1].label, "Meetings · 1 hr");
    const blank = scoreTrackedEvents([
      { id: "p2", owner: SEAN, day: "2026-08-13", eventType: "projects", hours: 2, projectType: "   " },
    ]) as ScoredRow[];
    assert.equal(blank[0].points, 50);
    assert.equal(blank[0].label, "Projects · 2 hrs");
    const model = aggregate(rows, {}) as Model;
    const owner = model.tableOwners.find((o) => o.name === SEAN);
    assert.ok(owner);
    assert.equal(owner.points, 75);
  });

  it("a saved Marketing Event row still scores after that type left the form", () => {
    const rows = scoreTrackedEvents([
      { id: "m1", owner: SEAN, day: "2026-08-13", eventType: "marketing", hours: 2 },
    ]) as ScoredRow[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].points, 50);
    assert.equal(rows[0].type, "Mission Advancement | Marketing Event");
  });

  it("one-on-one Event notes on a contact still score 25", () => {
    const { owner, rows } = run([
      donationNote({ type: "Mission Advancement | Event", id: 9 }),
      donationNote({ type: "Mission Advancement | Marketing Event", id: 10 }),
    ]);
    assert.equal(owner.points, 50);
    assert.equal(rows.filter((r) => r.bucket === "event").length, 2);
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




