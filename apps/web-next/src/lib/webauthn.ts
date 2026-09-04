import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { normalizeEmail } from "@/lib/auth";

const LONG_TTL_SECONDS = 10 * 365 * 86400;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const OPTIONS_COOLDOWN_SECONDS = 3;
const MAX_FAILS = 8;
const LOCK_SECONDS = 15 * 60;

const region = process.env.AWS_REGION || "us-east-2";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function userKey(email: string) {
  return `webauthn#user#${normalizeEmail(email)}`;
}

function credKey(credentialId: string) {
  return `webauthn#cred#${credentialId}`;
}

function chalKey(email: string) {
  return `webauthn#chal#${normalizeEmail(email)}`;
}

function lockKey(email: string) {
  return `webauthn#lock#${normalizeEmail(email)}`;
}

export type WebauthnRp = {
  rpName: string;
  rpID: string;
  origin: string;
};

export function webauthnRelyingParty(appBaseUrl = process.env.APP_BASE_URL): WebauthnRp {
  const raw = (appBaseUrl || "").trim();
  if (!raw) throw new Error("APP_BASE_URL is not configured");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("APP_BASE_URL is invalid");
  }
  if (!url.hostname) throw new Error("APP_BASE_URL is invalid");
  return {
    rpName: "AMU Reporting",
    rpID: url.hostname,
    origin: url.origin,
  };
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return isoBase64URL.fromBuffer(new Uint8Array(bytes));
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!isoBase64URL.isBase64URL(value)) throw new Error("expected base64url");
  return new Uint8Array(isoBase64URL.toBuffer(value));
}

export type StoredPasskey = {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  deviceName: string;
  createdAt: number;
};

export type PasskeyListItem = {
  id: string;
  deviceName: string;
  createdAt: number;
};

type UserItem = {
  sessionId: string;
  type: string;
  email: string;
  credentialIds?: string[];
  expiresAt: number;
};

async function getItem(sessionId: string) {
  const response = await ddb.send(
    new GetCommand({
      TableName: required("ASPIREDU_SESSION_TABLE"),
      Key: { sessionId },
      ConsistentRead: true,
    }),
  );
  return response.Item;
}

async function putItem(item: Record<string, unknown>, condition?: string) {
  await ddb.send(
    new PutCommand({
      TableName: required("ASPIREDU_SESSION_TABLE"),
      Item: item,
      ...(condition ? { ConditionExpression: condition } : {}),
    }),
  );
}

async function deleteItem(sessionId: string) {
  await ddb.send(
    new DeleteCommand({
      TableName: required("ASPIREDU_SESSION_TABLE"),
      Key: { sessionId },
    }),
  );
}

async function loadUser(email: string): Promise<UserItem | null> {
  const item = await getItem(userKey(email));
  if (!item || item.type !== "WEBAUTHN_USER") return null;
  return item as UserItem;
}

async function loadCredential(credentialId: string): Promise<StoredPasskey | null> {
  if (!isoBase64URL.isBase64URL(credentialId)) return null;
  const item = await getItem(credKey(credentialId));
  if (!item || item.type !== "WEBAUTHN_CRED") return null;
  return {
    credentialId: String(item.credentialId || credentialId),
    publicKey: String(item.publicKey || ""),
    counter: Number(item.counter || 0),
    transports: Array.isArray(item.transports) ? (item.transports as AuthenticatorTransportFuture[]) : [],
    deviceName: String(item.deviceName || "Passkey"),
    createdAt: Number(item.createdAt || 0),
  };
}

export async function listPasskeys(email: string): Promise<PasskeyListItem[]> {
  const user = await loadUser(email);
  const ids = user?.credentialIds || [];
  const out: PasskeyListItem[] = [];
  for (const id of ids) {
    const cred = await loadCredential(id);
    if (cred) out.push({ id: cred.credentialId, deviceName: cred.deviceName, createdAt: cred.createdAt });
  }
  return out;
}

