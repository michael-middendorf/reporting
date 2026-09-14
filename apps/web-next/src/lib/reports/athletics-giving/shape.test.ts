import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  datePresetLabel,
  filterGifts,
  formatGiftDate,
  fundsThisYearVsLastYear,
  giftExportRows,
  giftsFromLastTwoFiscalYears,
  giftsInRange,
  isGivingReady,
  previousFiscalYearLabel,
  previousFiscalYearWindow,
  rangeForPreset,
  sportForGift,
  totalsFromGifts,
  usd,
  usdExact,
  type AthleticsGivingSnapshot,
} from "./shape";

const SAMPLE: AthleticsGivingSnapshot = {
  generated_at: "2026-09-14T18:00:00Z",
  source: "virtuous",
  segments: ["Athletics Fundraising"],
  fiscalYear: 2027,
  fiscalYearLabel: "FY 2026-27",
  fyStart: "2026-07-01",
  fyEnd: "2027-06-30",
  asOf: "2026-09-14T18:00:00Z",
  weekly: { amount: 206.28, programAmount: 200, feeAmount: 6.28, giftCount: 1, designationCount: 2 },
  fytd: { amount: 1206.28, programAmount: 1200, feeAmount: 6.28, giftCount: 2, designationCount: 3 },
  allTime: { amount: 1706.28, programAmount: 1700, feeAmount: 6.28, giftCount: 3, designationCount: 4 },
  funds: [],
  gifts: [
    {
      giftId: 10,
      giftDate: "2026-09-12",
      contactId: 1,
      contactName: "Tom Price",
      contactUrl: null,
      amountDesignated: 200,
      project: "Men's Ultimate Frisbee",
      projectCode: "6251FrisM",
      segment: "Athletics - Specific Sport",
      segmentCode: "VR_ATHSS1_OL",
      giftType: "Credit",
      isFee: false,
      isPrivate: false,
    },
    {
      giftId: 11,
      giftDate: "2026-08-01",
      contactId: 2,
      contactName: "Jane Donor",
      contactUrl: null,
      amountDesignated: 1000,
      project: "Football Program",
      projectCode: "6552FB",
      segment: "Athletics Fundraising",
      segmentCode: "VOA_ATHLETICS_DS",
      giftType: "Check",
      isFee: false,
      isPrivate: false,
    },
  ],
};

