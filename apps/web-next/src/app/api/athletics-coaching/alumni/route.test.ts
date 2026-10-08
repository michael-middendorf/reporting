import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { GET } from "./route";

const SECRET = "alumni-route-test-secret";
const COACH = "coach.a@avemaria.edu";
const OTHER = "annie.esposito@avemaria.edu";
const MICHAEL = "michael.t.middendorf@avemaria.edu";

function authRequest(email: string | null, sport: string | null, options?: { mfa?: boolean }) {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.DATA_BUCKET;
  const url = new URL("https://reporting.avemaria.edu/api/athletics-coaching/alumni");
  if (sport !== null) url.searchParams.set("sport", sport);
  const headers = new Headers();
  if (email) {
    headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1, { mfa: options?.mfa })}`);
  }
  return new Request(url, { headers });
}

describe("GET /api/athletics-coaching/alumni access and email gating", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;
  const prevBucket = process.env.DATA_BUCKET;

  before(() => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    delete process.env.DATA_BUCKET;
  });

  after(() => {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
    if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
    else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    if (prevBucket === undefined) delete process.env.DATA_BUCKET;
    else process.env.DATA_BUCKET = prevBucket;
  });

  it("gates like the sibling coaching routes", async () => {
    assert.equal((await GET(authRequest(null, "football"))).status, 401);
    assert.equal((await GET(authRequest(OTHER, "football"))).status, 403);
    assert.equal((await GET(authRequest(COACH, "mens-soccer"))).status, 403);
    assert.equal((await GET(authRequest(COACH, "not-a-sport"))).status, 400);
  });

  it("serves a coach without MFA but hides emails and points at the authenticator", async () => {
    const response = await GET(authRequest(COACH, "football"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    const body = await response.json();
    assert.equal(body.emailsHidden, true);
    assert.equal(body.available, false);
    assert.equal(
      body.mfaUrl,
      "/athletics/coaching/mfa?next=%2Fathletics%2Fcoaching%2Ffootball%2Falumni",
    );
  });

  it("shows emails after hub MFA or for Academic Affairs admins", async () => {
    for (const [label, request] of [
      ["coach hub mfa", authRequest(COACH, "football", { mfa: true })],
      ["academic affairs admin", authRequest(MICHAEL, "football")],
    ] as const) {
      const response = await GET(request);
      assert.equal(response.status, 200, label);
      const body = await response.json();
      assert.equal(body.emailsHidden, false, label);
      assert.equal(body.mfaUrl, undefined, label);
    }
  });
});
