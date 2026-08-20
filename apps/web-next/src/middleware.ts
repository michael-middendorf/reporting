import { NextResponse, type NextRequest } from "next/server";
import { CANONICAL_APP_HOST, LEGACY_CLOUDFRONT_HOST } from "@/lib/public-url";

/**
 * Send people on the CloudFront hostname to reporting.avemaria.edu so we
 * never have to hand out a second link. Leave /api and AspireDU OAuth
 * callbacks on the original host — Cognito requires an exact redirect_uri.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (host !== LEGACY_CLOUDFRONT_HOST) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/") || path.startsWith("/aspiredu/api/")) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.protocol = "https:";
  url.hostname = CANONICAL_APP_HOST;
  url.port = "";
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
