import { randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  historyPk,
  pkForKind,
  type ManualKpi,
  type ManualKpiInput,
  type RecordMeta,
  type RegisterKind,
  type RiskInput,
  type RiskItem,
} from "./register";

const region = process.env.AWS_REGION || "us-east-2";

/**
 * Server-only DynamoDB access for the Cybersecurity register.
 *
 * IAM (infra/lib/reporting-ecs-stack.ts): the web task role has only
 * GetItem, Query, PutItem and UpdateItem on this table. TransactWriteItems has
 * no IAM action of its own; DynamoDB authorizes each Put inside it as PutItem.
 * There is no DeleteItem: risks are closed, not deleted, so the history stays.
 */

export function registerTableName(): string {
  return (process.env.CYBER_REGISTER_TABLE || "").trim();
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

type StoredRow<T> = T & RecordMeta & { pk: string; sk: string };

function stripKeys<T>(row: Record<string, unknown>): T {
  const { pk: _pk, sk: _sk, ...rest } = row;
  void _pk;
  void _sk;
  return rest as T;
}

async function queryAll(table: string, pk: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await doc().send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((res.Items as Record<string, unknown>[] | undefined) ?? []));
    start = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (start);
  return out;
}

export type HistoryRow = {
  id: string;
  kind: RegisterKind;
  ts: string;
  by: string;
  before: unknown;
  after: unknown;
};

export class RegisterConflictError extends Error {}

function historyItem(
  kind: RegisterKind,
  id: string,
  by: string,
  before: unknown,
  after: unknown,
  ts: string,
) {
  return {
    pk: historyPk(id),
    // ISO timestamp plus a short random suffix so two writes in the same
    // millisecond never overwrite each other's history row.
    sk: `${ts}#${randomBytes(3).toString("hex")}`,
    kind,
    id,
    ts,
    by,
    before: before ?? null,
    after,
  };
}

/** The seam the route uses. Tests replace these functions. */
export const registerStore = {
  async list(): Promise<{ risks: RiskItem[]; kpis: ManualKpi[] }> {
    const table = registerTableName();
    const [risks, kpis] = await Promise.all([
      queryAll(table, pkForKind("risk")),
      queryAll(table, pkForKind("kpi")),
    ]);
    return {
      risks: risks.map((r) => stripKeys<RiskItem>(r)),
      kpis: kpis.map((r) => stripKeys<ManualKpi>(r)),
    };
  },

  async history(id: string, limit = 50): Promise<HistoryRow[]> {
    const res = await doc().send(
      new QueryCommand({
        TableName: registerTableName(),
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": historyPk(id) },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return ((res.Items as Record<string, unknown>[] | undefined) ?? []).map(
      (r) => stripKeys<HistoryRow>(r),
    );
  },

  async get(kind: RegisterKind, id: string): Promise<(RiskItem | ManualKpi) | null> {
    const res = await doc().send(
      new GetCommand({
        TableName: registerTableName(),
        Key: { pk: pkForKind(kind), sk: id },
        ConsistentRead: true,
      }),
    );
    return res.Item ? stripKeys<RiskItem | ManualKpi>(res.Item as Record<string, unknown>) : null;
  },

  /** Create; fails with RegisterConflictError when the id already exists. */
  async create(
    kind: RegisterKind,
    input: RiskInput | ManualKpiInput,
    by: string,
    now = new Date(),
  ): Promise<RiskItem | ManualKpi> {
    const ts = now.toISOString();
    const item = { ...input, createdAt: ts, updatedAt: ts, updatedBy: by, version: 1 };
    const row: StoredRow<typeof input> = { ...item, pk: pkForKind(kind), sk: input.id };
    try {
      await doc().send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: registerTableName(),
                Item: row,
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: registerTableName(),
                Item: historyItem(kind, input.id, by, null, item, ts),
              },
            },
          ],
        }),
      );
    } catch (e) {
      if (isConditionFailure(e)) throw new RegisterConflictError(`${input.id} already exists`);
      throw e;
    }
    return item as RiskItem | ManualKpi;
  },

  /**
   * Replace with the merged, re-validated record. Optimistic lock on version:
   * a stale editor gets RegisterConflictError instead of overwriting.
   */
  async update(
    kind: RegisterKind,
    before: RiskItem | ManualKpi,
    input: RiskInput | ManualKpiInput,
    by: string,
    now = new Date(),
  ): Promise<RiskItem | ManualKpi> {
    const ts = now.toISOString();
    const item = {
      ...input,
      createdAt: before.createdAt,
      updatedAt: ts,
      updatedBy: by,
      version: before.version + 1,
    };
    try {
      await doc().send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: registerTableName(),
                Item: { ...item, pk: pkForKind(kind), sk: input.id },
                ConditionExpression: "attribute_exists(pk) AND version = :v",
                ExpressionAttributeValues: { ":v": before.version },
              },
            },
            {
              Put: {
                TableName: registerTableName(),
                Item: historyItem(kind, input.id, by, before, item, ts),
              },
            },
          ],
        }),
      );
    } catch (e) {
      if (isConditionFailure(e)) {
        throw new RegisterConflictError(`${input.id} changed since it was loaded`);
      }
      throw e;
    }
    return item as RiskItem | ManualKpi;
  },
};

function isConditionFailure(e: unknown): boolean {
  const err = e as { name?: string; CancellationReasons?: { Code?: string }[] };
  if (err?.name === "ConditionalCheckFailedException") return true;
  if (err?.name === "TransactionCanceledException") {
    return (err.CancellationReasons ?? []).some((r) => r?.Code === "ConditionalCheckFailed");
  }
  return false;
}
