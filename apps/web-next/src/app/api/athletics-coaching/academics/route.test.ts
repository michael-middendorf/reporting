import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { academicsMfaUnlocked } from "../../../../lib/reports/athletics-coaching/academics";
import { GET } from "./route";

const SECRET = "academics-route-test-secret";
const COACH = "coach.a@avemaria.edu";
const OTHER = "annie.esposito@avemaria.edu";
const ERIC = "eric.vanheusen@avemaria.edu";
const MICHAEL = "michael.t.middendorf@avemaria.edu";
const COLE = "cole.j.cantu@avemaria.edu";

function authRequest(email: string | null, sport: string | null, options?: { mfa?: boolean }) {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.DATA_BUCKET;
  const url = new URL("https://reporting.avemaria.edu/api/athletics-coaching/academics");
  if (sport !== null) url.searchParams.set("sport", sport);
  const headers = new Headers();
  if (email) {
    headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1, { mfa: options?.mfa })}`);
  }
  return new Request(url, { headers });
}

async function assertNotMfaWall(response: Response, label: string) {
  const body = (await response.json()) as { error?: string; mfaUrl?: string; rosterAvailable?: boolean };
  assert.notEqual(response.status, 401, label);
  assert.notEqual(body.error, "MFA required", label);
  assert.equal(body.mfaUrl, undefined, label);
  if (response.status === 200) {
    assert.equal(body.rosterAvailable, false, label);
  }
}

describe("GET /api/athletics-coaching/academics access and MFA", () => {
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

  it("returns 401 MFA under /athletics/coaching and 403 for the wrong sport", async () => {
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
  });

  it("lets an Academic Affairs admin use the hub session without amu_aspiredu_mfa", async () => {
    for (const email of [MICHAEL, COLE]) {
      const response = await GET(authRequest(email, "football"));
      await assertNotMfaWall(response, email);
    }
  });

  it("keeps a magic-link coach session behind the authenticator wall", async () => {
    const response = await GET(authRequest(COACH, "football"));
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "MFA required");
    assert.equal(String(body.mfaUrl).startsWith("/athletics/coaching/mfa"), true);
  });

  it("lets a coach with hub MFA on the session skip the FERPA cookie", async () => {
    const response = await GET(authRequest(COACH, "football", { mfa: true }));
    await assertNotMfaWall(response, "coach hub mfa");
  });

  it("lets a coach with the leftover FERPA cookie skip hub MFA", () => {
    assert.equal(academicsMfaUnlocked({ email: COACH, hubMfa: false, ferpa: true }), true);
    assert.equal(academicsMfaUnlocked({ email: COACH, hubMfa: false, ferpa: false }), false);
  });
});
