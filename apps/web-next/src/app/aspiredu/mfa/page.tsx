import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_PENDING_COOKIE, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AspireduMfaRedirectPage() {
  const jar = await cookies();
  if (jar.get(MFA_PENDING_COOKIE)?.value) redirect("/auth/mfa");
  if (jar.get(SESSION_COOKIE_NAME)?.value) redirect("/settings/security");
  redirect("/");
}
