/**
 * In-memory cache for the processed census students (loadCensusSnapshot()
 * output). Rebuilding the snapshot reads several S3 objects, so profile views
 * and the spreadsheet share one copy. Every five minutes the cache re-probes
 * its inputs and rebuilds only when the key changed. The key must cover every
 * S3 input that changes the student rows (students.json, prior.json, and
 * residents.json for eRez residency), not just students.json: the census file
 * is refreshed by hand and can sit unchanged for weeks while housing moves.
 *
 * Once a value exists, an expired entry is served immediately while one
 * coalesced refresh runs in the background, so requests never wait on a
 * rebuild after the first load. No AWS imports here so tests can use fakes.
 */
import type { CensusRawStudent } from "../census/lists-core";

export const CENSUS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Metadata for cache/census/students.json. null means the file is not published. */
export type CensusProbe = {
  /** Composite of the input ETags. Any change means rebuild. */
  etag: string | null;
  /** The file's own "generated" stamp, when present. */
  generated: string | null;
  lastModified: string | null;
} | null;

export type CensusCacheValue = { students: CensusRawStudent[]; asOf: string | null };

/** Reads the top-level "generated" stamp from the first bytes of students.json. */
export function generatedFromPrefix(prefix: string): string | null {
  const match = /"generated"\s*:\s*"([^"]{1,64})"/.exec(prefix);
  return match ? match[1]! : null;
}

export function createCensusCache(deps: {
  probe: () => Promise<CensusProbe>;
  build: () => Promise<CensusRawStudent[]>;
  now?: () => number;
  ttlMs?: number;
}): { load: () => Promise<CensusCacheValue | null>; clear: () => void } {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? CENSUS_CACHE_TTL_MS;
  let cached: { etag: string | null; checkedAt: number; value: CensusCacheValue } | null = null;
  let inflight: Promise<CensusCacheValue | null> | null = null;

  async function refresh(): Promise<CensusCacheValue | null> {
    const probe = await deps.probe();
    if (!probe) {
      cached = null;
      return null;
    }
    if (cached && probe.etag && cached.etag === probe.etag) {
      cached.checkedAt = now();
      return cached.value;
    }
    const students = await deps.build();
    // The census loaders turn S3 errors into an empty list. Treat that as
    // "unavailable" and do not cache it.
    if (!students.length) return null;
    const value = { students, asOf: probe.generated ?? probe.lastModified };
    cached = { etag: probe.etag, checkedAt: now(), value };
    return value;
  }

  function startRefresh(): Promise<CensusCacheValue | null> {
    // Concurrent misses share one rebuild. A failure is never cached.
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  return {
    load() {
      if (cached && now() - cached.checkedAt < ttl) return Promise.resolve(cached.value);
      if (cached) {
        // Stale while revalidating: keep serving the last good value.
        const stale = cached.value;
        startRefresh().catch((error) => {
          console.warn("aspiredu census cache: refresh failed", error instanceof Error ? error.name : typeof error);
        });
        return Promise.resolve(stale);
      }
      return startRefresh();
    },
    clear() {
      cached = null;
      inflight = null;
    },
  };
}
