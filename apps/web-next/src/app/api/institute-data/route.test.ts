import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionToken } from "../../../lib/auth";
import { GET, instituteCache } from "./route";

const SECRET = "institute-route-test-secret";
const ALLOWED = [
  "cole.j.cantu@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
  "michael.t.middendorf@avemaria.edu",
  "liam.j.orourke@avemaria.edu",
  "garrett.j.hallinan@avemaria.edu",
  "gabriel.f.mellino@avemaria.edu",
];
const DENIED = [
  "becca.kennedy@avemaria.edu",
  "jim.thomas@avemaria.edu",
  "cassandra.l.bournos@avemaria.edu",
];
const env = process.env as Record<string, string | undefined>;

const SAMPLE_PAYLOAD = {
  source: "slate-live",
  generated_at: "Oct 12, 2026 at 11:00 PM EDT",
  counts: { q1: 100, q2: 50, q3: 20, q4: 10, q5: 5, q6: 30, q7: 15 },
  q4: [],
  q3: [],
  q5: [],
  q2: [],
  q1_summary: {},
  q2_summary: {},
  q6_summary: {},
  config: { goals: {}, pace: {}, recruiting: {} },
};

let prevSecret: string | undefined;
let prevFn: string | undefined;

beforeEach(() => {
  prevSecret = env.AUTH_SECRET;
  prevFn = env.INSTITUTE_FN_NAME;
  env.AUTH_SECRET = SECRET;
  env.INSTITUTE_FN_NAME = "mock-fn";

  instituteCache.clear();
  instituteCache.readDisk = async () => null;
  instituteCache.writeDisk = async () => {};
  instituteCache.fetchLive = async () => structuredClone(SAMPLE_PAYLOAD);
});

afterEach(() => {
  instituteCache.clear();
  if (prevSecret === undefined) delete env.AUTH_SECRET;
  else env.AUTH_SECRET = prevSecret;
  if (prevFn === undefined) delete env.INSTITUTE_FN_NAME;
  else env.INSTITUTE_FN_NAME = prevFn;
});

function req(email: string | null, query = "") {
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(`https://reporting.avemaria.edu/api/institute-data${query}`, { headers });
}

describe("GET /api/institute-data", () => {
  it("returns 401 without a session", async () => {
    assert.equal((await GET(req(null))).status, 401);
  });

  it("returns 403 for unauthorized users", async () => {
    for (const email of DENIED) {
      assert.equal((await GET(req(email))).status, 403, email);
    }
  });

  it("returns 200 with MISS on cold cache and populates cache", async () => {
    let fetchCalls = 0;
    instituteCache.fetchLive = async () => {
      fetchCalls++;
      return structuredClone(SAMPLE_PAYLOAD);
    };

    const res = await GET(req(ALLOWED[0]));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Cache-Status"), "MISS");
    assert.equal(fetchCalls, 1);

    const mem = instituteCache.getMemoryCache();
    assert.ok(mem);
    assert.deepEqual(mem.payload, SAMPLE_PAYLOAD);
  });

  it("returns 200 with HIT immediately when cache is fresh", async () => {
    let fetchCalls = 0;
    instituteCache.fetchLive = async () => {
      fetchCalls++;
      return structuredClone(SAMPLE_PAYLOAD);
    };

    instituteCache.setMemoryCache({
      payload: structuredClone(SAMPLE_PAYLOAD),
      timestamp: Date.now() - 60_000, // 1 minute old
    });

    const res = await GET(req(ALLOWED[0]));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Cache-Status"), "HIT");
    assert.equal(fetchCalls, 0); // No live fetch triggered
  });

  it("returns 200 with STALE immediately and triggers background refresh when stale", async () => {
    let backgroundStarted = false;
    instituteCache.fetchLive = async () => {
      backgroundStarted = true;
      return { ...SAMPLE_PAYLOAD, source: "refreshed" };
    };

    instituteCache.setMemoryCache({
      payload: structuredClone(SAMPLE_PAYLOAD),
      timestamp: Date.now() - 20 * 60 * 1000, // 20 minutes old (stale)
    });

    const res = await GET(req(ALLOWED[0]));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Cache-Status"), "STALE");
    const json = (await res.json()) as typeof SAMPLE_PAYLOAD;
    assert.equal(json.source, "slate-live");
    assert.equal(backgroundStarted, true);
  });

  it("bypasses cache when ?refresh=true is provided", async () => {
    let fetchCalls = 0;
    instituteCache.fetchLive = async () => {
      fetchCalls++;
      return { ...SAMPLE_PAYLOAD, source: "live-refreshed" };
    };

    instituteCache.setMemoryCache({
      payload: structuredClone(SAMPLE_PAYLOAD),
      timestamp: Date.now() - 60_000, // 1 min old
    });

    const res = await GET(req(ALLOWED[0], "?refresh=true"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Cache-Status"), "BYPASS");
    assert.equal(fetchCalls, 1);
    const json = (await res.json()) as typeof SAMPLE_PAYLOAD;
    assert.equal(json.source, "live-refreshed");
  });

  it("deduplicates concurrent fetches with inflight promise", async () => {
    let fetchCalls = 0;
    instituteCache.fetchLive = async () => {
      fetchCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return structuredClone(SAMPLE_PAYLOAD);
    };

    const [res1, res2] = await Promise.all([
      GET(req(ALLOWED[0])),
      GET(req(ALLOWED[1])),
    ]);

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(fetchCalls, 1); // Only one fetch made for both requests
  });

  it("falls back to stale cache when live fetch throws", async () => {
    instituteCache.fetchLive = async () => {
      throw new Error("Slate timeout");
    };

    instituteCache.setMemoryCache({
      payload: structuredClone(SAMPLE_PAYLOAD),
      timestamp: Date.now() - 30 * 60 * 1000,
    });

    const res = await GET(req(ALLOWED[0], "?refresh=true"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Cache-Status"), "STALE_FALLBACK");
    const json = (await res.json()) as typeof SAMPLE_PAYLOAD;
    assert.equal(json.source, "slate-live");
  });
});
