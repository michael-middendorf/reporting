import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { normalizeEmail } from "@/lib/auth";

export const ASPIREDU_MFA_COOKIE = "amu_aspiredu_mfa";
const AUTHORIZED = new Set([
  "cole.j.cantu@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
  "michael.t.middendorf@avemaria.edu",
]);

const region = process.env.AWS_REGION || "us-east-2";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

// The AspirEDU OAuth callback must match the host the user is actually on, so
// reporting.avemaria.edu and the CloudFront hostname both work during cutover.
// Same header idiom as api/auth/request. Unlike a magic link, a redirect_uri is
// attacker-influencable via Host, so we only honour hosts that infra has put on
// ASPIREDU_CALLBACK_URLS; anything else falls back to the configured default.
function allowedCallbackUrls() {
  const raw = process.env.ASPIREDU_CALLBACK_URLS || process.env.ASPIREDU_CALLBACK_URL || "";
  return raw.split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean);
}

export function aspireduCallbackUrlFor(req: Request) {
  const fallback = required("ASPIREDU_CALLBACK_URL");
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim();
  if (!host) return fallback;
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const candidate = `${proto}://${host}/aspiredu/api/auth/callback`;
  return allowedCallbackUrls().includes(candidate) ? candidate : fallback;
}

function cookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function base64url(value: Buffer) {
  return value.toString("base64url");
}

function verifier() {
  return base64url(randomBytes(48));
}

function challenge(value: string) {
  return base64url(createHash("sha256").update(value, "ascii").digest());
}

function verifierForIdToken() {
  return CognitoJwtVerifier.create({
    userPoolId: required("ASPIREDU_USER_POOL_ID"),
    tokenUse: "id",
    clientId: required("ASPIREDU_USER_POOL_CLIENT_ID"),
  });
}

export function isAspireduStudentViewer(email: string) {
  return AUTHORIZED.has(normalizeEmail(email));
}

export async function beginAspireduMfa(email: string, redirectUri: string) {
  const normalized = normalizeEmail(email);
  if (!isAspireduStudentViewer(normalized)) throw new Error("not authorized for student-level AspireDU data");
  const state = base64url(randomBytes(32));
  const codeVerifier = verifier();
  const now = Math.floor(Date.now() / 1000);
  await ddb.send(new PutCommand({
    TableName: required("ASPIREDU_SESSION_TABLE"),
    Item: {
      sessionId: `pkce#${state}`,
      type: "PKCE",
      email: normalized,
      codeVerifier,
      redirectUri,
      expiresAt: now + 10 * 60,
    },
    ConditionExpression: "attribute_not_exists(sessionId)",
  }));
  const url = new URL("/oauth2/authorize", required("ASPIREDU_COGNITO_DOMAIN"));
  url.searchParams.set("client_id", required("ASPIREDU_USER_POOL_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("login_hint", normalized);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

async function tokenRequest(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(new URL("/oauth2/token", required("ASPIREDU_COGNITO_DOMAIN")), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Cognito token exchange failed with status ${response.status}`);
  return response.json() as Promise<TokenResponse>;
}

export async function completeAspireduMfa(code: string, state: string) {
  const transaction = await ddb.send(new DeleteCommand({
    TableName: required("ASPIREDU_SESSION_TABLE"),
    Key: { sessionId: `pkce#${state}` },
    ReturnValues: "ALL_OLD",
  }));
  const item = transaction.Attributes;
  const now = Math.floor(Date.now() / 1000);
  if (!item || item.type !== "PKCE" || item.expiresAt <= now || !item.codeVerifier || !item.email) {
    throw new Error("MFA transaction is invalid or expired");
  }
  const tokens = await tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: required("ASPIREDU_USER_POOL_CLIENT_ID"),
    code,
    // OAuth requires the token exchange to echo the authorize redirect_uri
    // verbatim. Fall back for PKCE rows written before this field existed.
    redirect_uri: String(item.redirectUri || required("ASPIREDU_CALLBACK_URL")),
    code_verifier: item.codeVerifier,
  }));
  const claims = await verifierForIdToken().verify(tokens.id_token);
  const email = normalizeEmail(String(claims.email || ""));
  if (claims.email_verified !== true || !isAspireduStudentViewer(email) || email !== item.email) {
    throw new Error("Cognito identity does not match the authorized reporting user");
  }
  const sessionId = base64url(randomBytes(32));
  await ddb.send(new PutCommand({
    TableName: required("ASPIREDU_SESSION_TABLE"),
    Item: {
      sessionId,
      type: "SESSION",
      email,
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: now + tokens.expires_in,
      expiresAt: now + 8 * 60 * 60,
    },
    ConditionExpression: "attribute_not_exists(sessionId)",
  }));
  return { sessionId, email };
}

