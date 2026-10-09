import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { EntraSignInError, identityFromEntraCode, sessionTokenFromSetCookie } from "./entraSession";

const ORIGINAL = new Date(Date.now()-1000).toISOString().replace("Z", "123+00:00");
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
  return new Response(JSON.stringify({ id: "u", email, auth_context: {method:"entra", created_at: ORIGINAL} }), {
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

describe("identityFromEntraCode", () => {
  it("returns the lower-cased email and revokes the core session", async () => {
    stubFetch({ exchange: minted, me: () => me(" Someone@AveMaria.edu ") });
    assert.deepEqual(await identityFromEntraCode(INPUT), {email:"someone@avemaria.edu",authContext:{method:"entra",created_at:ORIGINAL}});
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
    await assert.rejects(identityFromEntraCode(INPUT), EntraSignInError);
    assert.ok(calls.some((c) => c.method === "DELETE"));
  });

  it("still revokes when /users/me has no email", async () => {
    stubFetch({ exchange: minted, me: () => new Response("{}", { status: 200 }) });
    await assert.rejects(identityFromEntraCode(INPUT), EntraSignInError);
    assert.ok(calls.some((c) => c.method === "DELETE"));
  });

  it("does not call core again when the exchange is refused", async () => {
    stubFetch({ exchange: () => new Response('{"detail":"x"}', { status: 401 }) });
    await assert.rejects(identityFromEntraCode(INPUT), (e: unknown) => {
      assert.ok(e instanceof EntraSignInError);
      assert.equal(e.status, 401);
      return true;
    });
    assert.equal(calls.length, 1);
  });

  it("ignores a token in the body and fails without the Set-Cookie", async () => {
    stubFetch({ exchange: () => new Response('{"token":"body-tok"}', { status: 201 }) });
    await assert.rejects(identityFromEntraCode(INPUT), EntraSignInError);
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
    await identityFromEntraCode(INPUT);
    assert.deepEqual(body, {
      code: "code",
      code_verifier: INPUT.codeVerifier,
      redirect_uri: INPUT.redirectUri,
      nonce: INPUT.nonce,
    });
  });
});

it("rejects missing, non-Entra, malformed and future Core proof even with rollout disabled and still revokes", async () => {
  const flag=process.env.SSO_ONLY; process.env.SSO_ONLY="false";
  try {
    for(const context of [undefined,null,{method:"otp",created_at:ORIGINAL},{method:"entra",created_at:"invalid"},{method:"entra",created_at:"2026-02-30T00:00:00Z"},{method:"entra",created_at:"2026-01-01T25:00:00Z"},{method:"entra",created_at:"2026-01-01T00:00:00"},{method:"entra",created_at:new Date(Date.now()+120000).toISOString()}]) {
      calls=[];
      stubFetch({exchange:minted,me:()=>new Response(JSON.stringify({email:"person@example.invalid",auth_context:context}),{status:200})});
      await assert.rejects(identityFromEntraCode(INPUT),EntraSignInError);
      assert.equal(calls.filter(c=>c.method==="DELETE").length,1);
    }
  } finally { if(flag===undefined)delete process.env.SSO_ONLY;else process.env.SSO_ONLY=flag; }
});
