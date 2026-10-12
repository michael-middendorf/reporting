import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { canLogin, needsMfaAtSignIn } from "@/lib/access";
import {
  MFA_PENDING_COOKIE,
  SESSION_COOKIE_NAME,
  createMagicToken,
  createMfaPendingToken,
  createSessionToken,
  createSignedToken,
  verifyMagicToken,
} from "@/lib/auth";
import { POST as requestLink } from "../request/route";
import { POST as complete } from "./route";

// Synthetic test-only signing key, not a real secret.
const SECRET = "magic-link-return-path-test-key";
// Allowlisted, goes through /auth/mfa (AspireDU / coaching / business office).
const MFA_USER = "michael.t.middendorf@avemaria.edu";
// Allowlisted, no MFA at sign-in.
const SESSION_USER = "dan.donaldson@avemaria.edu";

const HOSTILE = [
  "//evil.com",
  "/\\evil.com",
  "/..//evil.com",
  "/%2e%2e//evil.com",
  "/..%2f/evil",
  "https://evil.com",
  "javascript:alert(1)",
  "/\t/evil.com",
  "/a\u0000b",
  "/login?next=%2Fcensus",
  "/login",
  "/auth/mfa?next=%2Fcensus",
  "/auth/magic?token=x",
  "/",
];

const saved: Record<string, string | undefined> = {};
before(() => {
  for (const key of ["AUTH_SECRET", "SSO_ONLY", "RESEND_API_KEY", "NODE_ENV"]) saved[key] = process.env[key];
  Object.assign(process.env, { AUTH_SECRET: SECRET, SSO_ONLY: "false" });
  delete process.env.RESEND_API_KEY;
});
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** POST /api/auth/request and pull the token out of the dev-mode email log. */
async function requestToken(email: string, next?: unknown): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const res = await requestLink(
      new Request("http://localhost:3000/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000" },
        body: JSON.stringify(next === undefined ? { email } : { email, next }),
      }),
    );
    assert.equal(res.status, 200);
  } finally {
    console.log = original;
  }
  const link = lines.join("\n").match(/http:\/\/localhost:3000\/auth\/magic\?token=(\S+)/);
  assert.ok(link, "magic link logged");
  const url = new URL(link[0]);
  // The emailed URL carries the token only; the return path is inside it.
  assert.deepEqual([...url.searchParams.keys()], ["token"]);
  return url.searchParams.get("token") as string;
}

/**
 * POST /api/auth/complete. A pending cookie (MFA user) or session cookie
 * (session user) for the same email takes the existing no-nonce path, so the
 * test does not need the DynamoDB nonce table.
 */
async function completeWith(token: string, email: string) {
  const cookie = needsMfaAtSignIn(email)
    ? `${MFA_PENDING_COOKIE}=${encodeURIComponent(createMfaPendingToken(email, SECRET, 10, { auth: "magic" }))}`
    : `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken(email, SECRET, 1))}`;
  const res = await complete(
    new Request("http://localhost:3000/api/auth/complete", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", cookie },
      body: JSON.stringify({ token }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { redirect?: string; mfaRequired?: boolean } };
}

describe("magic-link return path", () => {
  it("test users are allowlisted with the expected MFA requirement", () => {
    assert.equal(canLogin(MFA_USER), true);
    assert.equal(needsMfaAtSignIn(MFA_USER), true);
    assert.equal(canLogin(SESSION_USER), true);
    assert.equal(needsMfaAtSignIn(SESSION_USER), false);
  });

  it("carries a safe path with its query through request and complete", async () => {
    const token = await requestToken(SESSION_USER, "/census?term=FA26&view=a.b");
    assert.equal(verifyMagicToken(token, SECRET).next, "/census?term=FA26&view=a.b");
    const r = await completeWith(token, SESSION_USER);
    assert.equal(r.status, 200);
    assert.equal(r.body.redirect, "/census?term=FA26&view=a.b");
  });

  it("sends an MFA user to /auth/mfa?next=<path>", async () => {
    const token = await requestToken(MFA_USER, "/aspiredu?tab=risk");
    const r = await completeWith(token, MFA_USER);
    assert.equal(r.status, 200);
    assert.equal(r.body.mfaRequired, true);
    assert.equal(r.body.redirect, `/auth/mfa?next=${encodeURIComponent("/aspiredu?tab=risk")}`);
  });

  it("defaults to / and bare /auth/mfa when no next was sent", async () => {
    assert.equal((await completeWith(await requestToken(SESSION_USER), SESSION_USER)).body.redirect, "/");
    assert.equal((await completeWith(await requestToken(MFA_USER), MFA_USER)).body.redirect, "/auth/mfa");
  });

  it("drops hostile next values at request time", async () => {
    for (const raw of [...HOSTILE, 42, { path: "/census" }]) {
      const label = JSON.stringify(raw);
      const token = await requestToken(SESSION_USER, raw);
      assert.equal(verifyMagicToken(token, SECRET).next, null, label);
      assert.equal((await completeWith(token, SESSION_USER)).body.redirect, "/", label);
      const mfa = await completeWith(await requestToken(MFA_USER, raw), MFA_USER);
      assert.equal(mfa.body.redirect, "/auth/mfa", label);
    }
  });

  it("re-validates next on completion even if a signed token carries a hostile one", async () => {
    for (const raw of HOSTILE) {
      const exp = Math.floor(Date.now() / 1000) + 600;
      const forged = createSignedToken({ email: SESSION_USER, exp, nonce: "n", type: "magic", next: raw }, SECRET);
      assert.equal(verifyMagicToken(forged, SECRET).next, null, raw);
      assert.equal((await completeWith(forged, SESSION_USER)).body.redirect, "/", raw);
      const forgedMfa = createSignedToken({ email: MFA_USER, exp, nonce: "n", type: "magic", next: raw }, SECRET);
      assert.equal((await completeWith(forgedMfa, MFA_USER)).body.redirect, "/auth/mfa", raw);
    }
  });

  it("a token for the return path is still bound to its email and type", () => {
    const token = createMagicToken(SESSION_USER, SECRET, 15, "/census");
    const p = verifyMagicToken(token, SECRET);
    assert.equal(p.email, SESSION_USER);
    assert.equal(p.type, "magic");
    assert.equal(typeof p.nonce, "string");
    assert.throws(() => verifyMagicToken(token, "other-key"));
  });
});
