import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { needsMfaAtSignIn } from "@/lib/access";
import {
  MFA_PENDING_COOKIE,
  SESSION_COOKIE_NAME,
  verifyMfaPendingToken,
  verifySessionToken,
} from "@/lib/auth";
import { GET as start } from "../route";
import { GET as callback } from "./route";

const SECRET = "entra-callback-test-hmac-key";
const TENANT = "7f4bc07b-d9b5-43c4-a1d6-bce660187973";
const CLIENT = "66a8909d-d22e-41bf-9092-4dbe06e393b0";
const REDIRECT = "https://reporting.avemaria.edu/api/auth/microsoft/callback";
const MFA_USER = "michael.t.middendorf@avemaria.edu"; // admin, so Academic Affairs, so MFA
const PLAIN_USER = "dan.donaldson@avemaria.edu"; // enrollment + housing only
const env = process.env as Record<string, string | undefined>;

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function stubCore(opts: { exchangeStatus?: number; email?: string }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/user-sessions/from-entra")) {
      const status = opts.exchangeStatus ?? 201;
      return new Response("{}", {
        status,
        headers: status === 201 ? { "Set-Cookie": "session_token=core-tok; HttpOnly; Path=/" } : {},
      });
    }
    if (url.endsWith("/users/me")) {
      return new Response(JSON.stringify({ email: opts.email ?? PLAIN_USER }), { status: 200 });
    }
    if (url.endsWith("/user-sessions/current")) return new Response(null, { status: 204 });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

function cookieHeader(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

const GOOD_COOKIES = {
  amu_reporting_entra_state: "the-state",
  amu_reporting_entra_verifier: "v".repeat(43),
  amu_reporting_entra_nonce: "n".repeat(43),
};

function callbackRequest(query: string, cookies: Record<string, string> = GOOD_COOKIES) {
  return new NextRequest(`https://reporting.avemaria.edu/api/auth/microsoft/callback${query}`, {
    headers: {
      cookie: cookieHeader(cookies),
      host: "reporting.avemaria.edu",
      "x-forwarded-proto": "https",
    },
  });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieValue(res: Response, name: string): string | null {
  for (const c of setCookies(res)) {
    if (c.startsWith(`${name}=`)) return c.slice(name.length + 1).split(";")[0];
  }
  return null;
}

function assertFailed(res: Response) {
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login?microsoft=failed");
  const cookies = setCookies(res);
  for (const name of Object.keys(GOOD_COOKIES).concat("amu_reporting_entra_from")) {
    assert.ok(
      cookies.some((c) => c.startsWith(`${name}=;`) && c.includes("Max-Age=0")),
      `${name} cleared`,
    );
  }
  assert.equal(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)), false, "no session");
  assert.equal(cookies.some((c) => c.startsWith(`${MFA_PENDING_COOKIE}=`)), false, "no pending");
}

before(() => {
  assert.equal(needsMfaAtSignIn(MFA_USER), true);
  assert.equal(needsMfaAtSignIn(PLAIN_USER), false);
});

