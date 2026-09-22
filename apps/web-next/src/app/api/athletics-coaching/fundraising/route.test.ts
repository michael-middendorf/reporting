import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import type { FundraisingCache } from "../../../../lib/reports/athletics-coaching/fundraising";
import { GET, fundraisingCache } from "./route";

const SECRET = "fundraising-route-test-secret";
const COACH = "coach.a@avemaria.edu";
const OTHER = "annie.esposito@avemaria.edu";

const SAMPLE_CACHE: FundraisingCache = {
  generated_at: "2026-09-03T12:00:00Z",
  source: "virtuous",
  fiscalYear: 2027,
  fiscalYearLabel: "FY 2026-27",
  fyStart: "2026-07-01",
  fyEnd: "2027-06-30",
  sports: {
    football: {
      key: "football",
      projectCode: "6552FB",
      mapped: true,
      fytdAmount: 80,
      fytdGiftCount: 2,
      allTimeAmount: 500,
      allTimeGiftCount: 9,
      asOf: "2026-09-03T12:00:00Z",
    },
    "womens-golf": {
      key: "womens-golf",
      projectCode: null,
      mapped: false,
      fytdAmount: null,
      fytdGiftCount: null,
      allTimeAmount: null,
      allTimeGiftCount: null,
      asOf: null,
      reason: "unmapped",
    },
  },
};

function authRequest(email: string | null, sport: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const url = new URL("https://reporting.avemaria.edu/api/athletics-coaching/fundraising");
  if (sport !== null) url.searchParams.set("sport", sport);
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(url, { headers });
}

describe("GET /api/athletics-coaching/fundraising access deny", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  it("returns 401 without a session and 403 for the wrong sport or report", async () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      const anon = await GET(authRequest(null, "football"));
      assert.equal(anon.status, 401);

      const unrelated = await GET(authRequest(OTHER, "football"));
      assert.equal(unrelated.status, 403);

      const wrongSport = await GET(authRequest(COACH, "mens-soccer"));
      assert.equal(wrongSport.status, 403);

      const unknown = await GET(authRequest(COACH, "not-a-sport"));
      assert.equal(unknown.status, 400);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });
});

describe("GET /api/athletics-coaching/fundraising cache", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;
  const originalRead = fundraisingCache.read;

  it("returns 200 for an assigned sport and 503 when the cache is missing", async () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football", "womens-golf"] });
    try {
      fundraisingCache.read = async () => SAMPLE_CACHE;
      const ok = await GET(authRequest(COACH, "football"));
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("Cache-Control"), "private, max-age=60");
      const body = await ok.json();
      assert.equal(body.sport, "football");
      assert.equal(body.mapped, true);
      assert.equal(body.fytdAmount, 80);
      assert.equal(body.fiscalYearLabel, "FY 2026-27");
      assert.deepEqual(body.gifts, []);

      const unmapped = await GET(authRequest(COACH, "womens-golf"));
      assert.equal(unmapped.status, 200);
      const empty = await unmapped.json();
      assert.equal(empty.mapped, false);
      assert.equal(empty.fytdAmount, null);
      assert.equal(empty.reason, "unmapped");
      assert.deepEqual(empty.gifts, []);

      fundraisingCache.read = async () => null;
      const missing = await GET(authRequest(COACH, "football"));
      assert.equal(missing.status, 503);
      const err = await missing.json();
      assert.equal(typeof err.error, "string");
      assert.equal("fytdAmount" in err, false);
    } finally {
      fundraisingCache.read = originalRead;
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });
});
