import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatGiftDate,
  giftsInRange,
  isGivingReady,
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
});
