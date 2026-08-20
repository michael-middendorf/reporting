/** S3 helpers for the housing dashboard cache (residents, uploads, staff state). */

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { dataBucket, s3 } from "@/lib/s3-proxy";

const region = process.env.AWS_REGION || "us-east-2";

export const HOUSING_CACHE_PREFIX = "cache/housing";
export const RESIDENTS_KEY = `${HOUSING_CACHE_PREFIX}/residents.json`;
export const STUDY_ABROAD_KEY = `${HOUSING_CACHE_PREFIX}/study_abroad.json`;
export const VERIFICATION_STATE_KEY = `${HOUSING_CACHE_PREFIX}/verification_state.json`;
export const ROOM_VERIFICATION_STATE_KEY = `${HOUSING_CACHE_PREFIX}/room_verification_state.json`;
export const UPLOAD_PREFIX = `${HOUSING_CACHE_PREFIX}/uploads`;

export const UPLOAD_KINDS: Record<string, string> = {
  registration: "registration.xlsx",
  "early-arrivals": "early_arrivals.xlsx",
};

export const HALL_CHARTS = new Set([
  "goret.chart.json",
  "jpii.chart.json",
  "sebast.chart.json",
  "stjose.chart.json",
  "teresa.chart.json",
  "xavier.chart.json",
]);

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = err?.name || err?.Code || "";
  return code === "NoSuchKey" || code === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

export async function readJsonObject<T>(key: string): Promise<T | null> {
  const bucket = dataBucket();
  if (!bucket) throw new Error("DATA_BUCKET is not configured");
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!out.Body) return null;
    const text = await out.Body.transformToString();
    return JSON.parse(text) as T;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function putJsonObject(key: string, value: unknown): Promise<void> {
  const bucket = dataBucket();
  if (!bucket) throw new Error("DATA_BUCKET is not configured");
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
    }),
  );
}

export async function putBytes(key: string, body: Buffer, contentType: string): Promise<void> {
  const bucket = dataBucket();
  if (!bucket) throw new Error("DATA_BUCKET is not configured");
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "no-store",
    }),
  );
}

export type ResidentsPayload = {
  generated?: string | null;
  count?: number;
  source?: string;
  session?: string;
  cached_at?: string;
  withdrawn?: Record<string, number>;
  verification_candidates?: unknown[];
  residents?: unknown[];
  error?: string;
};

export async function readResidents(): Promise<ResidentsPayload | null> {
  return readJsonObject<ResidentsPayload>(RESIDENTS_KEY);
}

export type VerificationState = { edits: Record<string, unknown>; notes: unknown[] };
export type RoomVerificationState = { edits: Record<string, unknown> };

export async function invokeHousingRebuild(): Promise<void> {
  const fn = (process.env.HOUSING_PROCESS_FUNCTION || "").trim();
  if (!fn) {
    console.warn("HOUSING_PROCESS_FUNCTION is not set; upload saved but rebuild waits for HousingRefresh");
    return;
  }
  await new LambdaClient({ region }).send(
    new InvokeCommand({
      FunctionName: fn,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify({ reason: "upload" })),
    }),
  );
}
