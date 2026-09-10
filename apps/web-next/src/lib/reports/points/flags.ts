/**
 * flags.ts — shared types + constants for Points count/remove overrides.
 *
 * A stored flag with status "removed" excludes that task from totals. No flag
 * (or any other status) means the task is counted as scored. Overrides are
 * SHARED — persisted in the ReportData S3 bucket so every reviewer sees the
 * same counted/removed set across browsers and sessions.
 *
 * Older documents may still contain "open" / "resolved" review flags; those
 * do not change scoring. This module is client-safe: pure types + constants,
 * NO aws-sdk imports. S3 read/write lives in `flags-store.ts`.
 */

/** Where the shared flag document lives in the ReportData bucket. */
export const FLAGS_KEY = "points/review-flags.json";

export type FlagStatus = "open" | "resolved" | "removed" | "pending" | "assigned";

/** True when this override excludes the task from dashboard totals. */
export function isRemovedFlag(flag?: { status?: FlagStatus } | null): boolean {
  return flag?.status === "removed";
}

/** One count/remove override. Context fields are captured at save time so a
 * removed row can still render without re-joining to the scored rows. */
export type ReviewFlag = {
  noteId: string;
  contactId?: string | null;
  contactName?: string | null;
  owner?: string | null; // MA name
  day?: string | null; // activity date (YYYY-MM-DD)
  type?: string | null; // Virtuous note type
  label?: string | null; // human activity label
  points?: number | null;
  reason: string;
  status: FlagStatus;
  flaggedBy: string; // reviewer email (server-stamped)
  flaggedAt: string; // ISO (server-stamped)
  updatedBy?: string;
  updatedAt?: string;
};

/** Versioned document persisted to S3. */
export type FlagsDoc = {
  version: 1;
  flags: Record<string, ReviewFlag>;
};

export function emptyFlagsDoc(): FlagsDoc {
  return { version: 1, flags: {} };
}

/** Fields a client may supply when creating/updating a flag. The server owns
 * noteId (from the URL/body), flaggedBy, and all timestamps. */
export type FlagInput = {
  noteId: string;
  contactId?: string | null;
  contactName?: string | null;
  owner?: string | null;
  day?: string | null;
  type?: string | null;
  label?: string | null;
  points?: number | null;
  reason?: string;
  status?: FlagStatus;
};
