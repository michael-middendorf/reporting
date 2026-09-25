import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createSessionToken } from "../../../../../../lib/auth";
import { GET } from "./route";

const SECRET = "aspiredu-profile-route-test-secret";
const DANIEL = "daniel.davy@avemaria.edu";
const DAN = "dan.donaldson@avemaria.edu";
const COACH = "coach.a@avemaria.edu";
const KEY = "abcdefghijklmnopqrstuvwxyz012345";

function request(email: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(`https://reporting.avemaria.edu/aspiredu/api/students/${KEY}/profile`, { headers });
}

function params(studentKey: string) {
  return { params: Promise.resolve({ studentKey }) };
}

describe("GET /aspiredu/api/students/[studentKey]/profile", () => {
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

  it("requires a session and the aspiredu ACL (coaching-only is denied)", async () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    process.env.ASPIREDU_STUDENTS_FUNCTION = "amu-aspiredu-students";
    const anon = await GET(request(null), params(KEY));
    assert.equal(anon.status, 401);
    const unrelated = await GET(request(DAN), params(KEY));
    assert.equal(unrelated.status, 403);
    const coach = await GET(request(COACH), params(KEY));
    assert.equal(coach.status, 403);
    assert.equal(coach.headers.get("Cache-Control"), "no-store, max-age=0");
  });

  it("returns 503 when the Lambda is not configured", async () => {
    delete process.env.ASPIREDU_STUDENTS_FUNCTION;
    const response = await GET(request(DANIEL), params(KEY));
    assert.equal(response.status, 503);
  });

  it("rejects a malformed student key before invoking anything", async () => {
    process.env.ASPIREDU_STUDENTS_FUNCTION = "amu-aspiredu-students";
    for (const bad of ["short", "has space in it abcdefghijkl", "jane.doe@avemaria.edu-xxxxxxxx"]) {
      const response = await GET(request(DANIEL), params(bad));
      assert.equal(response.status, 400, bad);
    }
  });
});
