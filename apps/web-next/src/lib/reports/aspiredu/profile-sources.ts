/**
 * Server-side association sources for the Academic Affairs student profile.
 * Each loader returns null when its source is not published. Callers only ever
 * send ONE matched record to the browser (see student-profile.ts).
 */
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { SlateRow } from "../athletics/types";
import { CENSUS_PRIOR_KEY, CENSUS_STUDENTS_KEY } from "../census/lists";
import { loadCensusSnapshot } from "../census/overlay";
import { omitExcludedHousing } from "../census/verify-notes";
import { RESIDENTS_KEY, readResidents } from "../housing/store";
import type { Resident } from "../housing/types";
import { dataBucket, s3 } from "../../s3-proxy";
import { isMissingSource, loadSourceRowsOptional } from "../../sources";
import { censusBuildDegraded, createCensusCache, generatedFromPrefix, type CensusProbe } from "./census-cache";
import type { ProfileSources } from "./student-profile";

export async function loadProfileRoster(): Promise<ProfileSources["roster"]> {
  const roster = await loadSourceRowsOptional<SlateRow>("athletics", "roster");
  if (!roster) return null;
  return { rows: roster.rows, asOf: roster.latest.pulled_at ?? roster.latest.dt ?? null };
}

export async function loadProfileHousing(): Promise<ProfileSources["housing"]> {
  if (!dataBucket()) return null;
  const payload = await readResidents();
  if (!payload || !Array.isArray(payload.residents)) return null;
  return {
    // Drop residents the census has hand-excluded (arrived, never registered).
    residents: omitExcludedHousing(payload.residents as Resident[]),
    asOf: payload.generated ?? payload.cached_at ?? null,
  };
}

async function headEtag(bucket: string, key: string): Promise<string> {
  try {
    const out = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return out.ETag ?? "none";
  } catch (error) {
    if (isMissingSource(error)) return "none";
    throw error;
  }
}

const censusCache = createCensusCache({
  async probe(): Promise<CensusProbe> {
    const bucket = dataBucket();
    if (!bucket) return null;
    try {
      // Only the first bytes: enough for the ETag, LastModified, and the
      // top-level "generated" stamp the census publisher writes first.
      const [out, prior, residents] = await Promise.all([
        s3().send(new GetObjectCommand({ Bucket: bucket, Key: CENSUS_STUDENTS_KEY, Range: "bytes=0-1023" })),
        headEtag(bucket, CENSUS_PRIOR_KEY),
        headEtag(bucket, RESIDENTS_KEY),
      ]);
      const prefix = out.Body ? await out.Body.transformToString() : "";
      return {
        // The processed rows also depend on prior.json (dual-enrollment
        // promotion) and residents.json (eRez residency, Ireland returning).
        etag: [out.ETag ?? "none", prior, residents].join("|"),
        generated: generatedFromPrefix(prefix),
        lastModified: out.LastModified ? out.LastModified.toISOString() : null,
        inputs: { prior: prior !== "none", residents: residents !== "none" },
      };
    } catch (error) {
      if (isMissingSource(error)) return null;
      throw error;
    }
  },
  async build(probe) {
    // The same processed students the Census report uses: eRez residency,
    // Ireland returning, dual-enrollment promotion, and verify notes applied.
    const { lists, housingRows } = await loadCensusSnapshot();
    return {
      students: lists.students,
      degraded: censusBuildDegraded({
        inputs: probe.inputs,
        priorCount: lists.prior.length,
        housingRowCount: housingRows.length,
      }),
    };
  },
});

/**
 * Processed census students (loadCensusSnapshot), re-probed every five
 * minutes, keyed by the students, prior, and residents ETags, rebuilt at least
 * hourly, and never cached from a degraded build (see census-cache.ts). As-of
 * is the students file's "generated" stamp, falling back to its LastModified.
 */
export async function loadProfileCensus(): Promise<ProfileSources["census"]> {
  return censusCache.load();
}
