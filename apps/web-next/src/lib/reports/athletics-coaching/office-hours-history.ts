import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, paginateListObjectsV2, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, paginateQuery } from "@aws-sdk/lib-dynamodb";
import {
  officeHoursHistoryFromSnapshots,
  type OfficeHoursGradeSnapshot,
  type OfficeHoursHistoryBackfill,
  type OfficeHoursHistoryCourse,
  type OfficeHoursRow,
} from "./academics";

export const ASPIREDU_SNAPSHOTS_TABLE = "amu-aspiredu-student-snapshots";
export const ASPIREDU_AGGREGATE_BUCKET_DEFAULT =
  "aspiredudatatransferstack-aggregatebucket62f91ffa-aaetik2gcfbf";

const SNAPSHOT_PREFIX = "snapshots/";
const SUMMARY_SUFFIX = "/summary.json";
const MAX_SNAPSHOTS = 90;
const BACKFILL_TIMEOUT_MS = 25_000;
const QUERY_CONCURRENCY = 6;
const REGION = "us-east-2";

function aggregateBucket(): string {
  return (process.env.ASPIREDU_AGGREGATE_BUCKET || "").trim() || ASPIREDU_AGGREGATE_BUCKET_DEFAULT;
}

function errorName(error: unknown): string {
  const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = err?.name || err?.Code || "Error";
  const status = err?.$metadata?.httpStatusCode;
  return status ? `${code}:${status}` : code;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function snapshotIdFromKey(key: string): string {
  const parts = key.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 1] === "summary.json") {
    return parts[parts.length - 2];
  }
  return "";
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("TimeoutError")), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

function mapCourseItem(value: unknown): OfficeHoursHistoryCourse | null {
  const record = asRecord(value);
  if (!record) return null;
  if (asString(record.entityType).toUpperCase() !== "COURSE") return null;
  const course = asString(record.course);
  const courseSisId = asString(record.courseSisId);
  const courseGrade = asFiniteNumber(record.courseGrade);
  return {
    email: asString(record.email) || undefined,
    studentSisId: asString(record.studentSisId) || undefined,
    pcid: asString(record.pcid) || undefined,
    sisId: asString(record.sisId) || undefined,
    course: course || undefined,
    courseSisId: courseSisId || undefined,
    courseGrade,
  };
}

async function listSnapshotSummaries(
  s3: S3Client,
  bucket: string,
): Promise<{ snapshotId: string; asOf: string }[]> {
  const keys: string[] = [];
  for await (const page of paginateListObjectsV2({ client: s3 }, { Bucket: bucket, Prefix: SNAPSHOT_PREFIX })) {
    for (const object of page.Contents ?? []) {
      const key = object.Key || "";
      if (key.endsWith(SUMMARY_SUFFIX)) keys.push(key);
    }
  }
  const summaries = (
    await mapPool(keys, QUERY_CONCURRENCY, async (key) => {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const text = await out.Body?.transformToString();
        if (!text) return null;
        const record = asRecord(JSON.parse(text));
        const snapshotId = asString(record?.snapshotId) || snapshotIdFromKey(key);
        const asOf = asString(record?.asOf);
        if (!snapshotId || !asOf) return null;
        return { snapshotId, asOf };
      } catch (error) {
        console.warn("office-hours snapshot summary skipped", errorName(error));
        return null;
      }
    })
  ).filter((row): row is { snapshotId: string; asOf: string } => Boolean(row));

  summaries.sort((a, b) => (Date.parse(a.asOf) || 0) - (Date.parse(b.asOf) || 0));
  return summaries.length > MAX_SNAPSHOTS ? summaries.slice(-MAX_SNAPSHOTS) : summaries;
}

async function querySnapshotCourses(
  ddb: DynamoDBDocumentClient,
  snapshotId: string,
): Promise<OfficeHoursHistoryCourse[]> {
  const courses: OfficeHoursHistoryCourse[] = [];
  for await (const page of paginateQuery(
    { client: ddb },
    {
      TableName: ASPIREDU_SNAPSHOTS_TABLE,
      KeyConditionExpression: "snapshotId = :id",
      ExpressionAttributeValues: { ":id": snapshotId },
    },
  )) {
    for (const item of page.Items ?? []) {
      const course = mapCourseItem(item);
      if (course) courses.push(course);
    }
  }
  return courses;
}

async function loadHistory(
  rows: Pick<OfficeHoursRow, "email" | "pcid" | "course">[],
): Promise<OfficeHoursHistoryBackfill> {
  const bucket = aggregateBucket();
  const s3 = new S3Client({ region: process.env.AWS_REGION || REGION });
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  let summaries: { snapshotId: string; asOf: string }[];
  try {
    summaries = await listSnapshotSummaries(s3, bucket);
  } catch (error) {
    console.warn("office-hours snapshot list skipped", errorName(error));
    return {};
  }
  if (!summaries.length) return {};

  const snapshots: OfficeHoursGradeSnapshot[] = [];
  const loaded = await mapPool(summaries, QUERY_CONCURRENCY, async (summary) => {
    try {
      const courses = await querySnapshotCourses(ddb, summary.snapshotId);
      return { asOf: summary.asOf, courses };
    } catch (error) {
      console.warn("office-hours snapshot query skipped", errorName(error));
      return null;
    }
  });
  for (const snapshot of loaded) {
    if (snapshot) snapshots.push(snapshot);
  }
  const filled = officeHoursHistoryFromSnapshots(rows, snapshots);
  console.info("office-hours history backfill", {
    snapshots: snapshots.length,
    filled: Object.keys(filled).length,
  });
  return filled;
}

export async function backfillOfficeHoursFromSnapshots(
  rows: Pick<OfficeHoursRow, "email" | "pcid" | "course">[],
  options?: { timeoutMs?: number },
): Promise<OfficeHoursHistoryBackfill> {
  if (!rows.length) return {};
  try {
    return await withTimeout(loadHistory(rows), options?.timeoutMs ?? BACKFILL_TIMEOUT_MS);
  } catch (error) {
    console.warn("office-hours history backfill failed", errorName(error));
    return {};
  }
}
