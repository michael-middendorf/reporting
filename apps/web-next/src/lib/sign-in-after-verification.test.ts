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

it("preserves original Core timestamp in both signed mint branches and actual MFA completion", async()=>{
 const original=new Date(Date.now()-1000).toISOString().replace("Z","123+00:00");
 for(const kind of ["session","mfa_pending"] as const) {
  const result=signInAfterVerification(REQ,EMAIL,SECRET,kind,"entra",original);
  if(result.kind==="session") assert.equal(verifySessionToken(result.session,SECRET).auth_created_at,original);
  else {
   const token=result.setCookies[0].split(";")[0].split("=")[1];
   assert.equal(verifyMfaPendingToken(token,SECRET).auth_created_at,original);
   const {jsonWithReportingSession}=await import("./mint-session");
   const old=process.env.AUTH_SECRET;process.env.AUTH_SECRET=SECRET;
   try {
    const response=jsonWithReportingSession(new Request("https://reporting.avemaria.edu/auth/mfa",{headers:{cookie:MFA_PENDING_COOKIE+"="+token}}),EMAIL);
    const body=await response.json();assert.equal(verifySessionToken(body.session,SECRET).auth_created_at,original);
    assert.equal(verifySessionToken(body.session,SECRET).mfa,true);
   } finally {if(old===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=old;}
  }
 }
});