describe("athletics giving shape", () => {
  it("accepts a virtuous snapshot and rejects qlik leftovers", () => {
    assert.equal(isGivingReady(SAMPLE), true);
    assert.equal(isGivingReady({ ...SAMPLE, source: "qlik" } as AthleticsGivingSnapshot), false);
    assert.equal(isGivingReady(null), false);
  });

  it("formats money and gift dates like the Qlik table", () => {
    assert.equal(usd(1200), "$1,200");
    assert.equal(usdExact(30.18), "$30.18");
    assert.equal(formatGiftDate("2026-09-12"), "9/12/2026");
  });

  it("filters gifts by inclusive ISO date range", () => {
    const week = giftsInRange(SAMPLE.gifts, "2026-09-07", "2026-09-14");
    assert.equal(week.length, 1);
    assert.equal(week[0]?.contactName, "Tom Price");
    const fy = giftsInRange(SAMPLE.gifts, "2026-07-01", "2027-06-30");
    assert.equal(fy.length, 2);
  });

  it("maps Virtuous project codes to sports", () => {
    assert.equal(sportForGift(SAMPLE.gifts[0]!).key, "ultimate-frisbee");
    assert.equal(sportForGift(SAMPLE.gifts[1]!).key, "football");
    assert.equal(sportForGift({ project: "Men's XC", projectCode: "6578MXC", isFee: false }).key, "cross-country");
    assert.equal(sportForGift({ project: "Donor Paid Costs", projectCode: "CREDITCARDCOSTS", isFee: true }).label, "Processing fees");
  });

  it("date presets and sport filters change the total gifts received", () => {
    assert.deepEqual(rangeForPreset("this-week", "2026-09-14", "2026-07-01", "", ""), {
      start: "2026-09-07",
      end: "2026-09-14",
    });
    assert.deepEqual(rangeForPreset("last-week", "2026-09-14", "2026-07-01", "", ""), {
      start: "2026-08-31",
      end: "2026-09-06",
    });
    assert.deepEqual(rangeForPreset("this-month", "2026-09-14", "2026-07-01", "", ""), {
      start: "2026-09-01",
      end: "2026-09-14",
    });
    assert.deepEqual(rangeForPreset("custom", "2026-09-14", "2026-07-01", "2026-08-01", "2026-08-15"), {
      start: "2026-08-01",
      end: "2026-08-15",
    });
    assert.deepEqual(rangeForPreset("fytd", "2026-09-14", "2026-07-01", "", ""), {
      start: "2026-07-01",
      end: "2026-09-14",
    });
    assert.deepEqual(rangeForPreset("last-fy", "2026-09-14", "2026-07-01", "", ""), {
      start: "2025-07-01",
      end: "2026-06-30",
    });
    assert.deepEqual(rangeForPreset("all", "2026-09-14", "2026-07-01", "", ""), {
      start: "2025-07-01",
      end: "2026-09-14",
    });
    assert.deepEqual(rangeForPreset("custom", "2026-09-14", "2026-07-01", "2024-01-01", "2026-08-15"), {
      start: "2025-07-01",
      end: "2026-08-15",
    });
    const week = filterGifts(SAMPLE.gifts, {
      start: "2026-09-07",
      end: "2026-09-14",
      sportKey: "all",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(week).programAmount, 200);
    const football = filterGifts(SAMPLE.gifts, {
      start: null,
      end: null,
      sportKey: "football",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(football).programAmount, 1000);
    assert.equal(totalsFromGifts(football).giftCount, 1);
  });

  it("labels this fiscal year separately from last year and all time", () => {
    assert.equal(datePresetLabel("fytd", "FY 2026-27"), "This fiscal year (FY 2026-27)");
    assert.equal(datePresetLabel("fytd"), "This fiscal year");
    assert.equal(datePresetLabel("last-fy", "FY 2026-27"), "Last fiscal year (FY 2025-26)");
    assert.equal(datePresetLabel("this-week"), "This week");
    assert.equal(datePresetLabel("last-week"), "Last week");
    assert.equal(datePresetLabel("custom"), "Date range");
    assert.equal(datePresetLabel("all"), "This year + last year");
    assert.deepEqual(previousFiscalYearWindow("2026-07-01"), { start: "2025-07-01", end: "2026-06-30" });
    assert.equal(previousFiscalYearLabel("FY 2026-27"), "FY 2025-26");
  });

  it("fund cards split this year and last year and drop older gifts", () => {
    const gifts = [
      ...SAMPLE.gifts,
      {
        ...SAMPLE.gifts[1]!,
        giftId: 20,
        giftDate: "2025-08-15",
        amountDesignated: 400,
      },
      {
        ...SAMPLE.gifts[0]!,
        giftId: 21,
        giftDate: "2025-09-01",
        amountDesignated: 50,
        project: "Men's Soccer",
        projectCode: "6560SocM",
      },
      {
        ...SAMPLE.gifts[1]!,
        giftId: 22,
        giftDate: "2024-08-01",
        amountDesignated: 9999,
      },
    ];
    const rows = fundsThisYearVsLastYear(gifts, "2026-07-01", "2026-09-14", "2025-07-01", "2026-06-30");
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.project, "Football Program");
    assert.equal(rows[0]?.thisYear, 1000);
    assert.equal(rows[0]?.lastYear, 400);
    assert.equal(rows[1]?.project, "Men's Ultimate Frisbee");
    assert.equal(rows[1]?.thisYear, 200);
    assert.equal(rows[1]?.lastYear, 0);
    assert.equal(rows[2]?.project, "Men's Soccer");
    assert.equal(rows[2]?.thisYear, 0);
    assert.equal(rows[2]?.lastYear, 50);
    assert.equal(
      rows.some((row) => row.thisYear === 9999 || row.lastYear === 9999),
      false,
    );
    const kept = giftsFromLastTwoFiscalYears(gifts, "2026-07-01");
    assert.equal(kept.some((gift) => gift.giftId === 22), false);
    assert.equal(kept.some((gift) => gift.giftId === 20), true);
  });

  it("this fiscal year excludes prior-year gifts that remain in all time", () => {
    const gifts = [
      ...SAMPLE.gifts,
      {
        ...SAMPLE.gifts[1]!,
        giftId: 99,
        giftDate: "2025-03-01",
        amountDesignated: 5000,
      },
    ];
    const fy = filterGifts(gifts, {
      start: "2026-07-01",
      end: "2026-09-14",
      sportKey: "all",
      fund: "all",
      search: "",
    });
    const all = filterGifts(gifts, {
      start: null,
      end: null,
      sportKey: "all",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(fy).programAmount, 1200);
    assert.equal(totalsFromGifts(all).programAmount, 6200);
  });

  it("excel rows include sport and amount for the filtered gifts", () => {
    const rows = giftExportRows(SAMPLE.gifts);
    assert.equal(rows[0]?.[5], "Sport");
    assert.equal(rows[1]?.[5], "Ultimate Frisbee");
    assert.equal(rows[2]?.[2], 1000);
  });
});
