import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CensusRawStudent } from "../census/lists-core";
import {
  censusBuildDegraded,
  createCensusCache,
  generatedFromPrefix,
  type CensusBuild,
  type CensusProbe,
} from "./census-cache";

const ROW = { pcid: "P000000001" } as CensusRawStudent;
const FRESH = { pcid: "P000000002" } as CensusRawStudent;

function harness(options: { maxAgeMs?: number } = {}) {
  let clock = 0;
  let etag: string | null = "\"a\"";
  let next: CensusBuild | Error = { students: [ROW], degraded: false };
  const calls = { probe: 0, build: 0 };
  const cache = createCensusCache({
    now: () => clock,
    ttlMs: 1000,
    maxAgeMs: options.maxAgeMs,
    probe: async (): Promise<CensusProbe> => {
      calls.probe += 1;
      return etag === null
        ? null
        : { etag, generated: "2026-09-25 06:00", lastModified: "2026-09-25T10:00:00.000Z", inputs: { prior: true, residents: true } };
    },
    build: async () => {
      calls.build += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return {
    cache,
    calls,
    tick: (ms: number) => (clock += ms),
    setEtag: (value: string | null) => (etag = value),
    setBuild: (value: CensusBuild | Error) => (next = value),
  };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function silenced<T>(run: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => undefined;
  return run().finally(() => {
    console.warn = warn;
  });
}

describe("census cache", () => {
  it("reads generated from the start of students.json", () => {
    assert.equal(generatedFromPrefix('{"generated": "2026-09-25T06:00:00", "term": "Fall 2026"'), "2026-09-25T06:00:00");
    assert.equal(generatedFromPrefix('{"term": "Fall 2026"'), null);
  });

  it("serves from memory inside the TTL, then refreshes in the background and rebuilds only on a key change", async () => {
    const h = harness();
    const first = await h.cache.load();
    assert.deepEqual(first, { students: [ROW], asOf: "2026-09-25 06:00" });
    await h.cache.load();
    assert.deepEqual(h.calls, { probe: 1, build: 1 });

    // Expired, inputs unchanged: stale value now, one probe, no rebuild.
    h.tick(1500);
    assert.deepEqual(await h.cache.load(), first);
    await flush();
    assert.deepEqual(h.calls, { probe: 2, build: 1 });

    // Residents (or prior) changed while students.json did not: the composite key changes.
    h.setEtag("\"a\"|prior|residents-2");
    h.setBuild({ students: [FRESH], degraded: false });
    h.tick(1500);
    assert.deepEqual(await h.cache.load(), first, "stale value while the rebuild runs");
    await flush();
    assert.deepEqual(h.calls, { probe: 3, build: 2 });
    assert.deepEqual((await h.cache.load())?.students, [FRESH]);
  });

  it("rebuilds after the hard max age even when every ETag is unchanged", async () => {
    const h = harness({ maxAgeMs: 10_000 });
    await h.cache.load();
    h.setBuild({ students: [FRESH], degraded: false });
    for (let i = 0; i < 9; i += 1) {
      h.tick(1100);
      await h.cache.load();
      await flush();
    }
    assert.equal(h.calls.build, 1, "same ETag inside the max age");
    h.tick(1100);
    await h.cache.load();
    await flush();
    assert.equal(h.calls.build, 2);
    assert.deepEqual((await h.cache.load())?.students, [FRESH]);
  });

  it("keeps the last good value when a rebuild is degraded, and retries later", async () => {
    const h = harness();
    await h.cache.load();
    h.setEtag("\"b\"");
    h.setBuild({ students: [FRESH], degraded: true });
    h.tick(1500);
    await silenced(async () => {
      await h.cache.load();
      await flush();
    });
    assert.deepEqual((await h.cache.load())?.students, [ROW], "degraded build not cached");
    assert.equal(h.calls.build, 2);

    h.setBuild({ students: [FRESH], degraded: false });
    h.tick(1500);
    await h.cache.load();
    await flush();
    assert.deepEqual((await h.cache.load())?.students, [FRESH]);
  });

  it("keeps the last good value when a rebuild throws", async () => {
    const h = harness();
    await h.cache.load();
    h.setEtag("\"b\"");
    h.setBuild(new Error("s3 down"));
    h.tick(1500);
    await silenced(async () => {
      await h.cache.load();
      await flush();
    });
    assert.deepEqual((await h.cache.load())?.students, [ROW]);
  });

  it("serves but never caches a degraded first build", async () => {
    const h = harness();
    h.setBuild({ students: [FRESH], degraded: true });
    const first = await silenced(() => h.cache.load());
    assert.deepEqual(first?.students, [FRESH]);
    h.setBuild({ students: [ROW], degraded: false });
    assert.deepEqual((await h.cache.load())?.students, [ROW]);
    assert.equal(h.calls.build, 2);
  });

  it("shares one rebuild across concurrent misses", async () => {
    const h = harness();
    await Promise.all([h.cache.load(), h.cache.load(), h.cache.load()]);
    assert.deepEqual(h.calls, { probe: 1, build: 1 });
  });

  it("returns null when unpublished or empty, and never caches that", async () => {
    const h = harness();
    h.setEtag(null);
    assert.equal(await h.cache.load(), null);
    h.setEtag("\"a\"");
    h.setBuild({ students: [], degraded: false });
    assert.equal(await silenced(() => h.cache.load()), null);
    h.setBuild({ students: [ROW], degraded: false });
    assert.ok(await h.cache.load());
    assert.equal(h.calls.build, 2);
  });

  it("throws on a failed first build and caches nothing", async () => {
    let fail = true;
    const cache = createCensusCache({
      probe: async () => ({ etag: "x", generated: null, lastModified: "2026-09-25T10:00:00.000Z" }),
      build: async () => {
        if (fail) throw new Error("boom");
        return { students: [ROW], degraded: false };
      },
    });
    await assert.rejects(cache.load());
    fail = false;
    assert.deepEqual(await cache.load(), { students: [ROW], asOf: "2026-09-25T10:00:00.000Z" });
  });
});

describe("censusBuildDegraded", () => {
  it("flags an input that exists in S3 but came back empty", () => {
    const both = { prior: true, residents: true };
    assert.equal(censusBuildDegraded({ inputs: both, priorCount: 900, housingRowCount: 1200 }), false);
    assert.equal(censusBuildDegraded({ inputs: both, priorCount: 0, housingRowCount: 1200 }), true);
    assert.equal(censusBuildDegraded({ inputs: both, priorCount: 900, housingRowCount: 0 }), true);
    // Missing files are not a read failure.
    assert.equal(censusBuildDegraded({ inputs: { prior: false, residents: false }, priorCount: 0, housingRowCount: 0 }), false);
    assert.equal(censusBuildDegraded({ inputs: undefined, priorCount: 0, housingRowCount: 0 }), false);
  });
});
