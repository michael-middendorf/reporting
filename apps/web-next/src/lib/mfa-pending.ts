import { canAccessReport } from "@/lib/access";
import { currentMfaPendingEmail, currentUserEmail } from "@/lib/auth";

export function pendingAspireduEmail(req: Request): string | null {
  const email = currentMfaPendingEmail(req);
  if (!email || !canAccessReport(email, "aspiredu")) return null;
  return email;
}

export function signedInAspireduEmail(req: Request): string | null {
  const email = currentUserEmail(req);
  if (!email || !canAccessReport(email, "aspiredu")) return null;
  return email;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.slice(0, 1);
  return `${keep}***@${domain}`;
}
