import { NextResponse } from "next/server";
import { athleticsSportsForEmail, isAdmin, reportsForEmail } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { housingLocalDevEnabled } from "@/lib/housing-local-dev";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    if (housingLocalDevEnabled()) {
      return NextResponse.json({
        authenticated: true,
        email: "local-dev@localhost",
        admin: false,
        reports: ["housing"],
        athleticsSports: [],
      });
    }
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    email,
    admin: isAdmin(email),
    reports: reportsForEmail(email),
    athleticsSports: athleticsSportsForEmail(email),
  });
}
