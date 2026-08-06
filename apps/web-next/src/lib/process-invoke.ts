import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const region = process.env.AWS_REGION || "us-east-2";

function lambda() {
  return new LambdaClient({ region });
}

export async function invokeProcessor(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const out = await lambda().send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  if (out.FunctionError) {
    const raw = out.Payload ? Buffer.from(out.Payload).toString("utf-8") : out.FunctionError;
    throw new Error(`Processor error: ${raw}`);
  }
  if (!out.Payload) return null;
  return JSON.parse(Buffer.from(out.Payload).toString("utf-8"));
}

export async function fetchProcessedArtifact(
  functionEnvKey: "MAS_PROCESS_FUNCTION" | "ALUMNI_PROCESS_FUNCTION",
  artifact: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  const name = (process.env[functionEnvKey] || "").trim();
  if (!name) throw new Error(`${functionEnvKey} is not configured`);
  const result = (await invokeProcessor(name, { artifact, ...extra })) as {
    ok?: boolean;
    body?: unknown;
    error?: string;
  };
  if (!result?.ok) {
    throw new Error(result?.error || `Failed to load ${artifact}`);
  }
  return result.body;
}
