import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { GET } from "./route";

const SECRET = "aspiredu-courses-route-test-secret";
const DANIEL = "daniel.davy@avemaria.edu";
const DAN = "dan.donaldson@avemaria.edu";

function authRequest(email: string | null, extraCookie = "") {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.ASPIREDU_STUDENTS_FUNCTION;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  if (extraCookie) headers.set("Cookie", extraCookie);
  return new Request("https://reporting.avemaria.edu/aspiredu/api/courses", { headers });
}

describe("GET /aspiredu/api/courses access", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevFn = process.env.ASPIREDU_STUDENTS_FUNCTION;

  it("requires a magic-link session and aspiredu ACL, not an MFA cookie", async () => {
    try {
      const anon = await GET(authRequest(null, "amu_aspiredu_mfa=leftover"));
      assert.equal(anon.status, 401);

      const unrelated = await GET(authRequest(DAN, "amu_aspiredu_mfa=leftover"));
      assert.equal(unrelated.status, 403);

      const allowed = await GET(authRequest(DANIEL));
      assert.equal(allowed.status, 503);
      const body = (await allowed.json()) as { error?: string };
      assert.equal(body.error?.includes("not configured"), true);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevFn === undefined) delete process.env.ASPIREDU_STUDENTS_FUNCTION;
      else process.env.ASPIREDU_STUDENTS_FUNCTION = prevFn;
    }
  });
});
