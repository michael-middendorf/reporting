import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MAGIC_LINK_SENT_MSG } from "@/lib/auth-messages";
import { POST } from "./route";

describe("auth request message", () => {
  before(() => {
    process.env.AUTH_SECRET = "test-secret-for-auth-request";
    delete process.env.RESEND_API_KEY;
  });

  async function postEmail(email: string) {
    const req = new Request("http://localhost/api/auth/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "localhost:3000",
      },
      body: JSON.stringify({ email }),
    });
    const res = await POST(req);
    return { status: res.status, body: await res.json() };
  }

  it("uses the inbox copy", () => {
    assert.equal(MAGIC_LINK_SENT_MSG, "Go to your inbox. A sign-in link is on the way.");
  });

  it("returns the same message for allowlisted and non-allowlisted emails", async () => {
    const allowed = await postEmail("michael.t.middendorf@avemaria.edu");
    const denied = await postEmail("nobody@example.com");
    assert.equal(allowed.status, 200);
    assert.equal(denied.status, 200);
    assert.equal(allowed.body.ok, true);
    assert.equal(denied.body.ok, true);
    assert.equal(allowed.body.message, MAGIC_LINK_SENT_MSG);
    assert.equal(denied.body.message, MAGIC_LINK_SENT_MSG);
    assert.equal(allowed.body.message, denied.body.message);
  });
});
