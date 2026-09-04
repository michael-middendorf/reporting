import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../../../lib/auth";
import { POST as campusEnroll } from "./route";
import { POST as campusVerify } from "../verify/route";
import { GET as campusStatus } from "../status/route";
import { POST as coachingEnroll } from "../../../../api/athletics-coaching/mfa/enroll/route";

const SECRET = "campus-mfa-enroll-test-secret";
const COACH = "coach.a@avemaria.edu";
const CAMPUS = [
  "cole.j.cantu@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
  "michael.t.middendorf@avemaria.edu",
] as const;

function authRequest(url: string, email: string | null, init: RequestInit = {}) {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.ASPIREDU_SESSION_TABLE;
  const headers = new Headers(init.headers);
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(url, { ...init, headers });
}

describe("campus vs coaching MFA enroll isolation", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;
  const prevTable = process.env.ASPIREDU_SESSION_TABLE;

  it("returns 410 from leftover /aspiredu/api/mfa/enroll and verify", async () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      const enroll = await campusEnroll();
      assert.equal(enroll.status, 410);
      const enrollBody = await enroll.json();
      assert.match(String(enrollBody.error), /\/api\/auth\/mfa\/enroll/);
      assert.equal(enroll.headers.get("set-cookie"), null);

      const verify = await campusVerify();
      assert.equal(verify.status, 410);
      assert.equal(verify.headers.get("set-cookie"), null);

      const status = await campusStatus(
        authRequest("https://reporting.avemaria.edu/aspiredu/api/mfa/status", COACH),
      );
      assert.equal(status.status, 403);
      const statusBody = await status.json();
      assert.equal(statusBody.error, "Forbidden");

      const leadership = await campusEnroll();
      assert.equal(leadership.status, 410);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
      if (prevTable === undefined) delete process.env.ASPIREDU_SESSION_TABLE;
      else process.env.ASPIREDU_SESSION_TABLE = prevTable;
    }
  });

  it("lets a coach enroll on /api/athletics-coaching/mfa/enroll", async () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      const response = await coachingEnroll(
        authRequest("https://reporting.avemaria.edu/api/athletics-coaching/mfa/enroll", COACH, {
          method: "POST",
        }),
      );
      assert.notEqual(response.status, 403);
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.match(String(body.error), /ASPIREDU_SESSION_TABLE is not configured/);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
      if (prevTable === undefined) delete process.env.ASPIREDU_SESSION_TABLE;
      else process.env.ASPIREDU_SESSION_TABLE = prevTable;
    }
  });

  it("does not mint leftover campus enroll for Cole, Regina, and Michael", async () => {
    try {
      for (const email of CAMPUS) {
        const response = await campusEnroll();
        assert.equal(response.status, 410, email);
        assert.equal(response.headers.get("set-cookie"), null, email);
      }
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevTable === undefined) delete process.env.ASPIREDU_SESSION_TABLE;
      else process.env.ASPIREDU_SESSION_TABLE = prevTable;
    }
  });
});
