import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../lib/auth";
import type { AthleticsGivingSnapshot } from "../../../lib/reports/athletics-giving/shape";
import { GET, givingCache } from "./route";

const SECRET = "athletics-giving-route-test-secret";
const LEAD = "eric.vanheusen@avemaria.edu";
const ADVANCEMENT = "jim.thomas@avemaria.edu";
const COACH = "jamon.copeland@avemaria.edu";

const SAMPLE: AthleticsGivingSnapshot = {
  generated_at: "2026-09-14T18:00:00Z",
  source: "virtuous",
  segments: ["Athletics Fundraising"],
  fiscalYear: 2027,
  fiscalYearLabel: "FY 2026-27",
  fyStart: "2026-07-01",
  fyEnd: "2027-06-30",
  asOf: "2026-09-14T18:00:00Z",
  weekly: { amount: 0, programAmount: 0, feeAmount: 0, giftCount: 0, designationCount: 0 },
  fytd: { amount: 100, programAmount: 100, feeAmount: 0, giftCount: 1, designationCount: 1 },
  allTime: { amount: 100, programAmount: 100, feeAmount: 0, giftCount: 1, designationCount: 1 },
  funds: [],
  gifts: [],
};

function authRequest(email: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request("https://reporting.avemaria.edu/api/athletics-giving-data", { headers });
}

describe("GET /api/athletics-giving-data", () => {
  const prevSecret = process.env.AUTH_SECRET;

  it("allows coaching leadership and Advancement, not head coaches", async () => {
    const prev = givingCache.read;
    givingCache.read = async () => SAMPLE;
    try {
      assert.equal((await GET(authRequest(null))).status, 401);
      assert.equal((await GET(authRequest(COACH))).status, 403);
      const lead = await GET(authRequest(LEAD));
      assert.equal(lead.status, 200);
      const adv = await GET(authRequest(ADVANCEMENT));
      assert.equal(adv.status, 200);
    } finally {
      givingCache.read = prev;
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
    }
  });
});
