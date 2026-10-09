/** Read the published census archive. Student workbooks stay off git. */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataBucket, s3 } from "@/lib/s3-proxy";
import { readJsonObject } from "../housing/store";
import {
  ARCHIVE_MANIFEST_KEY,
  archiveFileKey,
  archiveSheetKey,
  isArchiveId,
  type ArchiveFile,
  type ArchiveManifest,
  type ArchiveSheet,
} from "./archive";

function localDir(): string | null {
  const dir = (process.env.CENSUS_ARCHIVE_DIR || "").trim();
  return dir || null;
}

export async function loadArchiveManifest(): Promise<ArchiveManifest | null> {
  const dir = localDir();
  if (dir) {
    const path = join(dir, "manifest.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as ArchiveManifest;
  }
  return readJsonObject<ArchiveManifest>(ARCHIVE_MANIFEST_KEY);
}

export function findArchiveFile(manifest: ArchiveManifest, id: string): ArchiveFile | null {
  if (!isArchiveId(id)) return null;
  return manifest.files.find((file) => file.id === id) ?? null;
}

export async function loadArchiveSheet(id: string, index: number): Promise<ArchiveSheet | null> {
  const dir = localDir();
  if (dir) {
    const path = join(dir, "sheets", id, `${index}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as ArchiveSheet;
  }
  return readJsonObject<ArchiveSheet>(archiveSheetKey(id, index));
}

export async function readArchiveFile(id: string): Promise<Uint8Array | null> {
  const dir = localDir();
  if (dir) {
    const path = join(dir, "files", id);
    if (!existsSync(path)) return null;
    return new Uint8Array(readFileSync(path));
  }
  const bucket = dataBucket();
  if (!bucket) throw new Error("DATA_BUCKET is not configured");
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: archiveFileKey(id) }));
    if (!out.Body) return null;
    return await out.Body.transformToByteArray();
  } catch (e) {
    const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    const code = err.name || err.Code || "";
    if (code === "NoSuchKey" || code === "NotFound" || err.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}
