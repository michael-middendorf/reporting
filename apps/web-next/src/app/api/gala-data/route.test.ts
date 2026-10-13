import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionToken } from "../../../lib/auth";
import { GALA_FIXTURE } from "../../../lib/reports/gala/fixture";
import type { GalaHistoryRow, GalaResponse } from "../../../lib/reports/gala/shape";
import { GET, galaCache } from "./route";

const SECRET = "gala-route-test-secret";
const ALLOWED = [
  "zena.weist@avemaria.edu",
  "susan.gallagher@avemaria.edu",
  "mark.middendorf@avemaria.edu",
  "leslie.sonnen@avemaria.edu",
  "stephanie.hayner@avemaria.edu",
  "julie.musselman@avemaria.edu",
  "michael.t.middendorf@avemaria.edu",
  "cole.j.cantu@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
];
const DENIED = ["becca.kennedy@avemaria.edu", "jim.thomas@avemaria.edu", "cassandra.l.bournos@avemaria.edu"];
const env = process.env as Record<string, string | undefined>;

const HISTORY: GalaHistoryRow[] = [
  {
    date: "2026-10-12",
    gross: { actual: 500000, actualPlusCommitment: 1200000 },
    expenses: { committed: 0 },
    netAfterExpenses: { actual: 500000, actualPlusCommitment: 1200000 },
  },
];

const realCache = { ...galaCache };
let prevSecret: string | undefined;

beforeEach(() => {
  prevSecret = env.AUTH_SECRET;
  env.AUTH_SECRET = SECRET;
  Object.assign(galaCache, {
    readLatest: async () => structuredClone(GALA_FIXTURE),
    readIndex: async () => structuredClone(HISTORY),
  });
});

afterEach(() => {
  Object.assign(galaCache, realCache);
  if (prevSecret === undefined) delete env.AUTH_SECRET;
  else env.AUTH_SECRET = prevSecret;
});

function req(email: string | null) {
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request("https://reporting.avemaria.edu/api/gala-data", { headers });
}

describe("GET /api/gala-data", () => {
  it("401 without a session", async () => {
    assert.equal((await GET(req(null))).status, 401);
  });

  it("403 for Advancement users off the strict list", async () => {
    for (const email of DENIED) assert.equal((await GET(req(email))).status, 403, email);
  });

  it("503 when no snapshot is published", async () => {
    Object.assign(galaCache, { readLatest: async () => null });
    const res = await GET(req(ALLOWED[0]));
    assert.equal(res.status, 503);
    assert.match(res.headers.get("cache-control") || "", /no-store/);
  });

  it("200 with latest and history, no-store, for every strict-list member", async () => {
    for (const email of ALLOWED) {
      const res = await GET(req(email));
      assert.equal(res.status, 200, email);
      assert.match(res.headers.get("cache-control") || "", /no-store/);
      const body = (await res.json()) as GalaResponse;
      assert.equal(body.latest.gross.actual, 508703.58);
      assert.deepEqual(body.history, HISTORY);
    }
  });

  it("returns an empty history when the index is missing", async () => {
    Object.assign(galaCache, { readIndex: async () => null });
    const res = await GET(req(ALLOWED[0]));
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as GalaResponse).history, []);
  });
});