beforeEach(() => {
  calls = [];
  env.NODE_ENV = "production";
  env.ENTRA_TENANT_ID = TENANT;
  env.ENTRA_CLIENT_ID = CLIENT;
  env.CORE_API_URL = "https://core.test";
  env.APP_BASE_URL = "https://reporting.avemaria.edu";
  env.AUTH_SECRET = SECRET;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("GET /api/auth/microsoft", () => {
  it("redirects to /login when Microsoft sign-in is off", async () => {
    env.NODE_ENV = "development";
    const res = await start(new NextRequest("http://localhost:3001/api/auth/microsoft"));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/login");
    assert.equal(setCookies(res).length, 0);
  });

  it("sets the round-trip cookies and 302s to Microsoft with the fixed redirect URI", async () => {
    const res = await start(
      new NextRequest("https://origin-evil.example/api/auth/microsoft?next=%2Fcensus", {
        headers: { host: "origin-evil.example", "x-forwarded-host": "evil.example" },
      }),
    );
    assert.equal(res.status, 302);
    const loc = new URL(String(res.headers.get("location")));
    assert.equal(loc.origin, "https://login.microsoftonline.com");
    assert.equal(loc.pathname, `/${TENANT}/oauth2/v2.0/authorize`);
    assert.equal(loc.searchParams.get("redirect_uri"), REDIRECT);
    assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
    const state = cookieValue(res, "amu_reporting_entra_state");
    assert.equal(loc.searchParams.get("state"), state);
    assert.equal(loc.searchParams.get("nonce"), cookieValue(res, "amu_reporting_entra_nonce"));
    assert.equal(decodeURIComponent(String(cookieValue(res, "amu_reporting_entra_from"))), "/census");
    for (const c of setCookies(res)) {
      assert.match(c, /Path=\/api\/auth\/microsoft; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    }
  });

  it("drops an unsafe next instead of storing it", async () => {
    const res = await start(new NextRequest("https://reporting.avemaria.edu/api/auth/microsoft?next=%2F%2Fevil.example"));
    const from = setCookies(res).find((c) => c.startsWith("amu_reporting_entra_from="));
    assert.match(String(from), /^amu_reporting_entra_from=; .*Max-Age=0/);
  });
});

describe("GET /api/auth/microsoft/callback failures", () => {
  it("fails when Microsoft sign-in is off, without calling core", async () => {
    env.ENTRA_CLIENT_ID = "";
    stubCore({});
    assertFailed(await callback(callbackRequest("?code=c&state=the-state")));
    assert.equal(calls.length, 0);
  });

  it("fails on a Microsoft error param", async () => {
    stubCore({});
    assertFailed(await callback(callbackRequest("?error=access_denied&state=the-state")));
    assert.equal(calls.length, 0);
  });

  it("fails when state is missing, mismatched, or the cookie is gone", async () => {
    stubCore({});
    assertFailed(await callback(callbackRequest("?code=c")));
    assertFailed(await callback(callbackRequest("?code=c&state=other-state")));
    assertFailed(
      await callback(
        callbackRequest("?code=c&state=the-state", {
          amu_reporting_entra_verifier: GOOD_COOKIES.amu_reporting_entra_verifier,
          amu_reporting_entra_nonce: GOOD_COOKIES.amu_reporting_entra_nonce,
        }),
      ),
    );
    assert.equal(calls.length, 0);
  });

  it("fails without a code, verifier, or nonce", async () => {
    stubCore({});
    assertFailed(await callback(callbackRequest("?state=the-state")));
    assertFailed(
      await callback(
        callbackRequest("?code=c&state=the-state", {
          amu_reporting_entra_state: "the-state",
          amu_reporting_entra_nonce: GOOD_COOKIES.amu_reporting_entra_nonce,
        }),
      ),
    );
    assert.equal(calls.length, 0);
  });

  it("fails when core refuses the code", async () => {
    stubCore({ exchangeStatus: 401 });
    assertFailed(await callback(callbackRequest("?code=c&state=the-state")));
    assert.equal(calls.length, 1);
  });

  it("fails for a verified email that is not on any report list, and revokes core", async () => {
    stubCore({ email: "nobody@avemaria.edu" });
    assertFailed(await callback(callbackRequest("?code=c&state=the-state")));
    assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/user-sessions/current")));
  });
});

describe("GET /api/auth/microsoft/callback success", () => {
  it("sends the fixed redirect URI and cookie verifier/nonce to core", async () => {
    stubCore({ email: PLAIN_USER });
    await callback(callbackRequest("?code=the-code&state=the-state"));
    const exchange = calls.find((c) => c.url === "https://core.test/user-sessions/from-entra");
    assert.deepEqual(exchange?.body, {
      code: "the-code",
      code_verifier: GOOD_COOKIES.amu_reporting_entra_verifier,
      redirect_uri: REDIRECT,
      nonce: GOOD_COOKIES.amu_reporting_entra_nonce,
    });
  });

  it("mints a hub session without the mfa claim and returns to the saved path", async () => {
    stubCore({ email: "Dan.Donaldson@AveMaria.edu" });
    const res = await callback(
      callbackRequest("?code=c&state=the-state", { ...GOOD_COOKIES, amu_reporting_entra_from: "/enrollment?x=1" }),
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/enrollment?x=1");
    const session = cookieValue(res, SESSION_COOKIE_NAME);
    assert.ok(session);
    const parsed = verifySessionToken(decodeURIComponent(session), SECRET);
    assert.equal(parsed.email, PLAIN_USER);
    assert.equal(parsed.mfa, false);
    assert.equal(parsed.auth, "entra", "Microsoft sign-in is marked for requireCyberAccess");
    assert.ok(typeof parsed.iat === "number" && Math.abs(parsed.iat - Date.now() / 1000) < 60, "fresh iat");
    assert.ok(setCookies(res).some((c) => c.startsWith(`${MFA_PENDING_COOKIE}=;`)), "pending cleared");
    assert.ok(setCookies(res).some((c) => c.startsWith("amu_reporting_entra_state=;")), "entra cleared");
    assert.ok(calls.some((c) => c.method === "DELETE"), "core session revoked");
  });

  it("ignores an unsafe saved path", async () => {
    stubCore({ email: PLAIN_USER });
    const res = await callback(
      callbackRequest("?code=c&state=the-state", { ...GOOD_COOKIES, amu_reporting_entra_from: "//evil.example" }),
    );
    assert.equal(res.headers.get("location"), "/");
  });

  it("sends Academic Affairs / coaching users to /auth/mfa with the pending cookie only", async () => {
    stubCore({ email: MFA_USER });
    const res = await callback(
      callbackRequest("?code=c&state=the-state", { ...GOOD_COOKIES, amu_reporting_entra_from: "/aspiredu" }),
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/auth/mfa");
    const pending = cookieValue(res, MFA_PENDING_COOKIE);
    assert.ok(pending);
    const pendingClaims = verifyMfaPendingToken(decodeURIComponent(pending), SECRET);
    assert.equal(pendingClaims.email, MFA_USER);
    assert.equal(pendingClaims.auth, "entra", "carried through /auth/mfa");
    const session = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    assert.match(String(session), new RegExp(`^${SESSION_COOKIE_NAME}=; .*Max-Age=0`), "hub session cleared, not minted");
  });
});