export async function userHasPasskey(email: string): Promise<boolean> {
  const user = await loadUser(email);
  return (user?.credentialIds || []).length > 0;
}

async function saveChallenge(email: string, challenge: string, purpose: "register" | "authenticate") {
  const normalized = normalizeEmail(email);
  const now = nowSec();
  await putItem({
    sessionId: chalKey(normalized),
    type: "WEBAUTHN_CHALLENGE",
    email: normalized,
    challenge,
    purpose,
    expiresAt: now + CHALLENGE_TTL_SECONDS,
  });
}

async function takeChallenge(email: string, purpose: "register" | "authenticate"): Promise<string> {
  const normalized = normalizeEmail(email);
  const response = await ddb.send(
    new DeleteCommand({
      TableName: required("ASPIREDU_SESSION_TABLE"),
      Key: { sessionId: chalKey(normalized) },
      ReturnValues: "ALL_OLD",
    }),
  );
  const item = response.Attributes;
  const now = nowSec();
  if (
    !item ||
    item.type !== "WEBAUTHN_CHALLENGE" ||
    item.purpose !== purpose ||
    Number(item.expiresAt || 0) <= now ||
    typeof item.challenge !== "string"
  ) {
    throw new Error("Passkey challenge is invalid or expired");
  }
  return item.challenge;
}

async function assertNotLocked(email: string) {
  const item = await getItem(lockKey(email));
  const now = nowSec();
  if (Number(item?.lockedUntil || 0) > now) {
    throw new Error("Too many attempts. Try again in a few minutes.");
  }
}

async function touchOptionsCooldown(email: string) {
  const normalized = normalizeEmail(email);
  const item = await getItem(lockKey(normalized));
  const now = nowSec();
  if (Number(item?.lockedUntil || 0) > now) {
    throw new Error("Too many attempts. Try again in a few minutes.");
  }
  if (Number(item?.lastOptionsAt || 0) + OPTIONS_COOLDOWN_SECONDS > now) {
    throw new Error("Too many attempts. Try again in a few minutes.");
  }
  await putItem({
    sessionId: lockKey(normalized),
    type: "WEBAUTHN_LOCK",
    email: normalized,
    fails: Number(item?.fails || 0),
    lockedUntil: Number(item?.lockedUntil || 0),
    lastOptionsAt: now,
    expiresAt: now + LOCK_SECONDS * 4,
  });
}

async function recordAuthFail(email: string) {
  const normalized = normalizeEmail(email);
  const item = await getItem(lockKey(normalized));
  const now = nowSec();
  const fails = Number(item?.fails || 0) + 1;
  const lockedUntil = fails >= MAX_FAILS ? now + LOCK_SECONDS : 0;
  await putItem({
    sessionId: lockKey(normalized),
    type: "WEBAUTHN_LOCK",
    email: normalized,
    fails,
    lockedUntil,
    lastOptionsAt: Number(item?.lastOptionsAt || 0),
    expiresAt: now + LOCK_SECONDS * 4,
  });
}

async function clearAuthFails(email: string) {
  await deleteItem(lockKey(email));
}

export async function registrationOptionsFor(email: string) {
  const normalized = normalizeEmail(email);
  const rp = webauthnRelyingParty();
  const existing = await listPasskeys(normalized);
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: normalized,
    userDisplayName: normalized,
    userID: new TextEncoder().encode(normalized),
    attestationType: "none",
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.id,
      type: "public-key" as const,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  await saveChallenge(normalized, options.challenge, "register");
  return options;
}

