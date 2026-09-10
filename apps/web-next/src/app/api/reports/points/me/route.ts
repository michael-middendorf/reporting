import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { currentUserEmail } from "@/lib/auth";
import { maForEmail } from "@/lib/reports/points/config.js";

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const ma = maForEmail(email);
  return NextResponse.json({
    email,
    maName: ma?.name || null,
  });
}
