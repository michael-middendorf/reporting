import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import { parseListFilters, parseListInput } from "../../../../lib/reports/aspiredu/student-list";
import { GET, POST } from "./route";

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

describe("GET /aspiredu/api/students filters", () => {
  const DANIEL = "daniel.davy@avemaria.edu";

  function listRequest(query: string) {
    process.env.AUTH_SECRET = SECRET;
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${createSessionToken(DANIEL, SECRET, 1)}`);
    return new Request(`https://reporting.avemaria.edu/aspiredu/api/students?${query}`, { headers });
  }

  it("rejects a non-numeric minRisk or unknown sort with 400", async () => {
    const prevSecret = process.env.AUTH_SECRET;
    const prevFn = process.env.ASPIREDU_STUDENTS_FUNCTION;
    process.env.ASPIREDU_STUDENTS_FUNCTION = "amu-aspiredu-students";
    try {
      for (const query of ["minRisk=abc", "minRisk=-1", "minRisk=Infinity", "sort=grade"]) {
        const response = await GET(listRequest(query));
        assert.equal(response.status, 400, query);
      }
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevFn === undefined) delete process.env.ASPIREDU_STUDENTS_FUNCTION;
      else process.env.ASPIREDU_STUDENTS_FUNCTION = prevFn;
    }
  });

  it("parses valid filters", () => {
    const parse = (q: string) => parseListFilters(new URL(`https://x/?${q}`));
    assert.deepEqual(parse(""), { ok: true, query: undefined, minRisk: undefined, sort: undefined, cursor: undefined });
    assert.deepEqual(parse("minRisk=4&sort=name"), { ok: true, query: undefined, minRisk: 4, sort: "name", cursor: undefined });
    assert.deepEqual(parse("minRisk=2.5&sort=risk&query=%20smi%20"), {
      ok: true,
      query: "smi",
      minRisk: 2.5,
      sort: "risk",
      cursor: undefined,
    });
    assert.equal(parse("minRisk=").ok, true);
  });
});

describe("POST /aspiredu/api/students", () => {
  const DANIEL = "daniel.davy@avemaria.edu";
  const DAN = "dan.donaldson@avemaria.edu";

  function postRequest(email: string | null, body: string) {
    process.env.AUTH_SECRET = SECRET;
    const headers = new Headers({ "Content-Type": "application/json" });
    if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
    return new Request("https://reporting.avemaria.edu/aspiredu/api/students", { method: "POST", headers, body });
  }

  it("applies the same auth gate and validates the JSON body", async () => {
    const prevSecret = process.env.AUTH_SECRET;
    const prevFn = process.env.ASPIREDU_STUDENTS_FUNCTION;
    process.env.ASPIREDU_STUDENTS_FUNCTION = "amu-aspiredu-students";
    try {
      assert.equal((await POST(postRequest(null, "{}"))).status, 401);
      assert.equal((await POST(postRequest(DAN, "{}"))).status, 403);
      for (const body of ["not json", "[]", '{"minRisk":"abc"}', '{"minRisk":true}', '{"sort":"grade"}']) {
        const response = await POST(postRequest(DANIEL, body));
        assert.equal(response.status, 400, body);
      }
      delete process.env.ASPIREDU_STUDENTS_FUNCTION;
      assert.equal((await POST(postRequest(DANIEL, '{"query":"sm"}'))).status, 503);
    } finally {
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
      if (prevFn === undefined) delete process.env.ASPIREDU_STUDENTS_FUNCTION;
      else process.env.ASPIREDU_STUDENTS_FUNCTION = prevFn;
    }
  });

  it("parses a JSON body", () => {
    assert.deepEqual(parseListInput({ query: " Smith ", minRisk: 3, sort: "risk", cursor: "abc" }), {
      ok: true,
      query: "Smith",
      minRisk: 3,
      sort: "risk",
      cursor: "abc",
    });
    assert.equal(parseListInput({ minRisk: 1001 }).ok, false);
    assert.equal(parseListInput({ query: { $ne: 1 } }).ok, true);
    assert.equal((parseListInput({ query: { $ne: 1 } }) as { query?: string }).query, undefined);
  });
});
