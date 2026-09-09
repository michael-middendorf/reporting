/**
 * flags-store.ts — server-only persistence for Points count/remove overrides.
 *
 * Stores the whole flag set as ONE JSON object at FLAGS_KEY in the ReportData
 * bucket. Reads/writes go through the same S3 client the read proxy uses.
 *
 * Concurrency: two reviewers (Regina, Cole) could write near-simultaneously, so
 * writes are read-modify-write guarded by an S3 conditional put (If-Match on the
 * object ETag, or If-None-Match:* when creating). On a 412 PreconditionFailed we
 * re-read and retry a few times — last writer no longer clobbers the other's
 * concurrent override.
 */
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { dataBucket, s3 } from "@/lib/s3-proxy";
import {
  emptyFlagsDoc,
  FLAGS_KEY,
  type FlagInput,
  type FlagsDoc,
  type ReviewFlag,
} from "@/lib/reports/points/flags";

type Loaded = { doc: FlagsDoc; etag: string | null };

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = err?.name || err?.Code || "";
  return code === "NoSuchKey" || code === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(e: unknown): boolean {
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = err?.name || err?.Code || "";
  return code === "PreconditionFailed" || err?.$metadata?.httpStatusCode === 412;
}

/** Read the current flag document + its ETag (null if it doesn't exist yet). */
async function load(): Promise<Loaded> {
  const bucket = dataBucket();
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: FLAGS_KEY }));
    if (!out.Body) return { doc: emptyFlagsDoc(), etag: out.ETag || null };
    const bytes = await out.Body.transformToByteArray();
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf-8")) as Partial<FlagsDoc>;
    const doc: FlagsDoc = {
      version: 1,
      flags: parsed && typeof parsed.flags === "object" && parsed.flags ? parsed.flags : {},
    };
    return { doc, etag: out.ETag || null };
  } catch (e) {
    if (isNotFound(e)) return { doc: emptyFlagsDoc(), etag: null };
    throw e;
  }
}

async function put(doc: FlagsDoc, etag: string | null): Promise<void> {
  const bucket = dataBucket();
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: FLAGS_KEY,
      Body: JSON.stringify(doc),
      ContentType: "application/json; charset=utf-8",
      // Optimistic-concurrency guard: only write if the object is unchanged
      // (or, when creating, only if it still doesn't exist).
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
    }),
  );
}

/** Public read: the shared override map (row id -> flag). */
export async function readFlags(): Promise<Record<string, ReviewFlag>> {
  const { doc } = await load();
  return doc.flags;
}

/**
 * Apply a mutation to the flag document with conditional-write retries.
 * `mutate` receives the current flags map and mutates it in place.
 */
async function mutateWithRetry(
  mutate: (flags: Record<string, ReviewFlag>) => void,
): Promise<Record<string, ReviewFlag>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { doc, etag } = await load();
    mutate(doc.flags);
    try {
      await put(doc, etag);
      return doc.flags;
    } catch (e) {
      lastErr = e;
      if (!isPreconditionFailed(e)) throw e;
      // Someone else wrote between our read and write — loop re-reads and reapplies.
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Could not persist count/remove after concurrent retries");
}

/** Create or update a flag. Server stamps identity + timestamps. */
export async function upsertFlag(
  input: FlagInput,
  reviewerEmail: string,
  nowIso: string,
): Promise<ReviewFlag> {
  const noteId = String(input.noteId);
  let saved: ReviewFlag | null = null;
  await mutateWithRetry((flags) => {
    const existing = flags[noteId];
    const flag: ReviewFlag = existing
      ? {
          ...existing,
          // allow editing the human fields + status on update
          reason: input.reason ?? existing.reason,
          status: input.status ?? existing.status,
          updatedBy: reviewerEmail,
          updatedAt: nowIso,
        }
      : {
          noteId,
          contactId: input.contactId ?? null,
          contactName: input.contactName ?? null,
          owner: input.owner ?? null,
          day: input.day ?? null,
          type: input.type ?? null,
          label: input.label ?? null,
          points: input.points ?? null,
          reason: input.reason ?? "",
          status: input.status ?? "open",
          flaggedBy: reviewerEmail,
          flaggedAt: nowIso,
        };
    flags[noteId] = flag;
    saved = flag;
  });
  return saved!;
}

/** Remove a flag entirely (un-flag). */
export async function removeFlag(noteId: string): Promise<void> {
  const id = String(noteId);
  await mutateWithRetry((flags) => {
    delete flags[id];
  });
}
