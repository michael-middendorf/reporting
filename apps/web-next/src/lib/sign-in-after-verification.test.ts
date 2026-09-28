import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MFA_PENDING_COOKIE, SESSION_COOKIE_NAME, verifyMfaPendingToken, verifySessionToken } from "./auth";
import { signInAfterVerification } from "./sign-in-after-verification";

const SECRET = "sign-in-after-verification-test-key";
const EMAIL = "someone@avemaria.edu";
const REQ = new Request("https://reporting.avemaria.edu/api/auth/complete", {
  headers: { host: "reporting.avemaria.edu", "x-forwarded-proto": "https" },
});

describe("signInAfterVerification", () => {
  it("session: 14-day hub cookie without the mfa claim, pending cleared", () => {
    const r = signInAfterVerification(REQ, EMAIL, SECRET, "session");
    assert.equal(r.kind, "session");
    if (r.kind !== "session") return;
    const parsed = verifySessionToken(r.session, SECRET);
    assert.equal(parsed.email, EMAIL);
    assert.equal(parsed.mfa, false);
    assert.equal(r.setCookies.length, 2);
    assert.equal(r.setCookies[0], `${SESSION_COOKIE_NAME}=${r.session}; Path=/; Max-Age=${14 * 86400}; HttpOnly; SameSite=Lax; Secure`);
    assert.match(r.setCookies[1], new RegExp(`^${MFA_PENDING_COOKIE}=; Path=/; Max-Age=0`));
  });

  it("mfa_pending: pending cookie, hub session and AspireDU MFA cookies cleared", () => {
    const r = signInAfterVerification(REQ, EMAIL, SECRET, "mfa_pending");
    assert.equal(r.kind, "mfa_pending");
    if (r.kind !== "mfa_pending") return;
    assert.equal(r.redirect, "/auth/mfa");
    assert.equal(r.setCookies.length, 4);
    const pending = r.setCookies[0].match(new RegExp(`^${MFA_PENDING_COOKIE}=([^;]+); Path=/; Max-Age=600;`));
    assert.ok(pending);
    assert.equal(verifyMfaPendingToken(pending[1], SECRET).email, EMAIL);
    assert.match(r.setCookies[1], new RegExp(`^${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`));
    assert.match(r.setCookies[2], /Path=\/aspiredu/);
    assert.match(r.setCookies[3], /Max-Age=0/);
  });
});
