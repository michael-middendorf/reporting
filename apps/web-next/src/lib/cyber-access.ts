import { NextResponse } from "next/server";
import { currentSession, type SessionClaims } from "@/lib/auth";
import { requireReportAccess } from "@/lib/s3-proxy";

/** A Cybersecurity session must be a Microsoft sign-in no older than this. */
export const CYBER_MAX_SESSION_AGE_SECONDS = 12 * 60 * 60;

/** Error code the pages key off to show "Sign in with Microsoft". */
export const CYBER_REAUTH_ERROR = "reauth_microsoft";

export type CyberDenyCode = "unauthenticated" | "forbidden" | typeof CYBER_REAUTH_ERROR;

/**
 * Where the one-line JSON access events go (stdout, so CloudWatch
 * /ecs/amu-reporting/web-v3). A seam so tests can capture lines.
 */
export const cyberAccessLog = {
  write(line: string) {
    console.log(line);
  },
};

export type CyberAccessResult =
  | { ok: true; email: string; session: SessionClaims }
  | { ok: false; response: NextResponse };

/**
 * Pure check of an already-verified session against the Cybersecurity rule:
 * Microsoft (Entra) sign-in, with an iat no older than 12 hours and not in
 * the future (small clock skew allowed). Exported for tests.
 */
export function cyberSessionIsFresh(
  session: Pick<SessionClaims, "auth" | "iat">,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (session.auth !== "entra") return false;
  if (session.iat === null) return false;
  if (session.iat > nowSeconds + 300) return false;
  return nowSeconds - session.iat <= CYBER_MAX_SESSION_AGE_SECONDS;
}

/**
 * Server-side gate for every /api/cybersecurity-* route.
 *
 * 1. requireReportAccess(req, "cybersecurity"): 401 without a session, 403
 *    unless the email is in STRICT_REPORTS.cybersecurity (hub admins excluded).
 * 2. The session must carry auth: "entra" and be at most 12 hours old.
 *    Magic-link sessions, pre-claim sessions, and stale Entra sessions get
 *    403 { error: "reauth_microsoft" }.
 *
 * Every call logs one JSON line (CloudWatch /ecs/amu-reporting/web-v3):
 * allowed as { evt: "cyber_access", email, route, method, ts }, refused as
 * { evt: "cyber_access_denied", email | null, route, code, ts } with code
 * unauthenticated, forbidden, or reauth_microsoft.
 */
export function requireCyberAccess(
  req: Request,
  opts: { nowSeconds?: number } = {},
): CyberAccessResult {
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  let route = "";
  try {
    route = new URL(req.url).pathname;
  } catch {
    route = "";
  }
  const ts = new Date(nowSeconds * 1000).toISOString();
  const session = currentSession(req);
  const logDenied = (code: CyberDenyCode) =>
    cyberAccessLog.write(
      JSON.stringify({ evt: "cyber_access_denied", email: session?.email ?? null, route, code, ts }),
    );

  const denied = requireReportAccess(req, "cybersecurity");
  if (denied) {
    logDenied(denied.status === 401 ? "unauthenticated" : "forbidden");
    return { ok: false, response: denied };
  }

  if (!session || !cyberSessionIsFresh(session, nowSeconds)) {
    logDenied(CYBER_REAUTH_ERROR);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: CYBER_REAUTH_ERROR,
          message: "Sign in with Microsoft again to open Cybersecurity.",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  cyberAccessLog.write(
    JSON.stringify({ evt: "cyber_access", email: session.email, route, method: req.method, ts }),
  );
  return { ok: true, email: session.email, session };
}