async function refreshSession(item: Record<string, unknown>) {
  if (!item.refreshToken || typeof item.refreshToken !== "string") return null;
  const now = Math.floor(Date.now() / 1000);
  const tokens = await tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: required("ASPIREDU_USER_POOL_CLIENT_ID"),
    refresh_token: item.refreshToken,
  }));
  const claims = await verifierForIdToken().verify(tokens.id_token);
  const email = normalizeEmail(String(claims.email || ""));
  if (claims.email_verified !== true || email !== item.email || !isAspireduStudentViewer(email)) return null;
  await ddb.send(new UpdateCommand({
    TableName: required("ASPIREDU_SESSION_TABLE"),
    Key: { sessionId: item.sessionId },
    UpdateExpression: "SET accessToken = :access, idToken = :id, refreshToken = :refresh, tokenExpiresAt = :tokenExpiresAt",
    ExpressionAttributeValues: {
      ":access": tokens.access_token,
      ":id": tokens.id_token,
      ":refresh": tokens.refresh_token || item.refreshToken,
      ":tokenExpiresAt": now + tokens.expires_in,
    },
  }));
  return { ...item, email, tokenExpiresAt: now + tokens.expires_in };
}

export async function getAspireduMfaSession(req: Request, expectedEmail?: string) {
  const sessionId = cookie(req, ASPIREDU_MFA_COOKIE);
  if (!sessionId) return null;
  const response = await ddb.send(new GetCommand({
    TableName: required("ASPIREDU_SESSION_TABLE"),
    Key: { sessionId },
    ConsistentRead: true,
  }));
  let item = response.Item;
  const now = Math.floor(Date.now() / 1000);
  if (!item || item.type !== "SESSION" || item.expiresAt <= now) return null;
  const email = normalizeEmail(String(item.email || ""));
  if (!isAspireduStudentViewer(email) || (expectedEmail && email !== normalizeEmail(expectedEmail))) return null;
  if (Number(item.tokenExpiresAt || 0) <= now + 60) {
    item = await refreshSession(item) || undefined;
    if (!item) return null;
  }
  return { sessionId, email };
}

export async function endAspireduMfa(req: Request) {
  const sessionId = cookie(req, ASPIREDU_MFA_COOKIE);
  if (!sessionId) return;
  const response = await ddb.send(new DeleteCommand({
    TableName: required("ASPIREDU_SESSION_TABLE"),
    Key: { sessionId },
    ReturnValues: "ALL_OLD",
  }));
  const refreshToken = response.Attributes?.refreshToken;
  if (typeof refreshToken === "string") {
    await fetch(new URL("/oauth2/revoke", required("ASPIREDU_COGNITO_DOMAIN")), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken, client_id: required("ASPIREDU_USER_POOL_CLIENT_ID") }),
      cache: "no-store",
    }).catch(() => undefined);
  }
}

export function aspireduSessionCookie(sessionId: string) {
  return `${ASPIREDU_MFA_COOKIE}=${encodeURIComponent(sessionId)}; Path=/aspiredu; Max-Age=${8 * 60 * 60}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAspireduSessionCookie() {
  return `${ASPIREDU_MFA_COOKIE}=; Path=/aspiredu; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

export const aspireduPrivateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
