import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASPIREDU_MFA_COOKIE } from "./aspiredu-auth";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth";
import { jsonWithReportingSession } from "./mint-session";

const SIGNING_KEY = "mint-session-test-secret";
const ERIC = "eric.vanheusen@avemaria.edu";

describe("jsonWithReportingSession", () => {
  it("mints a hub MFA session and expires leftover amu_aspiredu_mfa cookies", async () => {
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SIGNING_KEY;
    try {
      const res = jsonWithReportingSession(
        new Request("https://reporting.avemaria.edu/api/auth/mfa/verify", { method: "POST" }),
        ERIC,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { session?: string; email?: string };
      assert.equal(body.email, ERIC);
      assert.equal(verifySessionToken(String(body.session), SIGNING_KEY).mfa, true);
      const cookies = res.headers.getSetCookie();
      assert.equal(
        cookies.some((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`) && /Max-Age=\d+/.test(value)),
        true,
      );
      assert.equal(
        cookies.some((value) => value.includes(`${ASPIREDU_MFA_COOKIE}=`) && /Max-Age=0/.test(value) && /Path=\//.test(value)),
        true,
      );
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  });
});
