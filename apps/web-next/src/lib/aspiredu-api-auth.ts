import { canAccessReport } from "@/lib/access";

export function authorizeAcademicAffairsApi(email: string | null):
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string } {
  if (!email) return { ok: false, status: 401, error: "Authentication required" };
  if (!canAccessReport(email, "aspiredu")) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, email };
}
