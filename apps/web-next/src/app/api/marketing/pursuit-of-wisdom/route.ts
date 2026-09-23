import { GetObjectCommand } from "@aws-sdk/client-s3";
import { overlayPursuitOfWisdomYoutube } from "@/lib/pursuit-of-wisdom-youtube";
import { dataBucket, requireReportAccess, s3 } from "@/lib/s3-proxy";

const KEY = "marketing/pursuit-of-wisdom/latest.json";

export async function GET(request: Request) {
  const denied = requireReportAccess(request, "marketing");
  if (denied) return denied;
  try {
    const response = await s3().send(new GetObjectCommand({ Bucket: dataBucket(), Key: KEY }));
    const raw = await response.Body?.transformToString();
    const snapshot = JSON.parse(raw || "");
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return Response.json({ error: "Unable to load Pursuit of Wisdom reporting." }, { status: 502 });
    }
    return Response.json(overlayPursuitOfWisdomYoutube(snapshot), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: unknown) {
    const code = (error as { name?: string }).name;
    if (code === "NoSuchKey") return Response.json({ status: "pending", message: "The first Pursuit of Wisdom reporting refresh has not completed." }, { status: 202 });
    return Response.json({ error: "Unable to load Pursuit of Wisdom reporting." }, { status: 502 });
  }
}
