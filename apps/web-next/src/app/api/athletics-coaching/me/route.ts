import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { coachingRole, visibleSports } from "@/lib/reports/athletics-coaching/access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canAccessReport(email, "athletics-coaching")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const role = coachingRole(email) || "coach";
  return NextResponse.json({
    role,
    sports: visibleSports(email).map((sport) => sport.key),
  });
}