export async function verifyRegistrationFor(
  email: string,
  response: RegistrationResponseJSON,
  deviceName: string,
) {
  const normalized = normalizeEmail(email);
  const rp = webauthnRelyingParty();
  const expectedChallenge = await takeChallenge(normalized, "register");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Could not verify that passkey");
  }
  const credential = verification.registrationInfo.credential;
  const credentialId = credential.id;
  if (!isoBase64URL.isBase64URL(credentialId)) {
    throw new Error("Passkey id was not base64url");
  }
  const publicKey = bytesToBase64Url(credential.publicKey);
  const now = nowSec();
  const transports = (credential.transports || response.response.transports || []) as AuthenticatorTransportFuture[];
  await putItem(
    {
      sessionId: credKey(credentialId),
      type: "WEBAUTHN_CRED",
      email: normalized,
      credentialId,
      publicKey,
      counter: credential.counter,
      transports,
      deviceName: deviceName.trim() || "Passkey",
      createdAt: now,
      expiresAt: now + LONG_TTL_SECONDS,
    },
    "attribute_not_exists(sessionId)",
  );
  const user = await loadUser(normalized);
  const credentialIds = [...(user?.credentialIds || []), credentialId];
  await putItem({
    sessionId: userKey(normalized),
    type: "WEBAUTHN_USER",
    email: normalized,
    credentialIds,
    expiresAt: now + LONG_TTL_SECONDS,
  });
  return { credentialId };
}

export async function authenticationOptionsFor(email: string) {
  const normalized = normalizeEmail(email);
  await touchOptionsCooldown(normalized);
  const existing = await listPasskeys(normalized);
  if (existing.length === 0) throw new Error("No passkey on this account");
  const rp = webauthnRelyingParty();
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required",
    allowCredentials: existing.map((passkey) => ({
      id: passkey.id,
      type: "public-key" as const,
    })),
  });
  await saveChallenge(normalized, options.challenge, "authenticate");
  return options;
}

export async function verifyAuthenticationFor(email: string, response: AuthenticationResponseJSON) {
  const normalized = normalizeEmail(email);
  await assertNotLocked(normalized);
  const rp = webauthnRelyingParty();
  let expectedChallenge: string;
  try {
    expectedChallenge = await takeChallenge(normalized, "authenticate");
  } catch (error) {
    await recordAuthFail(normalized);
    throw error;
  }
  const credentialId = String(response.id || "");
  const stored = await loadCredential(credentialId);
  if (!stored || !stored.publicKey) {
    await recordAuthFail(normalized);
    throw new Error("Could not verify that passkey");
  }
  const credUser = await getItem(credKey(credentialId));
  if (normalizeEmail(String(credUser?.email || "")) !== normalized) {
    await recordAuthFail(normalized);
    throw new Error("Could not verify that passkey");
  }
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(base64UrlToBytes(stored.publicKey)),
        counter: stored.counter,
        transports: stored.transports,
      },
    });
  } catch (error) {
    await recordAuthFail(normalized);
    throw error;
  }
  if (!verification.verified || !verification.authenticationInfo) {
    await recordAuthFail(normalized);
    throw new Error("Could not verify that passkey");
  }
  await ddb.send(
    new UpdateCommand({
      TableName: required("ASPIREDU_SESSION_TABLE"),
      Key: { sessionId: credKey(stored.credentialId) },
      UpdateExpression: "SET #counter = :counter",
      ExpressionAttributeNames: { "#counter": "counter" },
      ExpressionAttributeValues: { ":counter": verification.authenticationInfo.newCounter },
    }),
  );
  await clearAuthFails(normalized);
  return { email: normalized, credentialId: stored.credentialId };
}

export async function deletePasskey(email: string, credentialId: string) {
  const normalized = normalizeEmail(email);
  if (!isoBase64URL.isBase64URL(credentialId)) throw new Error("Invalid passkey id");
  const item = await getItem(credKey(credentialId));
  if (!item || item.type !== "WEBAUTHN_CRED" || normalizeEmail(String(item.email || "")) !== normalized) {
    throw new Error("Passkey not found");
  }
  await deleteItem(credKey(credentialId));
  const user = await loadUser(normalized);
  const credentialIds = (user?.credentialIds || []).filter((id) => id !== credentialId);
  const now = nowSec();
  await putItem({
    sessionId: userKey(normalized),
    type: "WEBAUTHN_USER",
    email: normalized,
    credentialIds,
    expiresAt: now + LONG_TTL_SECONDS,
  });
}
