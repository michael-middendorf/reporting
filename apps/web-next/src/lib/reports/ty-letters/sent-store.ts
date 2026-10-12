import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || "us-east-2";

/**
 * Server-only DynamoDB access for the thank-you letter Sent flags (DST-3062).
 *
 * IAM (infra/lib/reporting-ecs-stack.ts, sid TyLetterSentItems): the web task
 * role has only GetItem, BatchGetItem and UpdateItem on this table, so this
 * module never uses PutItem, DeleteItem, Query or Scan. One item per gift id:
 * { giftId, sent, sentBy, sentAt, updatedBy, updatedAt }. Staff emails and gift
 * ids only, no donor data.
 */

export type SentFlag = {
  giftId: string;
  sent: boolean;
  sentBy: string | null;
  sentAt: string | null;
};

export function sentTableName(): string {
  return (process.env.TY_LETTER_SENT_TABLE || "").trim();
}

let cached: DynamoDBDocumentClient | null = null;
function doc(): DynamoDBDocumentClient {
  if (!cached) {
    cached = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return cached;
}

const BATCH = 100;
const MAX_RETRIES = 5;

function toFlag(item: Record<string, unknown>): SentFlag | null {
  const giftId = typeof item.giftId === "string" ? item.giftId : null;
  if (!giftId) return null;
  return {
    giftId,
    sent: item.sent === true,
    sentBy: typeof item.sentBy === "string" ? item.sentBy : null,
    sentAt: typeof item.sentAt === "string" ? item.sentAt : null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** BatchGetItem in chunks of 100, retrying UnprocessedKeys with backoff. */
async function getMany(giftIds: string[]): Promise<Map<string, SentFlag>> {
  const table = sentTableName();
  const out = new Map<string, SentFlag>();
  const unique = [...new Set(giftIds)];
  for (let i = 0; i < unique.length; i += BATCH) {
    let keys: Record<string, unknown>[] = unique.slice(i, i + BATCH).map((giftId) => ({ giftId }));
    for (let attempt = 0; keys.length; attempt++) {
      if (attempt > MAX_RETRIES) throw new Error("Sent flags: unprocessed keys after retries");
      if (attempt > 0) await sleep(50 * 2 ** attempt);
      const res = await doc().send(
        new BatchGetCommand({
          RequestItems: {
            [table]: { Keys: keys, ProjectionExpression: "giftId, sent, sentBy, sentAt" },
          },
        }),
      );
      for (const item of (res.Responses?.[table] as Record<string, unknown>[] | undefined) ?? []) {
        const flag = toFlag(item);
        if (flag) out.set(flag.giftId, flag);
      }
      keys = (res.UnprocessedKeys?.[table]?.Keys as Record<string, unknown>[] | undefined) ?? [];
    }
  }
  return out;
}

/** Set (sentBy, sentAt) or clear the flag. UpdateItem creates the item if needed. */
async function setSent(giftId: string, sent: boolean, email: string): Promise<SentFlag> {
  const now = new Date().toISOString();
  const names = {
    "#sent": "sent",
    "#updatedBy": "updatedBy",
    "#updatedAt": "updatedAt",
    "#sentBy": "sentBy",
    "#sentAt": "sentAt",
  };
  const res = await doc().send(
    new UpdateCommand(
      sent
        ? {
            TableName: sentTableName(),
            Key: { giftId },
            UpdateExpression:
              "SET #sent = :sent, #sentBy = :by, #sentAt = :at, #updatedBy = :by, #updatedAt = :at",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: { ":sent": true, ":by": email, ":at": now },
            ReturnValues: "ALL_NEW",
          }
        : {
            TableName: sentTableName(),
            Key: { giftId },
            UpdateExpression:
              "SET #sent = :sent, #updatedBy = :by, #updatedAt = :at REMOVE #sentBy, #sentAt",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: { ":sent": false, ":by": email, ":at": now },
            ReturnValues: "ALL_NEW",
          },
    ),
  );
  return (
    toFlag((res.Attributes as Record<string, unknown> | undefined) ?? {}) ?? {
      giftId,
      sent,
      sentBy: sent ? email : null,
      sentAt: sent ? now : null,
    }
  );
}

/** Test seam: route tests replace these so they never reach AWS. */
export const sentStore = { getMany, setSent };
