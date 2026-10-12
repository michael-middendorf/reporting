import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  datePresetLabel,
  shortFiscalYearLabel,
  shortPreviousFiscalYearLabel,
  ATHLETICS_SPONSORSHIP_EVENT,
  eventLabel,
  eventOptions,
  filterGifts,
  formatGiftDate,
  fundsFromGifts,
  fundsThisYearVsLastYear,
  giftExportRows,
  giftsFromLastTwoFiscalYears,
  intersectDateRange,
  isAthleticsSponsorshipGift,
  isEventSegment,
  isHiddenAthleticsFund,
  giftsInRange,
  isGivingReady,
  previousFiscalYearLabel,
  previousFiscalYearWindow,
  rangeForPreset,
  sportForGift,
  totalsFromGifts,
  usd,
  usdExact,
  type AthleticsGivingGift,
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
    assert.equal(sportForGift({ project: "Men's XC", projectCode: "6578MXC", isFee: false }).key, "xc-track");
    assert.equal(sportForGift({ project: "Women's XC", projectCode: "6580WXC", isFee: false }).key, "xc-track");
    assert.equal(sportForGift({ project: "Track and Field", projectCode: "6683Track", isFee: false }).key, "xc-track");
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
      event: "all",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(week).programAmount, 200);
    const football = filterGifts(SAMPLE.gifts, {
      start: null,
      end: null,
      sportKey: "football",
      event: "all",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(football).programAmount, 1000);
    assert.equal(totalsFromGifts(football).giftCount, 1);
  });

  it("labels this fiscal year separately from last year and all time", () => {
    assert.equal(datePresetLabel("fytd", "FY 2026-27"), "FY27");
    assert.equal(datePresetLabel("last-fy", "FY 2026-27"), "FY26");
    assert.equal(datePresetLabel("all", "FY 2026-27"), "FY26 + FY27");
    assert.equal(datePresetLabel("this-week"), "This week");
    assert.equal(datePresetLabel("last-week"), "Last week");
    assert.equal(datePresetLabel("custom"), "Date range");
    assert.deepEqual(previousFiscalYearWindow("2026-07-01"), { start: "2025-07-01", end: "2026-06-30" });
    assert.equal(previousFiscalYearLabel("FY 2026-27"), "FY 2025-26");
    assert.equal(shortFiscalYearLabel("FY 2026-27"), "FY27");
    assert.equal(shortPreviousFiscalYearLabel("FY 2026-27"), "FY26");
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

  it("fund totals follow the selected gift dates and omit Aquinas Center", () => {
    assert.equal(isHiddenAthleticsFund("Aquinas Center"), true);
    assert.equal(isHiddenAthleticsFund("Football Program"), false);
    const gifts = [
      ...SAMPLE.gifts,
      {
        ...SAMPLE.gifts[0]!,
        giftId: 30,
        giftDate: "2026-09-12",
        amountDesignated: 10,
        project: "Aquinas Center",
        projectCode: "AQ",
      },
    ];
    const kept = giftsFromLastTwoFiscalYears(gifts, "2026-07-01");
    assert.equal(kept.some((gift) => gift.project === "Aquinas Center"), false);
    const week = filterGifts(kept, {
      start: "2026-09-07",
      end: "2026-09-14",
      sportKey: "all",
      event: "all",
      fund: "all",
      search: "",
    });
    const rows = fundsFromGifts(week).filter((item) => !item.isFee && item.amount > 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.project, "Men's Ultimate Frisbee");
    assert.equal(rows[0]?.amount, 200);
    assert.deepEqual(intersectDateRange("2026-09-07", "2026-09-14", "2026-07-01", "2026-09-14"), {
      start: "2026-09-07",
      end: "2026-09-14",
    });
    assert.equal(intersectDateRange("2026-09-07", "2026-09-14", "2025-07-01", "2026-06-30"), null);
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
      event: "all",
      fund: "all",
      search: "",
    });
    const all = filterGifts(gifts, {
      start: null,
      end: null,
      sportKey: "all",
      event: "all",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(fy).programAmount, 1200);
    assert.equal(totalsFromGifts(all).programAmount, 6200);
  });

  it("excel rows include sport and amount for the filtered gifts", () => {
    const rows = giftExportRows(SAMPLE.gifts);
    assert.equal(rows[0]?.[2], "Address");
    assert.equal(rows[0]?.[6], "Sport");
    assert.equal(rows[1]?.[6], "Ultimate Frisbee");
    assert.equal(rows[2]?.[3], 1000);
  });

  it("search and excel include the donor address", () => {
    const gifts = [{ ...SAMPLE.gifts[1]!, address: "9531 E Stanhope Rd Kensington, MD 20895" }];
    const hit = filterGifts(gifts, {
      start: null,
      end: null,
      sportKey: "all",
      event: "all",
      fund: "all",
      search: "kensington",
    });
    assert.equal(hit.length, 1);
    const rows = giftExportRows(gifts);
    assert.equal(rows[1]?.[2], "9531 E Stanhope Rd Kensington, MD 20895");
  });

  it("event dropdown lists tournament segments and filters funds to that event", () => {
    const golf: AthleticsGivingGift = {
      ...SAMPLE.gifts[1]!,
      giftId: 13,
      giftDate: "2026-05-13",
      amountDesignated: 1000,
      project: "Athletics Program - General",
      projectCode: "6117AthGEN",
      segment: "2026 AMU Athletic Golf Tournament",
    };
    const footballGolf: AthleticsGivingGift = {
      ...SAMPLE.gifts[1]!,
      giftId: 14,
      giftDate: "2026-09-02",
      amountDesignated: 2500,
      segment: "FY27 Football Golf Tournament",
    };
    const booster: AthleticsGivingGift = {
      ...SAMPLE.gifts[1]!,
      giftId: 15,
      giftDate: "2026-09-12",
      amountDesignated: 250,
      project: "Gyrene Booster Club",
      projectCode: "6644",
      segment: "26-27 Gyrene Booster Club",
    };
    const hallOfFame: AthleticsGivingGift = {
      ...SAMPLE.gifts[0]!,
      giftId: 16,
      giftDate: "2026-08-15",
      amountDesignated: 400,
      project: "Athletics Program - General",
      projectCode: "6117AthGEN",
      segment: "26-27 Athletics Hall of Fame",
    };
    const sponsorship: AthleticsGivingGift = {
      ...SAMPLE.gifts[0]!,
      giftId: 17,
      giftDate: "2025-12-31",
      amountDesignated: 3000,
      contactName: "Ave Maria Dance Academy",
      project: "Athletics Program - General",
      projectCode: "6117AthGEN",
      segment: "Athletics Fundraising-HIST_DS",
    };
    const gifts = [...SAMPLE.gifts, golf, footballGolf, booster, hallOfFame, sponsorship];
    assert.equal(isEventSegment("Athletics Fundraising"), false);
    assert.equal(isEventSegment("Direct Solicitation (MGO)"), false);
    assert.equal(isEventSegment("2026 AMU Athletic Golf Tournament"), true);
    assert.equal(isEventSegment("26-27 Gyrene Booster Club"), true);
    assert.equal(eventLabel("2025 AMU Athletics Golf Tournament-HIST_EV"), "2025 AMU Athletics Golf Tournament");
    assert.deepEqual(eventOptions(gifts), [
      "FY27 Football Golf Tournament",
      "Athletics Sponsorship",
      "26-27 Gyrene Booster Club",
      "26-27 Athletics Hall of Fame",
      "2026 AMU Athletic Golf Tournament",
    ]);
    const filtered = filterGifts(gifts, {
      start: "2025-07-01",
      end: "2026-09-14",
      sportKey: "all",
      event: "2026 AMU Athletic Golf Tournament",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(filtered).programAmount, 1000);
    assert.equal(filtered.length, 1);
    const funds = fundsFromGifts(filtered).filter((item) => !item.isFee);
    assert.equal(funds.length, 1);
    assert.equal(funds[0]?.project, "Athletics Program - General");
    const sponsorshipGifts = filterGifts(gifts, {
      start: "2025-07-01",
      end: "2026-09-14",
      sportKey: "all",
      event: ATHLETICS_SPONSORSHIP_EVENT,
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(sponsorshipGifts).programAmount, 3000);
    assert.equal(sponsorshipGifts[0]?.contactName, "Ave Maria Dance Academy");
  });

  it("counts Ledo Pizza general-fund gifts as Athletics Sponsorship and leaves Wright Construction on golf", () => {
    const ledo: AthleticsGivingGift = {
      ...SAMPLE.gifts[0]!,
      giftId: 440043,
      giftDate: "2025-08-18",
      contactId: 125573,
      contactName: "Ledo Pizza Ave Maria Dreams & Pizza, LLC.",
      amountDesignated: 8000,
      project: "Athletics Program - General",
      projectCode: "6117AthGEN",
      segment: "2025 AMU Athletics Golf Tournament-HIST_EV",
      segmentCode: "FYE25AthGolf-HIST_EV",
    };
    const wright: AthleticsGivingGift = {
      ...SAMPLE.gifts[0]!,
      giftId: 435716,
      giftDate: "2025-08-01",
      contactId: 127206,
      contactName: "Wright Construction Group Inc",
      amountDesignated: 10000,
      project: "Athletics Program - General",
      projectCode: "6117AthGEN",
      segment: "2025 AMU Athletics Golf Tournament-HIST_EV",
      segmentCode: "FYE25AthGolf-HIST_EV",
    };
    const ledoDance: AthleticsGivingGift = {
      ...ledo,
      giftId: 441968,
      giftDate: "2025-10-15",
      amountDesignated: 200,
      project: "Dance Program",
      projectCode: "6596Dance",
    };
    const portal: AthleticsGivingGift = {
      ...SAMPLE.gifts[0]!,
      giftId: 18,
      giftDate: "2026-09-01",
      contactName: "New Sponsor LLC",
      amountDesignated: 5000,
      project: "Athletics Program - General",
      projectCode: "6117AthGEN",
      segment: "Athletics Sponsorships",
      segmentCode: "VOA_ATHLETICS_SPONSORSHIPS_DS",
    };
    const golf: AthleticsGivingGift = {
      ...SAMPLE.gifts[1]!,
      giftId: 13,
      giftDate: "2026-05-13",
      amountDesignated: 1000,
      project: "Athletics Program - General",
      projectCode: "6117AthGEN",
      segment: "2026 AMU Athletic Golf Tournament",
    };
    assert.equal(isAthleticsSponsorshipGift(ledo), true);
    assert.equal(isAthleticsSponsorshipGift(wright), false);
    assert.equal(isAthleticsSponsorshipGift(ledoDance), false);
    assert.equal(isAthleticsSponsorshipGift(portal), true);
    assert.equal(isEventSegment("Athletics Sponsorships"), false);
    const gifts = [...SAMPLE.gifts, ledo, wright, ledoDance, portal, golf];
    assert.deepEqual(eventOptions(gifts), [
      "Athletics Sponsorship",
      "2026 AMU Athletic Golf Tournament",
      "2025 AMU Athletics Golf Tournament-HIST_EV",
    ]);
    const sponsorshipGifts = filterGifts(gifts, {
      start: "2025-07-01",
      end: "2026-09-14",
      sportKey: "all",
      event: ATHLETICS_SPONSORSHIP_EVENT,
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(sponsorshipGifts).programAmount, 13000);
    assert.deepEqual(
      sponsorshipGifts.map((gift) => gift.contactName).sort(),
      ["Ledo Pizza Ave Maria Dreams & Pizza, LLC.", "New Sponsor LLC"],
    );
    const golfGifts = filterGifts(gifts, {
      start: "2025-07-01",
      end: "2026-09-14",
      sportKey: "all",
      event: "2026 AMU Athletic Golf Tournament",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(golfGifts).programAmount, 1000);
    assert.equal(golfGifts[0]?.contactName, "Jane Donor");
    const histGolf = filterGifts(gifts, {
      start: "2025-07-01",
      end: "2026-09-14",
      sportKey: "all",
      event: "2025 AMU Athletics Golf Tournament-HIST_EV",
      fund: "all",
      search: "",
    });
    assert.equal(totalsFromGifts(histGolf).programAmount, 10200);
    assert.deepEqual(
      histGolf
        .map((gift) => `${gift.contactName}|${gift.projectCode}`)
        .sort(),
      [
        "Ledo Pizza Ave Maria Dreams & Pizza, LLC.|6596Dance",
        "Wright Construction Group Inc|6117AthGEN",
      ],
    );
  });
});
