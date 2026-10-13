import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { GET } from "./route";

const SECRET = "aspiredu-honors-route-test-secret";
const TERESA = "teresa.ledesma@avemaria.edu";
const BREIDENBACH = "michael.breidenbach@avemaria.edu";
const DAN = "dan.donaldson@avemaria.edu";
const COACH = "coach.a@avemaria.edu";

function request(email: string | null, extraCookie = "") {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  if (extraCookie) headers.set("Cookie", extraCookie);
  return new Request("https://reporting.avemaria.edu/aspiredu/api/honors", { headers });
}

describe("GET /aspiredu/api/honors access (DST-3065)", () => {
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

  it("requires a session and the aspiredu ACL", async () => {
    process.env.ASPIREDU_STUDENTS_FUNCTION = "amu-aspiredu-students";
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });

    const anon = await GET(request(null));
    assert.equal(anon.status, 401);

    const unrelated = await GET(request(DAN));
    assert.equal(unrelated.status, 403);

    const coach = await GET(request(COACH));
    assert.equal(coach.status, 403);
    assert.equal(coach.headers.get("X-Frame-Options"), "DENY");
  });

  it("returns 503 when the students Lambda is not configured", async () => {
    delete process.env.ASPIREDU_STUDENTS_FUNCTION;

    const teresa = await GET(request(TERESA));
    assert.equal(teresa.status, 503);
    const teresaBody = (await teresa.json()) as { error?: string };
    assert.equal(teresaBody.error?.includes("not configured"), true);

    const michael = await GET(request(BREIDENBACH));
    assert.equal(michael.status, 503);
    const michaelBody = (await michael.json()) as { error?: string };
    assert.equal(michaelBody.error?.includes("not configured"), true);
  });
});
