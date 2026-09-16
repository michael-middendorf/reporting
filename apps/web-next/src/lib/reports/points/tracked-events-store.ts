/**
 * tracked-events-store.ts — server-only persistence for dashboard-added events.
 *
 * Same read-modify-write / If-Match pattern as flags-store.ts so two reviewers
 * adding events near-simultaneously do not clobber each other.
 */
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { dataBucket, s3 } from "@/lib/s3-proxy";
import {
  emptyTrackedEventsDoc,
  TRACKED_EVENTS_KEY,
  type TrackedEvent,
  type TrackedEventInput,
  type TrackedEventsDoc,
} from "./tracked-events";

type Loaded = { doc: TrackedEventsDoc; etag: string | null };

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

async function load(): Promise<Loaded> {
  const bucket = dataBucket();
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: TRACKED_EVENTS_KEY }));
    if (!out.Body) return { doc: emptyTrackedEventsDoc(), etag: out.ETag || null };
    const bytes = await out.Body.transformToByteArray();
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf-8")) as Partial<TrackedEventsDoc>;
    const doc: TrackedEventsDoc = {
      version: 1,
      events: parsed && typeof parsed.events === "object" && parsed.events ? parsed.events : {},
    };
    return { doc, etag: out.ETag || null };
  } catch (e) {
    if (isNotFound(e)) return { doc: emptyTrackedEventsDoc(), etag: null };
    throw e;
  }
}

async function put(doc: TrackedEventsDoc, etag: string | null): Promise<void> {
  const bucket = dataBucket();
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: TRACKED_EVENTS_KEY,
      Body: JSON.stringify(doc),
      ContentType: "application/json; charset=utf-8",
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
    }),
  );
}

async function mutateWithRetry(
  mutate: (events: Record<string, TrackedEvent>) => void,
): Promise<Record<string, TrackedEvent>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { doc, etag } = await load();
    mutate(doc.events);
    try {
      await put(doc, etag);
      return doc.events;
    } catch (e) {
      lastErr = e;
      if (!isPreconditionFailed(e)) throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Could not persist event after concurrent retries");
}

export async function readTrackedEvents(): Promise<TrackedEvent[]> {
  const { doc } = await load();
  return Object.values(doc.events).sort((a, b) => {
    const day = String(b.day || "").localeCompare(String(a.day || ""));
    if (day) return day;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

export async function upsertTrackedEvent(
  input: TrackedEventInput,
  reviewerEmail: string,
  nowIso: string,
): Promise<TrackedEvent> {
  const id = String(input.id || crypto.randomUUID());
  let saved: TrackedEvent | null = null;
  await mutateWithRetry((events) => {
    const existing = events[id];
    const event: TrackedEvent = existing
      ? {
          ...existing,
          owner: input.owner,
          day: input.day,
          eventType: input.eventType,
          name: input.name != null ? String(input.name) : existing.name,
          hours: input.hours,
          updatedBy: reviewerEmail,
          updatedAt: nowIso,
        }
      : {
          id,
          owner: input.owner,
          day: input.day,
          eventType: input.eventType,
          name: input.name != null ? String(input.name) : "",
          hours: input.hours,
          createdBy: reviewerEmail,
          createdAt: nowIso,
        };
    events[id] = event;
    saved = event;
  });
  return saved!;
}

export async function removeTrackedEvent(id: string): Promise<void> {
  const key = String(id);
  await mutateWithRetry((events) => {
    delete events[key];
  });
}
