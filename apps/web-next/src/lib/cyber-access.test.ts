import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ADMIN_EMAILS,
  REPORT_IDS,
  STRICT_REPORTS,
  allowedEmailsForReport,
  canAccessReport,
  canLogin,
  isAdmin,
  needsMfaAtSignIn,
  reportsForEmail,
} from "./access";
import {
  createMfaPendingToken,
  createSessionToken,
  createSignedToken,
  MFA_PENDING_COOKIE,
  verifySessionToken,
} from "./auth";
import {
  CYBER_MAX_SESSION_AGE_SECONDS,
  cyberAccessLog,
  cyberSessionIsFresh,
  requireCyberAccess,
} from "./cyber-access";
import { jsonWithReportingSession } from "./mint-session";
import { signInAfterVerification } from "./sign-in-after-verification";

const SECRET = "cyber-access-test-hmac-key";
const MICHAEL = "michael.t.middendorf@avemaria.edu";
const KEITH = "keith.brooks@avemaria.edu";
const COLE = "cole.j.cantu@avemaria.edu";
const REGINA = "regina.m.pirolli@avemaria.edu";
const RANDOM = "someone.else@avemaria.edu";
const URL_DATA = "https://reporting.avemaria.edu/api/cybersecurity-data";

const env = process.env as Record<string, string | undefined>;
let prevSecret: string | undefined;
let prevEnv: string | undefined;

beforeEach(() => {
  prevSecret = env.AUTH_SECRET;
  prevEnv = env.ENROLLMENT_ALLOWED_EMAILS;
  env.AUTH_SECRET = SECRET;
});

afterEach(() => {
  if (prevSecret === undefined) delete env.AUTH_SECRET;
  else env.AUTH_SECRET = prevSecret;
  if (prevEnv === undefined) delete env.ENROLLMENT_ALLOWED_EMAILS;
  else env.ENROLLMENT_ALLOWED_EMAILS = prevEnv;
});

function bearerRequest(token: string | null) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request(URL_DATA, { headers });
}

const now = () => Math.floor(Date.now() / 1000);

describe("cybersecurity strict access", () => {
  it("allows Michael and Keith", () => {
    assert.equal(canAccessReport(MICHAEL, "cybersecurity"), true);
    assert.equal(canAccessReport(KEITH, "cybersecurity"), true);
    assert.equal(canAccessReport("  Keith.Brooks@AveMaria.edu ", "cybersecurity"), true);
  });

  it("denies Cole and Regina even though they are hub admins", () => {
    assert.equal(isAdmin(COLE), true);
    assert.equal(isAdmin(REGINA), true);
    assert.equal(canAccessReport(COLE, "cybersecurity"), false);
    assert.equal(canAccessReport(REGINA, "cybersecurity"), false);
    assert.equal(reportsForEmail(COLE).includes("cybersecurity"), false);
    assert.equal(reportsForEmail(REGINA).includes("cybersecurity"), false);
  });

  it("denies a random @avemaria.edu address and empty input", () => {
    assert.equal(canAccessReport(RANDOM, "cybersecurity"), false);
    assert.equal(canAccessReport("", "cybersecurity"), false);
  });

  it("is exactly the two hardcoded emails", () => {
    assert.deepEqual([...(STRICT_REPORTS.cybersecurity ?? [])].sort(), [KEITH, MICHAEL]);
    assert.deepEqual([...allowedEmailsForReport("cybersecurity")].sort(), [KEITH, MICHAEL]);
  });

  it("lets Keith sign in without making him an admin or adding MFA-at-sign-in", () => {
    assert.equal(canLogin(KEITH), true);
    assert.equal(isAdmin(KEITH), false);
    assert.equal(needsMfaAtSignIn(KEITH), false);
    assert.deepEqual(reportsForEmail(KEITH), ["cybersecurity"]);
  });

  it("leaves other reports unchanged for admins", () => {
    for (const admin of ADMIN_EMAILS) {
      for (const r of REPORT_IDS) {
        if (r === "cybersecurity") continue;
        assert.equal(canAccessReport(admin, r), true, `${admin} ${r}`);
      }
    }
    assert.deepEqual(
      reportsForEmail(COLE),
      REPORT_IDS.filter((r) => r !== "cybersecurity"),
    );
    assert.deepEqual(reportsForEmail(MICHAEL), [...REPORT_IDS]);
  });

  it("does not let Keith into any other report", () => {
    for (const r of REPORT_IDS) {
      if (r === "cybersecurity") continue;
      assert.equal(canAccessReport(KEITH, r), false, r);
    }
  });
});

