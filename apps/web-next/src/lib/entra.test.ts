import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  ENTRA_COOKIES,
  buildEntraAuthorizeUrl,
  clearEntraCookies,
  createPkceVerifier,
  entraConfigFrom,
  entraCookie,
  entraFailureLoginPath,
  entraRedirectUri,
  pkceChallenge,
  timingSafeEqualString,
} from "./entra";

const TENANT = "7f4bc07b-d9b5-43c4-a1d6-bce660187973";
const CLIENT = "66a8909d-d22e-41bf-9092-4dbe06e393b0";
const CORE = "https://core.avemaria.edu";

describe("entraConfigFrom", () => {
  it("is on only in production with tenant, client and core URL", () => {
    const all = { NODE_ENV: "production", ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, CORE_API_URL: CORE };
    assert.deepEqual(entraConfigFrom(all), { tenantId: TENANT, clientId: CLIENT, coreApiUrl: CORE });
    assert.equal(entraConfigFrom({ ...all, NODE_ENV: "development" }), null);
    assert.equal(entraConfigFrom({ ...all, NODE_ENV: undefined }), null);
    assert.equal(entraConfigFrom({ ...all, ENTRA_TENANT_ID: "" }), null);
    assert.equal(entraConfigFrom({ ...all, ENTRA_CLIENT_ID: "  " }), null);
    assert.equal(entraConfigFrom({ ...all, CORE_API_URL: undefined }), null);
  });

  it("strips a trailing slash from the core URL", () => {
    const cfg = entraConfigFrom({
      NODE_ENV: "production",
      ENTRA_TENANT_ID: TENANT,
      ENTRA_CLIENT_ID: CLIENT,
      CORE_API_URL: `${CORE}/`,
    });
    assert.equal(cfg?.coreApiUrl, CORE);
  });
});

describe("entraRedirectUri", () => {
  it("is built from APP_BASE_URL with no trailing slash", () => {
    const expected = "https://reporting.avemaria.edu/api/auth/microsoft/callback";
    assert.equal(entraRedirectUri("https://reporting.avemaria.edu"), expected);
    assert.equal(entraRedirectUri("https://reporting.avemaria.edu/"), expected);
    assert.equal(entraRedirectUri("https://reporting.avemaria.edu//"), expected);
  });

  it("falls back to the canonical host when APP_BASE_URL is unset", () => {
    assert.equal(entraRedirectUri(""), "https://reporting.avemaria.edu/api/auth/microsoft/callback");
  });
});

describe("PKCE", () => {
  it("verifier is 43 url-safe chars and challenge is base64url SHA-256", () => {
    const v = createPkceVerifier();
    assert.match(v, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(pkceChallenge(v), createHash("sha256").update(v).digest("base64url"));
    assert.doesNotMatch(pkceChallenge(v), /[=+/]/);
  });
});

describe("timingSafeEqualString", () => {
  it("compares exactly", () => {
    assert.equal(timingSafeEqualString("abc", "abc"), true);
    assert.equal(timingSafeEqualString("abc", "abd"), false);
    assert.equal(timingSafeEqualString("abc", "abcd"), false);
  });
});

describe("buildEntraAuthorizeUrl", () => {
  it("builds the v2 authorize URL", () => {
    const url = new URL(
      buildEntraAuthorizeUrl({
        tenantId: TENANT,
        clientId: CLIENT,
        redirectUri: "https://reporting.avemaria.edu/api/auth/microsoft/callback",
        state: "s",
        nonce: "n",
        codeChallenge: "c",
      }),
    );
    assert.equal(url.origin, "https://login.microsoftonline.com");
    assert.equal(url.pathname, `/${TENANT}/oauth2/v2.0/authorize`);
    assert.equal(url.searchParams.get("client_id"), CLIENT);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("response_mode"), "query");
    assert.equal(url.searchParams.get("scope"), "openid profile email");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("prompt"), "select_account");
    assert.equal(url.searchParams.get("redirect_uri"), "https://reporting.avemaria.edu/api/auth/microsoft/callback");
  });
});

describe("entra cookies", () => {
  it("are HttpOnly, Secure, Lax, scoped to /api/auth/microsoft, 10 minutes", () => {
    assert.equal(
      entraCookie(ENTRA_COOKIES.state, "abc"),
      "amu_reporting_entra_state=abc; Path=/api/auth/microsoft; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("clears all four", () => {
    const cleared = clearEntraCookies();
    assert.equal(cleared.length, 4);
    for (const c of cleared) {
      assert.match(c, /^amu_reporting_entra_(state|verifier|nonce|from)=; Path=\/api\/auth\/microsoft; Max-Age=0; Expires=/);
    }
  });
});

describe("entraFailureLoginPath", () => {
  it("is the bare failure path when there is nothing worth carrying", () => {
    for (const raw of [undefined, null, "", "/", "/login", "/login?microsoft=failed", "/login/x", "/auth/mfa"]) {
      assert.equal(entraFailureLoginPath(raw), "/login?microsoft=failed", String(raw));
    }
  });

  it("carries a safe saved path, query included, as next", () => {
    assert.equal(entraFailureLoginPath("/census?term=FA26&x=1"), "/login?microsoft=failed&next=%2Fcensus%3Fterm%3DFA26%26x%3D1");
    const loc = new URL(entraFailureLoginPath("/athletics/coaching?sport=mbb"), "https://reporting.avemaria.edu");
    assert.equal(loc.origin, "https://reporting.avemaria.edu");
    assert.equal(loc.pathname, "/login");
    assert.equal(loc.searchParams.get("microsoft"), "failed");
    assert.equal(loc.searchParams.get("next"), "/athletics/coaching?sport=mbb");
  });

  it("drops off-origin and malformed saved paths", () => {
    for (const raw of ["//evil.com", "/\\evil.com", "/..//evil.com", "/%2e%2e//evil.com", "https://evil.com", "evil.com", "/\t/evil.com", "/a\nb", "/a\u0000b", "/a\u007fb"]) {
      assert.equal(entraFailureLoginPath(raw), "/login?microsoft=failed", JSON.stringify(raw));
    }
  });
});
