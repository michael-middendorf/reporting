import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { GET } from "./route";

const SECRET = "aspiredu-export-route-test-secret";
const DANIEL = "daniel.davy@avemaria.edu";
const DAN = "dan.donaldson@avemaria.edu";
const COACH = "coach.a@avemaria.edu";

function request(email: string | null, extraCookie = "") {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  if (extraCookie) headers.set("Cookie", extraCookie);
  return new Request("https://reporting.avemaria.edu/aspiredu/api/export", { headers });
}

describe("GET /aspiredu/api/export access", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevFn = process.env.ASPIREDU_STUDENTS_FUNCTION;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  after(() => {
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
    if (prevFn === undefined) delete process.env.ASPIREDU_STUDENTS_FUNCTION;
    else process.env.ASPIREDU_STUDENTS_FUNCTION = prevFn;
    if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
    else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
  });

  it("requires a magic-link session and the aspiredu ACL, not an MFA cookie", async () => {
    process.env.ASPIREDU_STUDENTS_FUNCTION = "amu-aspiredu-students";
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    const anon = await GET(request(null, "amu_aspiredu_mfa=leftover"));
    assert.equal(anon.status, 401);
    const unrelated = await GET(request(DAN, "amu_aspiredu_mfa=leftover"));
    assert.equal(unrelated.status, 403);
    const coach = await GET(request(COACH));
    assert.equal(coach.status, 403);
    assert.equal(coach.headers.get("X-Frame-Options"), "DENY");
  });

  it("returns 503 when the students Lambda is not configured", async () => {
    delete process.env.ASPIREDU_STUDENTS_FUNCTION;
    const allowed = await GET(request(DANIEL));
    assert.equal(allowed.status, 503);
    const body = (await allowed.json()) as { error?: string };
    assert.equal(body.error?.includes("not configured"), true);
  });
});
