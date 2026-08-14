/**
 * flags.ts — shared types + constants for the Points review-flag workflow.
 *
 * A "review flag" marks one scored task (a Virtuous ContactNote, keyed by its
 * note id) for follow-up verification: someone wants to confirm it counted
 * correctly. Flags are SHARED — persisted in the ReportData S3 bucket so every
 * reviewer (Regina, Cole, …) sees the same queue across browsers and sessions.
 *
 * This module is client-safe: pure types + constants, NO aws-sdk imports, so it
 * can be pulled into the browser page bundle. The S3 read/write lives in the
 * server-only companion `flags-store.ts`.
 */

/** Where the shared flag document lives in the ReportData bucket. */
export const FLAGS_KEY = "points/review-flags.json";

export type FlagStatus = "open" | "resolved";

/** One review flag. Context fields are captured at flag time so the review
 * queue renders without re-joining to the scored rows. */
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
