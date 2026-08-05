import { NextResponse } from "next/server";
import { isAdmin, reportsForEmail } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    email,
    admin: isAdmin(email),
    reports: reportsForEmail(email),
  });
}
