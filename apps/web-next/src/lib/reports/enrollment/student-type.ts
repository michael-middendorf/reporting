import type { StudentTypeLabel } from "./fall-report-config";

/** Map a Slate ApplicationStudentType value to the UG Fall-report buckets. */
export function mapStudentType(raw: unknown): StudentTypeLabel | null {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!s) return null;
  if (/transfer/.test(s)) return "Transfer";
  if (/re ?admit/.test(s) || /readmission/.test(s) || /re admission/.test(s)) {
    return "Re-Admit";
  }
  if (/second/.test(s) && (/degree/.test(s) || /bachelor/.test(s))) {
    return "Second Bachelor's";
  }
  if (
    /fresh/.test(s) ||
    (/first/.test(s) && (/year/.test(s) || /time/.test(s)))
  ) {
    return "First-Time Freshmen";
  }
  return null;
}

export function isUndergraduateRow(row: { ApplicationStudentType?: unknown }): boolean {
  return mapStudentType(row?.ApplicationStudentType) != null;
}
