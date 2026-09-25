/**
 * Orchestration for GET /aspiredu/api/students/[studentKey]/profile.
 * Dependencies are injected so the route stays a thin wrapper and tests can
 * run without AWS.
 */
import {
  isAspireduCallerDenied,
  isCoachingActionUnavailable,
} from "../athletics-coaching/academics";
import {
  PROFILE_UNAVAILABLE,
  buildStudentProfile,
  lambdaProfileStatus,
  type ProfileSources,
  type StudentProfile,
} from "./student-profile";

export type ProfileDeps = {
  invoke: (payload: Record<string, unknown>) => Promise<unknown>;
  loadRoster: () => Promise<ProfileSources["roster"]>;
  loadHousing: () => Promise<ProfileSources["housing"]>;
  loadCensus: () => Promise<ProfileSources["census"]>;
};

export type ProfileResponse =
  | { status: 200; body: { ok: true; profile: StudentProfile } }
  | { status: 200; body: { ok: true; status: "awaiting_first_delivery"; profile: null } }
  | { status: 403 | 404 | 503; body: { error: string; status?: string } };

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function settle<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    // Fixed label and error class only: source errors can carry row data.
    console.warn(`aspiredu profile: ${label} source unavailable`, errorName(error));
    return null;
  }
}

export async function buildProfileResponse(input: {
  callerEmail: string;
  studentKey: string;
  deps: ProfileDeps;
}): Promise<ProfileResponse> {
  const { callerEmail, studentKey, deps } = input;
  let lambdaResult: unknown;
  try {
    lambdaResult = await deps.invoke({ action: "profile", callerEmail, studentKey });
  } catch (error) {
    if (isAspireduCallerDenied(error)) {
      return { status: 403, body: { error: "You do not have access to student records." } };
    }
    if (isCoachingActionUnavailable(error)) {
      return { status: 503, body: { error: PROFILE_UNAVAILABLE } };
    }
    // Never log or echo the message: invokeProcessor embeds the raw payload.
    console.error("aspiredu profile: Lambda invoke failed", errorName(error));
    return { status: 503, body: { error: "Unable to load the student profile." } };
  }

  const record =
    lambdaResult && typeof lambdaResult === "object" ? (lambdaResult as Record<string, unknown>) : null;
  if (!record || record.ok !== true) {
    // Only inspect non-ok payloads for "unsupported action": an ok payload holds
    // free-text notes that could contain those words.
    if (isCoachingActionUnavailable(lambdaResult)) {
      return { status: 503, body: { error: PROFILE_UNAVAILABLE } };
    }
    return { status: 503, body: { error: "Unable to load the student profile." } };
  }

  const status = lambdaProfileStatus(record);
  if (status === "awaiting_first_delivery") {
    return { status: 200, body: { ok: true, status: "awaiting_first_delivery", profile: null } };
  }
  if (status === "not_found") {
    return { status: 404, body: { error: "Student not found in the current AspireDU snapshot.", status: "not_found" } };
  }

  const [roster, housing, census] = await Promise.all([
    settle("athletics roster", deps.loadRoster),
    settle("housing", deps.loadHousing),
    settle("census", deps.loadCensus),
  ]);
  const profile = buildStudentProfile({ studentKey, lambdaResult: record, sources: { roster, housing, census } });
  if (!profile) {
    return { status: 404, body: { error: "Student not found in the current AspireDU snapshot.", status: "not_found" } };
  }
  return { status: 200, body: { ok: true, profile } };
}
