import type { NextRequest } from "next/server";
import { canLogin, sessionDecisionAtComplete } from "@/lib/access";
import { EntraSignInError, emailFromEntraCode } from "@/lib/core/entraSession";
import {
  ENTRA_COOKIES,
  MICROSOFT_FAILED_PATH,
  clearEntraCookies,
  entraRedirectUri,
  entraReturnPath,
  readEntraConfig,
  timingSafeEqualString,
} from "@/lib/entra";
import { appendSetCookies, signInAfterVerification } from "@/lib/sign-in-after-verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Relative Location: never trust Host / x-forwarded-host for where we send people. */
function redirect(location: string, setCookies: string[]): Response {
  const res = new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
  appendSetCookies(res, setCookies);
  return res;
}

function fail(reason: string, extra?: Record<string, unknown>): Response {
  // No code, token, state or email in logs.
  console.log(`[entra] callback failed: ${reason}`, extra ?? {});
  return redirect(MICROSOFT_FAILED_PATH, clearEntraCookies());
}

/**
 * Microsoft redirects here with ?code&state. Check state against the cookie,
 * hand the code + PKCE verifier + nonce to core, then treat the email core
 * verified exactly like a redeemed magic link:
 *
 * - Eligibility is canLogin(), the same allowlist the magic link uses. A UPN
 *   that is not on a report list is refused, never mapped to another account.
 * - Academic Affairs and coaching users get the same amu_reporting_mfa_pending
 *   cookie and go to /auth/mfa. MFA is NOT marked satisfied here: core does
 *   not pass Microsoft's `amr` claim, so we cannot tell whether Microsoft
 *   challenged.
 * - Everyone else gets amu_reporting_session (no mfa claim) and returns to
 *   the safe path saved at the start, or "/".
 */
export async function GET(req: NextRequest) {
  const config = readEntraConfig();
  if (!config) return fail("disabled");

  const params = req.nextUrl.searchParams;
  if (params.get("error") !== null) return fail("microsoft_error");

  const state = params.get("state");
  const code = params.get("code");
  const stateCookie = req.cookies.get(ENTRA_COOKIES.state)?.value;
  if (!state || !stateCookie || !timingSafeEqualString(stateCookie, state)) {
    return fail("state");
  }
  if (!code) return fail("missing_code");

  const verifier = req.cookies.get(ENTRA_COOKIES.verifier)?.value;
  const nonce = req.cookies.get(ENTRA_COOKIES.nonce)?.value;
  if (!verifier || !nonce) return fail("missing_cookies");

  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) return fail("auth_not_configured");

  let email: string;
  try {
    email = (
      await emailFromEntraCode({
        coreApiUrl: config.coreApiUrl,
        code,
        codeVerifier: verifier,
        redirectUri: entraRedirectUri(),
        nonce,
      })
    )
      .trim()
      .toLowerCase();
  } catch (e) {
    return fail("core_exchange", { status: e instanceof EntraSignInError ? e.status : null });
  }

  if (!canLogin(email)) return fail("not_permitted");

  const signIn = signInAfterVerification(
    req,
    email,
    secret,
    sessionDecisionAtComplete(email, false),
    // Marks the session (or the mfa_pending token) auth: "entra" with a fresh
    // iat. requireCyberAccess accepts only these sessions.
    "entra",
  );
  const dest =
    signIn.kind === "mfa_pending"
      ? signIn.redirect
      : (entraReturnPath(req.cookies.get(ENTRA_COOKIES.from)?.value) ?? "/");
  console.log("[entra] sign-in verified", { next: signIn.kind });
  return redirect(dest, [...clearEntraCookies(), ...signIn.setCookies]);
}
