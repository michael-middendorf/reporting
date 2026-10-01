import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../lib/auth";
import type { AdvancementPipelineSnapshot } from "../../../lib/reports/advancement-pipeline/shape";
import { GET, pipelineCache } from "./route";

const SECRET = "advancement-pipeline-route-test-secret";
const ADVANCEMENT = "leslie.sonnen@avemaria.edu";
const CHAPEL_ONLY = "robert.musselman@avemaria.edu";
const PORTFOLIOS_ONLY = "marita.emond@avemaria.edu";

const SAMPLE: AdvancementPipelineSnapshot = {
  generated_at: "2026-09-30T12:00:00Z",
  source: "virtuous",
  asOf: "2026-09-30",
  fiscalYearLabel: "FY 2026-27",
  window: { start: "2026-07-01", end: "2027-06-30" },
  buckets: [
    { key: "to_be_asked", label: "To Be Asked", statuses: [], totalAmount: 0, count: 0, rows: [] },
    { key: "asked", label: "Asked: Waiting for Response", statuses: [], totalAmount: 0, count: 0, rows: [] },
    { key: "accepted", label: "Accepted: Waiting for Check", statuses: [], totalAmount: 0, count: 0, rows: [] },
  ],
};

function authRequest(email: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request("https://reporting.avemaria.edu/api/advancement-pipeline-data", { headers });
}

async function withCache(
  seam: Partial<typeof pipelineCache>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = { ...pipelineCache };
  const prevSecret = process.env.AUTH_SECRET;
  Object.assign(pipelineCache, { readLocal: async () => null, ...seam });
  try {
    await fn();
  } finally {
    Object.assign(pipelineCache, prev);
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
  }
}

describe("GET /api/advancement-pipeline-data", () => {
  it("requires sign-in and the advancement report server-side", async () => {
    let reads = 0;
    await withCache(
      { read: async () => { reads += 1; return SAMPLE; }, build: async () => false },
      async () => {
        assert.equal((await GET(authRequest(null))).status, 401);
        assert.equal((await GET(authRequest(CHAPEL_ONLY))).status, 403);
        assert.equal((await GET(authRequest(PORTFOLIOS_ONLY))).status, 403);
        assert.equal(reads, 0, "denied users never reach the cache");
        const res = await GET(authRequest(ADVANCEMENT));
        assert.equal(res.status, 200);
        const body = (await res.json()) as AdvancementPipelineSnapshot;
        assert.equal(body.buckets.length, 3);
      },
    );
  });

  it("invokes the overview build once on a cold cache, then rereads S3", async () => {
    let reads = 0;
    let builds = 0;
    await withCache(
      {
        read: async () => (reads++ === 0 ? null : SAMPLE),
        build: async () => { builds += 1; return true; },
      },
      async () => {
        const res = await GET(authRequest(ADVANCEMENT));
        assert.equal(res.status, 200);
        assert.equal(builds, 1);
      },
    );
  });

  it("returns a clear 503 when nothing is published and 502 when the build fails", async () => {
    await withCache({ read: async () => null, build: async () => false }, async () => {
      const res = await GET(authRequest(ADVANCEMENT));
      assert.equal(res.status, 503);
      assert.match(((await res.json()) as { error: string }).error, /not published yet/);
    });
    await withCache(
      { read: async () => null, build: async () => { throw new Error("contacts failed"); } },
      async () => {
        const res = await GET(authRequest(ADVANCEMENT));
        assert.equal(res.status, 502);
      },
    );
  });
});
