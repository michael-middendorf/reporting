import type { WorkflowState } from "./types";

/** Only these keys ever go to Slate. Never decisions, major, deposit, or award codes. */
export const MUSIC_SLATE_FIELDS = [
  "app_guid",
  "person_guid",
  "music_audition_review",
  "music_program_acceptance",
  "music_award",
  "music_loi_signed",
] as const;

const REVIEW_TO_SLATE: Record<WorkflowState["auditionReview"], string> = {
  none: "None",
  in_review: "In review",
  complete: "Complete",
};

const ACCEPT_TO_SLATE: Record<WorkflowState["programAcceptance"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  denied: "Denied",
};

export function musicSlateImportUrl(): string | undefined {
  const url = (process.env.MUSIC_SLATE_IMPORT_URL || "").trim();
  return url || undefined;
}

export function buildMusicSlatePayload(
  applicationId: string,
  personId: string,
  workflow: WorkflowState,
): Record<string, string> | { error: string } {
  const app = applicationId.trim();
  const person = personId.trim();
  if (!app) return { error: "app_guid is required" };
  if (!person) return { error: "person_guid is required" };
  const award = (workflow.musicAward || "").slice(0, 200);
  const payload: Record<string, string> = {
    app_guid: app,
    person_guid: person,
    music_audition_review: REVIEW_TO_SLATE[workflow.auditionReview],
    music_program_acceptance: ACCEPT_TO_SLATE[workflow.programAcceptance],
    music_award: award,
    music_loi_signed: workflow.loiSigned ? "Yes" : "No",
  };
  for (const key of Object.keys(payload)) {
    if (!(MUSIC_SLATE_FIELDS as readonly string[]).includes(key)) {
      return { error: `refusing unknown Slate field ${key}` };
    }
  }
  return payload;
}
