import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsMfaAtSignIn, sessionDecisionAtComplete } from "./access";
import { MFA_PENDING_COOKIE, mfaPendingCookie } from "./auth";
import { authorizeAcademicAffairsApi } from "./aspiredu-api-auth";
import { maskEmail } from "./mfa-pending";

const DANIEL = "daniel.davy@avemaria.edu";
const DAN = "dan.donaldson@avemaria.edu";

describe("needsMfaAtSignIn / complete branching", () => {
  it("sends Academic Affairs users through pending MFA even when already signed in", () => {
    assert.equal(needsMfaAtSignIn(DANIEL), true);
    assert.equal(sessionDecisionAtComplete(DANIEL, false), "mfa_pending");
    assert.equal(sessionDecisionAtComplete(DANIEL, true), "mfa_pending");
  });

  it("returns mfa_pending for Academic Affairs even when alreadySignedIn", () => {
    assert.equal(sessionDecisionAtComplete(DANIEL, true), "mfa_pending");
  });

  it("mints a session immediately for enrollment/housing-only users", () => {
    assert.equal(needsMfaAtSignIn(DAN), false);
    assert.equal(sessionDecisionAtComplete(DAN, false), "session");
    assert.equal(sessionDecisionAtComplete(DAN, true), "session");
    assert.equal(sessionDecisionAtComplete("gabriel.f.mellino@avemaria.edu", false), "session");
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