describe("session auth and iat claims", () => {
  it("magic-link sign-in mints auth: magic with iat", () => {
    const req = new Request("https://reporting.avemaria.edu/api/auth/complete", { method: "POST" });
    const s = signInAfterVerification(req, "dan.donaldson@avemaria.edu", SECRET, "session");
    assert.equal(s.kind, "session");
    if (s.kind !== "session") return;
    const p = verifySessionToken(s.session, SECRET);
    assert.equal(p.auth, "magic");
    assert.equal(typeof p.iat, "number");
  });

  it("Entra sign-in mints auth: entra", () => {
    const req = new Request("https://reporting.avemaria.edu/api/auth/microsoft/callback");
    const s = signInAfterVerification(req, KEITH, SECRET, "session", "entra");
    if (s.kind !== "session") throw new Error("expected session");
    assert.equal(verifySessionToken(s.session, SECRET).auth, "entra");
  });

  it("Entra + /auth/mfa keeps auth: entra (Michael's path)", async () => {
    const pending = createMfaPendingToken(MICHAEL, SECRET, 10, { auth: "entra" });
    const req = new Request("https://reporting.avemaria.edu/api/auth/mfa/verify", {
      method: "POST",
      headers: { cookie: `${MFA_PENDING_COOKIE}=${encodeURIComponent(pending)}` },
    });
    const res = jsonWithReportingSession(req, MICHAEL);
    const body = (await res.json()) as { session: string };
    const p = verifySessionToken(body.session, SECRET);
    assert.equal(p.auth, "entra");
    assert.equal(p.mfa, true);
  });

  it("magic + /auth/mfa ends as auth: magic", async () => {
    const pending = createMfaPendingToken(MICHAEL, SECRET, 10, { auth: "magic" });
    const req = new Request("https://reporting.avemaria.edu/api/auth/mfa/verify", {
      method: "POST",
      headers: { cookie: `${MFA_PENDING_COOKIE}=${encodeURIComponent(pending)}` },
    });
    const body = (await jsonWithReportingSession(req, MICHAEL).json()) as { session: string };
    assert.equal(verifySessionToken(body.session, SECRET).auth, "magic");
  });

  it("an entra pending cookie for a different email does not carry over", async () => {
    const pending = createMfaPendingToken(KEITH, SECRET, 10, { auth: "entra" });
    const req = new Request("https://reporting.avemaria.edu/api/auth/mfa/verify", {
      method: "POST",
      headers: { cookie: `${MFA_PENDING_COOKIE}=${encodeURIComponent(pending)}` },
    });
    const body = (await jsonWithReportingSession(req, MICHAEL).json()) as { session: string };
    assert.equal(verifySessionToken(body.session, SECRET).auth, "magic");
  });

  it("pre-claim sessions still verify, with auth and iat null", () => {
    // Exact shape of a session minted before this change: no auth, no iat.
    const legacy = createSignedToken({ email: MICHAEL, exp: now() + 3600, type: "session" }, SECRET);
    const p = verifySessionToken(legacy, SECRET);
    assert.equal(p.email, MICHAEL);
    assert.equal(p.auth, null);
    assert.equal(p.iat, null);
    const r = requireCyberAccess(bearerRequest(legacy));
    assert.equal(r.ok, false);
  });
});

