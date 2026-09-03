import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET as callback } from "../../auth/callback/route";
import { GET as authStatus } from "../../auth/status/route";
import { POST as enroll } from "../enroll/route";
import { POST } from "./route";

describe("leftover AspireDU MFA minting routes", () => {
  it("returns 410 from POST /aspiredu/api/mfa/verify and does not Set-Cookie", async () => {
    const res = await POST(
      new Request("https://reporting.avemaria.edu/aspiredu/api/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      }),
    );
    assert.equal(res.status, 410);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error || "", /\/auth\/mfa/);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("returns 410 from POST /aspiredu/api/mfa/enroll", async () => {
    const res = await enroll();
    assert.equal(res.status, 410);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error || "", /\/api\/auth\/mfa\/enroll/);
  });

  it("returns 410 from GET /aspiredu/api/auth/callback without completing Cognito MFA", async () => {
    const res = await callback();
    assert.equal(res.status, 410);
  });

  it("returns 410 from GET /aspiredu/api/auth/status", async () => {
    const res = await authStatus();
    assert.equal(res.status, 410);
  });
});
