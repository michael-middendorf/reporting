import { NextResponse } from "next/server";
import { answerCensusQuestion, censusChatConfigured } from "@/lib/reports/census/chat";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  return NextResponse.json({ configured: censusChatConfigured() });
}

export async function POST(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  let body: { question?: string; history?: { role: "user" | "assistant"; content: string }[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = (body.question || "").trim();
  if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  if (question.length > 2000) return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  try {
    const out = await answerCensusQuestion(question, body.history || []);
    return NextResponse.json(out);
  } catch (e) {
    const err = e as Error & { status?: number };
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return NextResponse.json({ error: err.message || "Census Q&A failed" }, { status });
  }
}