describe("requireCyberAccess", () => {
  it("401 with no session", () => {
    const r = requireCyberAccess(bearerRequest(null));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.response.status, 401);
  });

  it("403 Forbidden for an admin who is not on the strict list, even with fresh Entra", async () => {
    const t = createSessionToken(COLE, SECRET, 14, { auth: "entra" });
    const r = requireCyberAccess(bearerRequest(t));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.response.status, 403);
    assert.equal(((await r.response.json()) as { error: string }).error, "Forbidden");
  });

  it("403 reauth_microsoft for a magic-link session", async () => {
    const t = createSessionToken(MICHAEL, SECRET, 14, { auth: "magic" });
    const r = requireCyberAccess(bearerRequest(t));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.response.status, 403);
    assert.equal(((await r.response.json()) as { error: string }).error, "reauth_microsoft");
  });

  it("403 reauth_microsoft for a session with no auth claim (pre-change)", async () => {
    const t = createSessionToken(KEITH, SECRET, 14);
    const r = requireCyberAccess(bearerRequest(t));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(((await r.response.json()) as { error: string }).error, "reauth_microsoft");
  });

  it("403 reauth_microsoft for an Entra session older than 12 hours", async () => {
    const issued = now() - CYBER_MAX_SESSION_AGE_SECONDS - 60;
    const t = createSessionToken(KEITH, SECRET, 14, { auth: "entra", nowSeconds: issued });
    const r = requireCyberAccess(bearerRequest(t));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.response.status, 403);
    assert.equal(((await r.response.json()) as { error: string }).error, "reauth_microsoft");
  });

  it("passes a fresh Entra session for Michael and Keith", () => {
    for (const email of [MICHAEL, KEITH]) {
      const t = createSessionToken(email, SECRET, 14, { auth: "entra" });
      const r = requireCyberAccess(bearerRequest(t));
      assert.equal(r.ok, true, email);
      if (r.ok) assert.equal(r.email, email);
    }
  });

  it("passes an Entra session just under 12 hours, via cookie", () => {
    const issued = now() - CYBER_MAX_SESSION_AGE_SECONDS + 60;
    const t = createSessionToken(MICHAEL, SECRET, 14, { auth: "entra", nowSeconds: issued });
    const req = new Request(URL_DATA, {
      headers: { cookie: `amu_reporting_session=${encodeURIComponent(t)}` },
    });
    assert.equal(requireCyberAccess(req).ok, true);
  });

  it("logs one JSON line per call: denials with code, allows with email", () => {
    const lines: Record<string, unknown>[] = [];
    const realWrite = cyberAccessLog.write;
    cyberAccessLog.write = (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    };
    try {
      requireCyberAccess(bearerRequest(null));
      requireCyberAccess(bearerRequest(createSessionToken(COLE, SECRET, 14, { auth: "entra" })));
      requireCyberAccess(bearerRequest(createSessionToken(KEITH, SECRET, 14, { auth: "magic" })));
      requireCyberAccess(bearerRequest(createSessionToken(KEITH, SECRET, 14, { auth: "entra" })));
    } finally {
      cyberAccessLog.write = realWrite;
    }
    assert.equal(lines.length, 4);
    const route = "/api/cybersecurity-data";
    assert.deepEqual(
      lines.map((l) => [l.evt, l.email, l.route, l.code ?? null]),
      [
        ["cyber_access_denied", null, route, "unauthenticated"],
        ["cyber_access_denied", COLE, route, "forbidden"],
        ["cyber_access_denied", KEITH, route, "reauth_microsoft"],
        ["cyber_access", KEITH, route, null],
      ],
    );
    for (const l of lines) assert.equal(typeof l.ts, "string");
  });

  it("cyberSessionIsFresh rejects future iat and missing iat", () => {
    const n = 1_800_000_000;
    assert.equal(cyberSessionIsFresh({ auth: "entra", iat: n }, n), true);
    assert.equal(cyberSessionIsFresh({ auth: "entra", iat: n + 3600 }, n), false);
    assert.equal(cyberSessionIsFresh({ auth: "entra", iat: null }, n), false);
    assert.equal(cyberSessionIsFresh({ auth: "magic", iat: n }, n), false);
    assert.equal(cyberSessionIsFresh({ auth: null, iat: n }, n), false);
  });
});
