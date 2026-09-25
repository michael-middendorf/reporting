/**
 * Server-side association sources for the Academic Affairs student profile.
 * Each loader returns null when its source is not published. Callers only ever
 * send ONE matched record to the browser (see student-profile.ts).
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { SlateRow } from "../athletics/types";
import type { CensusRawStudent } from "../census/lists-core";
import { CENSUS_STUDENTS_KEY } from "../census/lists";
import { omitExcludedHousing } from "../census/verify-notes";
import { readResidents } from "../housing/store";
import type { Resident } from "../housing/types";
import { dataBucket, s3 } from "../../s3-proxy";
import { isMissingSource, loadSourceRowsOptional } from "../../sources";
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

/**
 * Census students.json carries no snapshot date, so the as-of is the S3
 * object's LastModified (when the census list was last published).
 */
export async function loadProfileCensus(): Promise<ProfileSources["census"]> {
  const bucket = dataBucket();
  if (!bucket) return null;
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: CENSUS_STUDENTS_KEY }));
    if (!out.Body) return null;
    const raw = JSON.parse(await out.Body.transformToString()) as { students?: CensusRawStudent[] };
    if (!Array.isArray(raw.students)) return null;
    return { students: raw.students, asOf: out.LastModified ? out.LastModified.toISOString() : null };
  } catch (error) {
    if (isMissingSource(error)) return null;
    throw error;
  }
}
