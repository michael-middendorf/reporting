import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASPIREDU_MFA_COOKIE } from "./aspiredu-auth";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth";
import { jsonWithReportingSession, mfaReturnRedirect } from "./mint-session";

const SIGNING_KEY = "mint-session-test-hmac-key";
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

describe("mfaReturnRedirect", () => {
  const at = (query: string) => new Request(`https://reporting.avemaria.edu/api/auth/mfa/verify${query}`, { method: "POST" });

  it("returns the validated ?next= from the verify request", () => {
    assert.equal(mfaReturnRedirect(at("?next=%2Fcensus%3Fterm%3DFA26")), "/census?term=FA26");
  });

  it("falls back to / for missing, default, sign-in, or hostile values", () => {
    for (const q of ["", "?next=", "?next=%2F", "?next=%2Flogin", "?next=%2Fauth%2Fmfa", "?next=%2F%2Fevil.com", "?next=%2F..%2F%2Fevil.com", "?next=https%3A%2F%2Fevil.com", "?next=%2F%5Cevil.com", "?next=%2F%09%2Fevil.com"]) {
      assert.equal(mfaReturnRedirect(at(q)), "/", q);
    }
  });

  it("puts the validated path in the minted session response", async () => {
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SIGNING_KEY;
    try {
      const ok = (await jsonWithReportingSession(at("?next=%2Fenrollment%3Fx%3D1"), ERIC).json()) as { redirect: string };
      assert.equal(ok.redirect, "/enrollment?x=1");
      const bad = (await jsonWithReportingSession(at("?next=%2F%2Fevil.com"), ERIC).json()) as { redirect: string };
      assert.equal(bad.redirect, "/");
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  });
});
