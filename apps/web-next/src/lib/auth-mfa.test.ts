import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsMfaAtSignIn, sessionDecisionAtComplete } from "./access";
import {
  MFA_PENDING_COOKIE,
  createMfaPendingToken,
  createSessionToken,
  mfaPendingCookie,
  sessionHasHubMfa,
  verifySessionToken,
} from "./auth";
import { authorizeAcademicAffairsApi } from "./aspiredu-api-auth";
import { maskEmail, pendingAspireduEmail, signedInAspireduEmail } from "./mfa-pending";

const DANIEL = "daniel.davy@avemaria.edu";
const DAN = "dan.donaldson@avemaria.edu";
const ERIC = "eric.vanheusen@avemaria.edu";
const COACH = "coach.a@avemaria.edu";
const SIGNING_KEY = "auth-mfa-test-hmac-key";

describe("needsMfaAtSignIn / complete branching", () => {
  it("sends Academic Affairs users through pending MFA even when already signed in", () => {
    assert.equal(needsMfaAtSignIn(DANIEL), true);
    assert.equal(sessionDecisionAtComplete(DANIEL, false), "mfa_pending");
    assert.equal(sessionDecisionAtComplete(DANIEL, true), "mfa_pending");
  });

  it("returns mfa_pending for Academic Affairs even when alreadySignedIn", () => {
    assert.equal(sessionDecisionAtComplete(DANIEL, true), "mfa_pending");
  });

  it("sends coaching leadership and mapped coaches through hub MFA", () => {
    const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      assert.equal(needsMfaAtSignIn(ERIC), true);
      assert.equal(needsMfaAtSignIn(COACH), true);
      assert.equal(sessionDecisionAtComplete(ERIC, false), "mfa_pending");
      assert.equal(sessionDecisionAtComplete(COACH, true), "mfa_pending");
    } finally {
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });

  it("mints a session immediately for enrollment/housing-only users", () => {
    assert.equal(needsMfaAtSignIn(DAN), false);
    assert.equal(sessionDecisionAtComplete(DAN, false), "session");
    assert.equal(sessionDecisionAtComplete(DAN, true), "session");
    assert.equal(sessionDecisionAtComplete("gabriel.f.mellino@avemaria.edu", false), "session");
  });
});

describe("hub MFA session claim", () => {
  it("omits mfa on magic-link sessions and sets it after hub TOTP/passkey", () => {
    const magic = createSessionToken(ERIC, SIGNING_KEY, 1);
    const hub = createSessionToken(ERIC, SIGNING_KEY, 1, { mfa: true });
    assert.equal(verifySessionToken(magic, SIGNING_KEY).mfa, false);
    assert.equal(verifySessionToken(hub, SIGNING_KEY).mfa, true);
    const magicReq = new Request("https://reporting.avemaria.edu/", {
      headers: { Authorization: `Bearer ${magic}` },
    });
    const hubReq = new Request("https://reporting.avemaria.edu/", {
      headers: { Authorization: `Bearer ${hub}` },
    });
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SIGNING_KEY;
    try {
      assert.equal(sessionHasHubMfa(magicReq), false);
      assert.equal(sessionHasHubMfa(hubReq), true);
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  });
});

describe("pending hub MFA cookie accepts coaching users", () => {
  it("lets Academic Affairs and coaches complete /auth/mfa, not housing-only users", () => {
    const prev = process.env.AUTH_SECRET;
    const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;
    process.env.AUTH_SECRET = SIGNING_KEY;
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      function pendingReq(email: string) {
        const token = createMfaPendingToken(email, SIGNING_KEY);
        return new Request("https://reporting.avemaria.edu/api/auth/mfa/status", {
          headers: { Cookie: `${MFA_PENDING_COOKIE}=${token}` },
        });
      }
      function sessionReq(email: string) {
        const token = createSessionToken(email, SIGNING_KEY, 1, { mfa: true });
        return new Request("https://reporting.avemaria.edu/api/auth/passkey", {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      assert.equal(pendingAspireduEmail(pendingReq(DANIEL)), DANIEL);
      assert.equal(pendingAspireduEmail(pendingReq(ERIC)), ERIC);
      assert.equal(pendingAspireduEmail(pendingReq(COACH)), COACH);
      assert.equal(pendingAspireduEmail(pendingReq(DAN)), null);
      assert.equal(signedInAspireduEmail(sessionReq(ERIC)), ERIC);
      assert.equal(signedInAspireduEmail(sessionReq(DAN)), null);
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });
});

describe("pending MFA cookie token", () => {
  it("sets Path=/ HttpOnly SameSite=Lax and Secure on HTTPS", () => {
    const cookie = mfaPendingCookie("token.sig", 600, true);
    assert.equal(cookie.includes(`${MFA_PENDING_COOKIE}=token.sig`), true);
    assert.equal(cookie.includes("Path=/"), true);
    assert.equal(cookie.includes("HttpOnly"), true);
    assert.equal(cookie.includes("SameSite=Lax"), true);
    assert.equal(cookie.includes("Secure"), true);
    assert.equal(cookie.includes("Max-Age=600"), true);
    const httpCookie = mfaPendingCookie("token.sig", 600, false);
    assert.equal(httpCookie.includes("Secure"), false);
  });
});

describe("Academic Affairs API auth is session + ACL, not an MFA cookie", () => {
  it("returns 401 without a session email and 403 without aspiredu", () => {
    assert.deepEqual(authorizeAcademicAffairsApi(null), {
      ok: false,
      status: 401,
      error: "Authentication required",
    });
    assert.deepEqual(authorizeAcademicAffairsApi(DAN), {
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    assert.deepEqual(authorizeAcademicAffairsApi(DANIEL), { ok: true, email: DANIEL });
    assert.equal("mfa" in authorizeAcademicAffairsApi(DANIEL), false);
  });
});

describe("maskEmail", () => {
  it("hides the local part after the first character", () => {
    assert.equal(maskEmail(DANIEL), "d***@avemaria.edu");
  });
});
