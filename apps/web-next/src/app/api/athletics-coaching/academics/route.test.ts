import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { GET } from "./route";

const SECRET = "academics-route-test-secret";
const COACH = "coach.a@avemaria.edu";
const OTHER = "annie.esposito@avemaria.edu";
const ERIC = "eric.vanheusen@avemaria.edu";

function authRequest(email: string | null, sport: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const url = new URL("https://reporting.avemaria.edu/api/athletics-coaching/academics");
  if (sport !== null) url.searchParams.set("sport", sport);
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(url, { headers });
}

describe("GET /api/athletics-coaching/academics access and MFA", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  it("returns 401 MFA under /athletics/coaching and 403 for the wrong sport", async () => {
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

      const coach = await GET(authRequest(COACH, "football"));
      assert.equal(coach.status, 401);
      const coachBody = await coach.json();
      assert.equal(coachBody.error, "MFA required");
      assert.equal(coachBody.mfaUrl.startsWith("/athletics/coaching/mfa"), true);
      assert.equal(String(coachBody.mfaUrl).includes("/aspiredu/mfa"), false);

      const leadership = await GET(authRequest(ERIC, "womens-volleyball"));
      assert.equal(leadership.status, 401);
      const leadBody = await leadership.json();
      assert.equal(leadBody.error, "MFA required");
      assert.equal(leadBody.mfaUrl.includes("/athletics/coaching/mfa"), true);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });
});
