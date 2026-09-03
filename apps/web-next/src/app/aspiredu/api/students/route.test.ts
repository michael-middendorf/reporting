import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { GET } from "./route";

const SECRET = "aspiredu-students-route-test-secret";
const COACH = "coach.a@avemaria.edu";
const ERIC = "eric.vanheusen@avemaria.edu";

function authRequest(email: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request("https://reporting.avemaria.edu/aspiredu/api/students", { headers });
}

describe("GET /aspiredu/api/students coaching isolation", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  it("returns 403 for a coaching-only session, including leadership", async () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      const coach = await GET(authRequest(COACH));
      assert.equal(coach.status, 403);

      const leadership = await GET(authRequest(ERIC));
      assert.equal(leadership.status, 403);

      const anon = await GET(authRequest(null));
      assert.equal(anon.status, 401);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });
});
