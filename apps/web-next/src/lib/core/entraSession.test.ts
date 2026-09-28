import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { EntraSignInError, emailFromEntraCode, sessionTokenFromSetCookie } from "./entraSession";

const INPUT = {
  coreApiUrl: "https://core.test",
  code: "code",
  codeVerifier: "v".repeat(43),
  redirectUri: "https://reporting.avemaria.edu/api/auth/microsoft/callback",
  nonce: "n".repeat(43),
};

type Call = { url: string; method: string; cookie: string | null; hasSignal: boolean };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function stubFetch(routes: { exchange: () => Response; me?: () => Response; revoke?: () => Response }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, cookie: headers.Cookie ?? null, hasSignal: Boolean(init?.signal) });
    if (url.endsWith("/user-sessions/from-entra")) return routes.exchange();
    if (url.endsWith("/users/me")) return (routes.me ?? (() => new Response("{}", { status: 500 })))();
    if (url.endsWith("/user-sessions/current")) {
      return (routes.revoke ?? (() => new Response(null, { status: 204 })))();
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

function minted(): Response {
  return new Response(JSON.stringify({ id: "s" }), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "session_token=core-tok; HttpOnly; Path=/; SameSite=lax",
    },
  });
}

function me(email: string): Response {
  return new Response(JSON.stringify({ id: "u", email }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("sessionTokenFromSetCookie", () => {
  it("reads session_token and ignores other cookies", () => {
    const h = new Headers();
    h.append("Set-Cookie", "other=x; Path=/");
    h.append("Set-Cookie", "session_token=abc; HttpOnly");
    assert.equal(sessionTokenFromSetCookie(h), "abc");
    assert.equal(sessionTokenFromSetCookie(new Headers()), null);
  });
});

describe("emailFromEntraCode", () => {
  it("returns the lower-cased email and revokes the core session", async () => {
    stubFetch({ exchange: minted, me: () => me(" Someone@AveMaria.edu ") });
    assert.equal(await emailFromEntraCode(INPUT), "someone@avemaria.edu");
    const meCall = calls.find((c) => c.url.endsWith("/users/me"));
    assert.equal(meCall?.cookie, "session_token=core-tok");
    const revoke = calls.find((c) => c.method === "DELETE");
    assert.ok(revoke, "core session must be revoked");
    assert.equal(revoke.url, "https://core.test/user-sessions/current");
    assert.equal(revoke.cookie, "session_token=core-tok");
    assert.ok(calls.every((c) => c.hasSignal), "every core call has a timeout");
  });

  it("still revokes when /users/me fails", async () => {
    stubFetch({ exchange: minted, me: () => new Response("{}", { status: 401 }) });
    await assert.rejects(emailFromEntraCode(INPUT), EntraSignInError);
    assert.ok(calls.some((c) => c.method === "DELETE"));
  });

  it("still revokes when /users/me has no email", async () => {
    stubFetch({ exchange: minted, me: () => new Response("{}", { status: 200 }) });
    await assert.rejects(emailFromEntraCode(INPUT), EntraSignInError);
    assert.ok(calls.some((c) => c.method === "DELETE"));
  });

  it("does not call core again when the exchange is refused", async () => {
    stubFetch({ exchange: () => new Response('{"detail":"x"}', { status: 401 }) });
    await assert.rejects(emailFromEntraCode(INPUT), (e: unknown) => {
      assert.ok(e instanceof EntraSignInError);
      assert.equal(e.status, 401);
      return true;
    });
    assert.equal(calls.length, 1);
  });

  it("ignores a token in the body and fails without the Set-Cookie", async () => {
    stubFetch({ exchange: () => new Response('{"token":"body-tok"}', { status: 201 }) });
    await assert.rejects(emailFromEntraCode(INPUT), EntraSignInError);
    assert.equal(calls.length, 1);
  });

  it("sends only code, verifier, redirect and nonce", async () => {
    let body: unknown;
    stubFetch({ exchange: minted, me: () => me("a@avemaria.edu") });
    const wrapped = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/from-entra")) body = JSON.parse(String(init?.body));
      return wrapped(input, init);
    }) as typeof fetch;
    await emailFromEntraCode(INPUT);
    assert.deepEqual(body, {
      code: "code",
      code_verifier: INPUT.codeVerifier,
      redirect_uri: INPUT.redirectUri,
      nonce: INPUT.nonce,
    });
  });
});
