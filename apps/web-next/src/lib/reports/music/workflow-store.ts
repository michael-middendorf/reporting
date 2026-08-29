import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { dataBucket, s3 } from "@/lib/s3-proxy";
import {
  defaultWorkflow,
  emptyWorkflowDoc,
  isAuditionReview,
  isProgramAcceptance,
  WORKFLOW_KEY,
  type WorkflowDoc,
  type WorkflowInput,
  type WorkflowState,
} from "./types";

type Loaded = { doc: WorkflowDoc; etag: string | null };

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
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: WORKFLOW_KEY }));
    if (!out.Body) return { doc: emptyWorkflowDoc(), etag: out.ETag || null };
    const bytes = await out.Body.transformToByteArray();
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf-8")) as Partial<WorkflowDoc>;
    const doc: WorkflowDoc = {
      version: 1,
      rows: parsed && typeof parsed.rows === "object" && parsed.rows ? parsed.rows : {},
    };
    return { doc, etag: out.ETag || null };
  } catch (e) {
    if (isNotFound(e)) return { doc: emptyWorkflowDoc(), etag: null };
    throw e;
  }
}

async function put(doc: WorkflowDoc, etag: string | null): Promise<void> {
  const bucket = dataBucket();
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: WORKFLOW_KEY,
      Body: JSON.stringify(doc),
      ContentType: "application/json; charset=utf-8",
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
    }),
  );
}

async function mutateWithRetry(
  mutate: (rows: Record<string, WorkflowState>) => void,
): Promise<Record<string, WorkflowState>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { doc, etag } = await load();
    mutate(doc.rows);
    try {
      await put(doc, etag);
      return doc.rows;
    } catch (e) {
      lastErr = e;
      if (!isPreconditionFailed(e)) throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Could not persist music workflow after concurrent retries");
}

export async function readWorkflow(): Promise<Record<string, WorkflowState>> {
  const { doc } = await load();
  return doc.rows;
}

export async function upsertWorkflow(
  input: WorkflowInput,
  actorEmail: string,
  nowIso: string,
): Promise<WorkflowState> {
  const applicationId = String(input.applicationId || "").trim();
  if (!applicationId) throw new Error("applicationId is required");
  const key = applicationId.toLowerCase();
  let saved: WorkflowState | null = null;
  await mutateWithRetry((rows) => {
    const existing = rows[key] || defaultWorkflow();
    const next: WorkflowState = {
      ...existing,
      updatedBy: actorEmail,
      updatedAt: nowIso,
    };
    if (input.auditionReview != null) {
      if (!isAuditionReview(input.auditionReview)) {
        throw new Error("auditionReview must be none, in_review, or complete");
      }
      next.auditionReview = input.auditionReview;
    }
    if (input.programAcceptance != null) {
      if (!isProgramAcceptance(input.programAcceptance)) {
        throw new Error("programAcceptance must be pending, accepted, or denied");
      }
      next.programAcceptance = input.programAcceptance;
    }
    if (input.musicAward != null) {
      const award = String(input.musicAward);
      if (award.length > 200) throw new Error("musicAward too long");
      next.musicAward = award;
    }
    if (input.loiSigned != null) next.loiSigned = Boolean(input.loiSigned);
    rows[key] = next;
    saved = next;
  });
  return saved!;
}
