import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { requireReportAccess } from "@/lib/s3-proxy";
import { readWorkflow, upsertWorkflow } from "@/lib/reports/music/workflow-store";
import type { WorkflowInput } from "@/lib/reports/music/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "music");
  if (denied) return denied;
  try {
    const rows = await readWorkflow();
    return NextResponse.json(
      { rows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function PATCH(req: Request) {
  const denied = requireReportAccess(req, "music");
  if (denied) return denied;
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: WorkflowInput;
  try {
    body = (await req.json()) as WorkflowInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.applicationId || String(body.applicationId).trim() === "") {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  try {
    const workflow = await upsertWorkflow(body, email, new Date().toISOString());
    return NextResponse.json(
      { workflow },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("must be") || msg.includes("too long") || msg.includes("required")
      ? 400
      : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
