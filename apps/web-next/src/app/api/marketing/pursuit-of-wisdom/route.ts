import { GetObjectCommand } from "@aws-sdk/client-s3";
import { dataBucket, requireReportAccess, s3 } from "@/lib/s3-proxy";

const KEY = "marketing/pursuit-of-wisdom/latest.json";

export async function GET(request: Request) {
  const denied = requireReportAccess(request, "marketing");
  if (denied) return denied;
  try {
    const response = await s3().send(new GetObjectCommand({ Bucket: dataBucket(), Key: KEY }));
    return new Response(await response.Body?.transformToString(), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error: unknown) {
    const code = (error as { name?: string }).name;
    if (code === "NoSuchKey") return Response.json({ status: "pending", message: "The first Pursuit of Wisdom reporting refresh has not completed." }, { status: 202 });
    return Response.json({ error: "Unable to load Pursuit of Wisdom reporting." }, { status: 502 });
  }
}
