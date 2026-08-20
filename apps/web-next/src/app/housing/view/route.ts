import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { DASHBOARD_HTML } from "@/lib/reports/housing/dashboard-html";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "housing");
  if (denied) {
    if (denied.status === 401) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return denied;
  }

  return new NextResponse(DASHBOARD_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}
