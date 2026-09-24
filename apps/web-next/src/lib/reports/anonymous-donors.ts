import { allowedEmailsForReport, isAdmin } from "@/lib/access";
import { normalizeEmail } from "@/lib/auth";

/**
 * Donors whose Virtuous contact carries the "Anonymous Donor" tag. Publishers
 * set `anonymousDonor` on every named gift row: false only when the tag lookup
 * succeeded and the donor is not tagged. Advancement (and admins) see names;
 * everyone else gets "Anonymous" for any row not explicitly marked false,
 * including caches published before the flag existed.
 */
export const ANONYMOUS_LABEL = "Anonymous";

export function canSeeAnonymousDonorNames(email: string): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  return isAdmin(e) || allowedEmailsForReport("advancement").has(e);
}

const NAME_KEYS = ["donorName", "contactName"] as const;
// contactUrl links into Virtuous. contactId stays: it is an opaque internal id
// that client-side aggregation (sponsor detection, donor counts) keys on.
const ID_KEYS = ["contactUrl"] as const;

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  if (row.anonymousDonor === false) return row;
  const hasName = NAME_KEYS.some((k) => k in row);
  if (!hasName) return row;
  const out: Record<string, unknown> = { ...row };
  for (const k of NAME_KEYS) if (k in out) out[k] = ANONYMOUS_LABEL;
  for (const k of ID_KEYS) if (k in out) out[k] = null;
  return out;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const row = redactRow(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = walk(v);
    return out;
  }
  return value;
}

/** Returns the snapshot unchanged for Advancement viewers, redacted otherwise. */
export function redactAnonymousDonors<T>(snapshot: T, viewerEmail: string): T {
  if (canSeeAnonymousDonorNames(viewerEmail)) return snapshot;
  return walk(snapshot) as T;
}
