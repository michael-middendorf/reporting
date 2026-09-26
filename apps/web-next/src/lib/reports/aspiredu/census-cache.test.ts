import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CensusRawStudent } from "../census/lists-core";
import { createCensusCache, generatedFromPrefix, type CensusProbe } from "./census-cache";

const ROW = { pcid: "P000000001" } as CensusRawStudent;

function harness(initialEtag = "\"a\"") {
  let clock = 0;
  let etag: string | null = initialEtag;
  let students: CensusRawStudent[] = [ROW];
  const calls = { probe: 0, build: 0 };
  const cache = createCensusCache({
    now: () => clock,
    ttlMs: 1000,
    probe: async (): Promise<CensusProbe> => {
      calls.probe += 1;
      return etag === null ? null : { etag, generated: "2026-09-25 06:00", lastModified: "2026-09-25T10:00:00.000Z" };
    },
    build: async () => {
      calls.build += 1;
      return students;
    },
  });
  return {
    cache,
    calls,
    tick: (ms: number) => (clock += ms),
    setEtag: (value: string | null) => (etag = value),
    setStudents: (value: CensusRawStudent[]) => (students = value),
  };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
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
    const fresh = { pcid: "P000000002" } as CensusRawStudent;
    h.setEtag("\"a\"|prior|residents-2");
    h.setStudents([fresh]);
    h.tick(1500);
    assert.deepEqual(await h.cache.load(), first, "stale value while the rebuild runs");
    await flush();
    assert.deepEqual(h.calls, { probe: 3, build: 2 });
    assert.deepEqual((await h.cache.load())?.students, [fresh]);
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
    h.setStudents([]);
    assert.equal(await h.cache.load(), null);
    h.setStudents([ROW]);
    assert.ok(await h.cache.load());
    assert.equal(h.calls.build, 2);
  });

  it("does not cache a failed build", async () => {
    let fail = true;
    const cache = createCensusCache({
      probe: async () => ({ etag: "x", generated: null, lastModified: "2026-09-25T10:00:00.000Z" }),
      build: async () => {
        if (fail) throw new Error("boom");
        return [ROW];
      },
    });
    await assert.rejects(cache.load());
    fail = false;
    assert.deepEqual(await cache.load(), { students: [ROW], asOf: "2026-09-25T10:00:00.000Z" });
  });
});
