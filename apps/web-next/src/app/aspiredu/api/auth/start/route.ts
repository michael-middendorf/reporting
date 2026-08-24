import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, isAspireduStudentViewer } from "@/lib/aspiredu-auth";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.redirect(new URL("/", req.url));
  if (!isAspireduStudentViewer(email)) {
    return NextResponse.json({ error: "Student-level access is not available for this account" }, { status: 403, headers: aspireduPrivateHeaders });
  }
  return NextResponse.redirect(new URL("/aspiredu/mfa", req.url), { headers: aspireduPrivateHeaders });
}
