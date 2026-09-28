import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cookieSecureFromRequest } from "./auth";

function req(headers: Record<string, string>) {
  return new Request("http://internal/api/auth/logout", { headers });
}

describe("cookieSecureFromRequest", () => {
  let prevNode: string | undefined;
  const env = process.env as Record<string, string | undefined>;

  beforeEach(() => {
    prevNode = env.NODE_ENV;
  });

  afterEach(() => {
    if (prevNode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prevNode;
  });

  it("production forces Secure even when the proxy forwards http", () => {
    env.NODE_ENV = "production";
    assert.equal(
      cookieSecureFromRequest(req({ "x-forwarded-proto": "http", host: "reporting.avemaria.edu" })),
      true,
    );
    assert.equal(
      cookieSecureFromRequest(
        req({ "x-forwarded-proto": "http", "x-forwarded-host": "reporting.avemaria.edu", host: "10.0.0.5:3000" }),
      ),
      true,
    );
  });

  it("production does not treat a localhost-prefixed public host as loopback", () => {
    env.NODE_ENV = "production";
    assert.equal(
      cookieSecureFromRequest(req({ "x-forwarded-proto": "http", host: "localhost.example.com" })),
      true,
    );
  });

  it("production on localhost over http is not Secure (local next start)", () => {
    env.NODE_ENV = "production";
    assert.equal(cookieSecureFromRequest(req({ "x-forwarded-proto": "http", host: "localhost:3000" })), false);
    assert.equal(cookieSecureFromRequest(req({ host: "127.0.0.1:3000" })), false);
  });

  it("non-production keeps the header-based behavior", () => {
    env.NODE_ENV = "development";
    assert.equal(
      cookieSecureFromRequest(req({ "x-forwarded-proto": "http", host: "reporting.avemaria.edu" })),
      false,
    );
    assert.equal(
      cookieSecureFromRequest(req({ "x-forwarded-proto": "https", host: "reporting.avemaria.edu" })),
      true,
    );
    assert.equal(cookieSecureFromRequest(req({ host: "localhost:3000" })), false);
  });
});
