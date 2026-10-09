import { loadSourceRowsOptional, type LatestPointer } from "@/lib/sources";
import type { MajorsSources, SourceRow } from "./shape";

const SOURCE = "powercampus";
const CACHE_MS = 10 * 60 * 1000;

let cached: { at: number; sources: MajorsSources } | null = null;

function latestPulledAt(pointers: (LatestPointer | undefined)[]): string | null {
  let best: string | null = null;
  for (const p of pointers) {
    const at = p?.pulled_at || null;
    if (at && (!best || at > best)) best = at;
  }
  return best;
}

/**
 * Every PowerCampus dataset the Majors and Minors report reads. All optional:
 * columns and code_enrollment added for DST-3015 may not be published yet, and
 * the shape module turns that into a waiting state instead of an error.
 */
export async function loadMajorsSources(): Promise<MajorsSources> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.sources;
  const load = (dataset: string) => loadSourceRowsOptional<SourceRow>(SOURCE, dataset);
  const [academic, curriculum, degree, appDecision, enrollment, classLevel, collegeAttend, calendar] =
    await Promise.all([
      load("academic"),
      load("code_curriculum"),
      load("code_degree"),
      load("code_appdecision"),
      load("code_enrollment"),
      load("code_classlevel"),
      load("code_collegeattend"),
      load("academic_calendar"),
    ]);
  const sources: MajorsSources = {
    academic: academic?.rows ?? null,
    codeCurriculum: curriculum?.rows ?? null,
    codeDegree: degree?.rows ?? null,
    codeAppDecision: appDecision?.rows ?? null,
    codeEnrollment: enrollment?.rows ?? null,
    codeClassLevel: classLevel?.rows ?? null,
    codeCollegeAttend: collegeAttend?.rows ?? null,
    academicCalendar: calendar?.rows ?? null,
    pulledAt: latestPulledAt([academic?.latest, degree?.latest, appDecision?.latest, enrollment?.latest]),
  };
  cached = { at: Date.now(), sources };
  return sources;
}
