/** Client-safe types for the Music Prospect & Award Board (DST-1989). */

export const MUSIC_CYCLES = ["fa27", "fa26", "fa25"] as const;
export type MusicCycle = (typeof MUSIC_CYCLES)[number];

export const AUDITION_REVIEW = ["none", "in_review", "complete"] as const;
export type AuditionReview = (typeof AUDITION_REVIEW)[number];

export const PROGRAM_ACCEPTANCE = ["pending", "accepted", "denied"] as const;
export type ProgramAcceptance = (typeof PROGRAM_ACCEPTANCE)[number];

export type WorkflowState = {
  auditionReview: AuditionReview;
  programAcceptance: ProgramAcceptance;
  musicAward: string;
  loiSigned: boolean;
  updatedBy?: string;
  updatedAt?: string;
};

export type MusicRow = {
  applicationId: string;
  personId: string;
  first: string;
  last: string;
  email: string;
  phone: string;
  term: string;
  studentType: string;
  major: string;
  minor: string;
  enrollmentStatus: string;
  acceptCode: string;
  ameStatus: string;
  ameEvent: string;
  auditionRequested: boolean;
  auditionDate: string;
  auditionInstrument: string;
  loiFromSlate: boolean;
  loiCode: string;
  workflow: WorkflowState;
};

export type MusicBoardPayload = {
  generatedAt: string | null;
  applicantCount: number;
  rows: MusicRow[];
};

export type WorkflowInput = {
  applicationId: string;
  personId?: string;
  auditionReview?: AuditionReview;
  programAcceptance?: ProgramAcceptance;
  musicAward?: string;
  loiSigned?: boolean;
};

export const WORKFLOW_KEY = "music/workflow.json";

export type WorkflowDoc = {
  version: 1;
  rows: Record<string, WorkflowState>;
};

export function emptyWorkflowDoc(): WorkflowDoc {
  return { version: 1, rows: {} };
}

export function defaultWorkflow(): WorkflowState {
  return {
    auditionReview: "none",
    programAcceptance: "pending",
    musicAward: "",
    loiSigned: false,
  };
}

export function isAuditionReview(v: string): v is AuditionReview {
  return (AUDITION_REVIEW as readonly string[]).includes(v);
}

export function isProgramAcceptance(v: string): v is ProgramAcceptance {
  return (PROGRAM_ACCEPTANCE as readonly string[]).includes(v);
}

export function cycleTerm(cycle: MusicCycle): string {
  if (cycle === "fa25") return "Fall 2025";
  if (cycle === "fa26") return "Fall 2026";
  return "Fall 2027";
}

export function isMusicCycle(v: string): v is MusicCycle {
  return (MUSIC_CYCLES as readonly string[]).includes(v);
}
