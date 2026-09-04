import { GetObjectCommand } from "@aws-sdk/client-s3";
import { gunzipSync } from "zlib";
import { dataBucket, s3 } from "@/lib/s3-proxy";

export type LatestPointer = {
  schema_version?: number;
  source: string;
  dataset: string;
  dt: string;
  prefix: string;
  pulled_at?: string;
  record_count?: number;
};

async function getObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw Object.assign(new Error("Empty object"), { name: "NoSuchKey" });
  return out.Body.transformToByteArray();
}

export async function readJson<T = unknown>(key: string): Promise<T> {
  const bucket = dataBucket();
  const bytes = await getObjectBytes(bucket, key);
  return JSON.parse(Buffer.from(bytes).toString("utf-8")) as T;
}

export function isMissingSource(error: unknown): boolean {
  const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = err?.name || err?.Code || "";
  const http = err?.$metadata?.httpStatusCode;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "NoSuchKey" ||
    code === "NotFound" ||
    http === 404 ||
    /NoSuchKey|NotFound/i.test(message)
  );
}

export async function loadLatestPointer(source: string, dataset: string): Promise<LatestPointer> {
  return readJson<LatestPointer>(`sources/${source}/${dataset}/_latest.json`);
}

/** Load JSONL rows from sources/{source}/{dataset}/_latest. */
export async function loadSourceRows<T = Record<string, unknown>>(
  source: string,
  dataset: string,
): Promise<{ rows: T[]; latest: LatestPointer }> {
  const bucket = dataBucket();
  const latest = await loadLatestPointer(source, dataset);
  const prefix = latest.prefix || `sources/${source}/${dataset}/dt=${latest.dt}`;
  const gz = await getObjectBytes(bucket, `${prefix}/data.jsonl.gz`);
  const text = gunzipSync(Buffer.from(gz)).toString("utf-8");
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as T);
  }
  return { rows, latest };
}

/** Load a dataset, or null when `_latest` / the JSONL object is not in the bucket yet. */
export async function loadSourceRowsOptional<T = Record<string, unknown>>(
  source: string,
  dataset: string,
): Promise<{ rows: T[]; latest: LatestPointer } | null> {
  if (!dataBucket()) return null;
  try {
    return await loadSourceRows<T>(source, dataset);
  } catch (error) {
    if (isMissingSource(error)) return null;
    throw error;
  }
}
