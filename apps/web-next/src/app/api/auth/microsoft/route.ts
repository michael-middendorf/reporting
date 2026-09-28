import type { NextRequest } from "next/server";
import {
  ENTRA_COOKIES,
  buildEntraAuthorizeUrl,
  createPkceVerifier,
  createUrlSafeToken,
  entraCookie,
  entraRedirectUri,
  entraReturnPath,
  pkceChallenge,
  readEntraConfig,
} from "@/lib/entra";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start "Sign in with Microsoft": set the one-time state, PKCE verifier,
 * nonce and return path (HttpOnly, Secure, SameSite=Lax, Path=/api/auth/microsoft,
 * 10 min), then 302 to Microsoft. Reached by a plain GET link on the login
 * form. Middleware never redirects /api/*.
 */
export async function GET(req: NextRequest) {
  const config = readEntraConfig();
  if (!config) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/login", "Cache-Control": "no-store" },
    });
  }

  const from = entraReturnPath(req.nextUrl.searchParams.get("next"));
  const state = createUrlSafeToken();
  const nonce = createUrlSafeToken();
  const verifier = createPkceVerifier();

  const authorize = buildEntraAuthorizeUrl({
    tenantId: config.tenantId,
    clientId: config.clientId,
    redirectUri: entraRedirectUri(),
    state,
    nonce,
    codeChallenge: pkceChallenge(verifier),
  });

  const res = new Response(null, {
    status: 302,
    headers: { Location: authorize, "Cache-Control": "no-store" },
  });
  res.headers.append("Set-Cookie", entraCookie(ENTRA_COOKIES.state, state));
  res.headers.append("Set-Cookie", entraCookie(ENTRA_COOKIES.verifier, verifier));
  res.headers.append("Set-Cookie", entraCookie(ENTRA_COOKIES.nonce, nonce));
  res.headers.append(
    "Set-Cookie",
    from ? entraCookie(ENTRA_COOKIES.from, from) : entraCookie(ENTRA_COOKIES.from, "", 0),
  );
  return res;
}
