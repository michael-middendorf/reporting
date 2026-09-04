import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASPIREDU_MFA_COOKIE } from "../../../../../lib/aspiredu-auth";
import { createSessionToken } from "../../../../../lib/auth";
import { GET } from "./route";

const SECRET = "campus-auth-status-test-secret";
const COACH = "coach.a@avemaria.edu";
const CAMPUS = [
  "cole.j.cantu@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
  "michael.t.middendorf@avemaria.edu",
] as const;

function authRequest(email: string | null, mfaCookie?: string) {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  if (mfaCookie) headers.set("Cookie", `${ASPIREDU_MFA_COOKIE}=${mfaCookie}`);
  return new Request("https://reporting.avemaria.edu/aspiredu/api/auth/status", { headers });
}

describe("GET /aspiredu/api/auth/status leftover campus MFA", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  it("returns 410 and does not treat a coaching TOTP cookie as campus MFA", async () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      const response = await GET(
        authRequest(COACH, "coach-totp-session"),
      );
      assert.equal(response.status, 410);
      const body = await response.json();
      assert.match(String(body.error), /\/auth\/mfa/);
      assert.equal(body.authenticated, undefined);
      assert.equal(response.headers.get("set-cookie"), null);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });

  it("returns 410 for Cole, Regina, and Michael", async () => {
    try {
      for (const email of CAMPUS) {
        const response = await GET();
        assert.equal(response.status, 410, email);
        const body = await response.json();
        assert.equal(body.authenticated, undefined, email);
      }
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
    }
  });
});
