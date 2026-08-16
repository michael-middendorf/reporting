import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION || "us-east-2";

function client() {
  return new DynamoDBClient({ region });
}

/**
 * Atomically claims a magic-link nonce so it can only be redeemed once.
 * Returns claimed:false (not an error) if the nonce was already used —
 * callers must treat an already-valid session on the same request as a
 * separate no-op path *before* calling this, so page-reload/double-submit
 * doesn't read as "token already used" to a legitimately signed-in user.
 *
 * Throws on any DynamoDB failure other than the conditional check losing —
 * callers must fail closed (reject sign-in) rather than swallow this, since
 * this store is the only thing preventing link replay.
 */
export async function claimMagicNonce(
  nonce: string,
  expiresAtEpochSeconds: number,
): Promise<{ claimed: boolean }> {
  const tableName = (process.env.MAGIC_NONCE_TABLE || "").trim();
  if (!tableName) throw new Error("MAGIC_NONCE_TABLE is not configured");

  try {
    await client().send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          nonce: { S: nonce },
          expiresAt: { N: String(expiresAtEpochSeconds) },
        },
        ConditionExpression: "attribute_not_exists(nonce)",
      }),
    );
    return { claimed: true };
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) {
      return { claimed: false };
    }
    throw e;
  }
}
