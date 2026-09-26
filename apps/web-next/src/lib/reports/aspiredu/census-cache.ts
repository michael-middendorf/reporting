/**
 * In-memory cache for the processed census students (loadCensusSnapshot()
 * output). Rebuilding the snapshot reads several S3 objects, so profile views
 * and the spreadsheet share one copy.
 *
 * - Every five minutes the cache re-probes its inputs. The key covers every S3
 *   input that changes the student rows (students.json, prior.json, and
 *   residents.json for eRez residency), not just students.json: the census
 *   file is refreshed by hand and can sit unchanged for weeks.
 * - A build older than 60 minutes is rebuilt even when the key is unchanged.
 * - The census loaders turn some S3 read errors into empty lists. A build that
 *   reports itself degraded (an input the probe says exists came back empty)
 *   is never cached. A failed or degraded rebuild keeps serving the previous
 *   good value.
 * - Once a value exists, an expired entry is served immediately while one
 *   coalesced refresh runs in the background.
 *
 * No AWS imports here so tests can use fakes.
 */
import type { CensusRawStudent } from "../census/lists-core";

export const CENSUS_CACHE_TTL_MS = 5 * 60 * 1000;
export const CENSUS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

/** Metadata for the census inputs. null means students.json is not published. */
export type CensusProbe = {
  /** Composite of the input ETags. Any change means rebuild. */
  etag: string | null;
  /** The students file's own "generated" stamp, when present. */
  generated: string | null;
  lastModified: string | null;
  /** Which optional inputs exist in S3, so the build can spot a silent read failure. */
  inputs?: { prior: boolean; residents: boolean };
} | null;

export type CensusBuild = {
  students: CensusRawStudent[];
  /** True when an input that exists came back empty (a swallowed read error). */
  degraded: boolean;
};

export type CensusCacheValue = { students: CensusRawStudent[]; asOf: string | null };

/** Reads the top-level "generated" stamp from the first bytes of students.json. */
export function generatedFromPrefix(prefix: string): string | null {
  const match = /"generated"\s*:\s*"([^"]{1,64})"/.exec(prefix);
  return match ? match[1]! : null;
}

/**
 * loadCensusLists() turns a prior.json read error into [] and
 * loadCensusSnapshot() turns a residents.json read error into no housing rows.
 * When the probe saw the file in S3 but the snapshot came back without it, the
 * build is degraded (residency or dual-enrollment promotion was skipped).
 */
export function censusBuildDegraded(input: {
  inputs: { prior: boolean; residents: boolean } | undefined;
  priorCount: number;
  housingRowCount: number;
}): boolean {
  if (!input.inputs) return false;
  return (input.inputs.prior && input.priorCount === 0) || (input.inputs.residents && input.housingRowCount === 0);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function createCensusCache(deps: {
  probe: () => Promise<CensusProbe>;
  build: (probe: NonNullable<CensusProbe>) => Promise<CensusBuild>;
  now?: () => number;
  ttlMs?: number;
  maxAgeMs?: number;
}): { load: () => Promise<CensusCacheValue | null>; clear: () => void } {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? CENSUS_CACHE_TTL_MS;
  const maxAge = deps.maxAgeMs ?? CENSUS_CACHE_MAX_AGE_MS;
  let cached: { etag: string | null; checkedAt: number; builtAt: number; value: CensusCacheValue } | null = null;
  let inflight: Promise<CensusCacheValue | null> | null = null;

  async function refresh(): Promise<CensusCacheValue | null> {
    let probe: CensusProbe;
    try {
      probe = await deps.probe();
    } catch (error) {
      if (!cached) throw error;
      console.warn("aspiredu census cache: probe failed, keeping last good value", errorName(error));
      cached.checkedAt = now();
      return cached.value;
    }
    if (!probe) {
      cached = null;
      return null;
    }
    const fresh = cached && now() - cached.builtAt < maxAge;
    if (cached && fresh && probe.etag && cached.etag === probe.etag) {
      cached.checkedAt = now();
      return cached.value;
    }

    let build: CensusBuild;
    try {
      build = await deps.build(probe);
    } catch (error) {
      if (!cached) throw error;
      console.warn("aspiredu census cache: rebuild failed, keeping last good value", errorName(error));
      cached.checkedAt = now();
      return cached.value;
    }
    const value = { students: build.students, asOf: probe.generated ?? probe.lastModified };
    if (!build.students.length || build.degraded) {
      console.warn(
        JSON.stringify({
          event: "aspiredu_census_cache_degraded",
          students: build.students.length,
          keptPrevious: Boolean(cached),
        }),
      );
      if (cached) {
        // Retry at the next TTL, not on every request.
        cached.checkedAt = now();
        return cached.value;
      }
      // Nothing better to serve: use it for this request, but never cache it.
      return build.students.length ? value : null;
    }
    cached = { etag: probe.etag, checkedAt: now(), builtAt: now(), value };
    return value;
  }

  function startRefresh(): Promise<CensusCacheValue | null> {
    // Concurrent misses share one rebuild.
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
          console.warn("aspiredu census cache: refresh failed", errorName(error));
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
