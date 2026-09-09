import { NextResponse } from "next/server";
import { requireHousingPreviewAccess } from "@/lib/s3-proxy";
import { HALL_CHARTS } from "@/lib/reports/housing/store";
import goret from "@/lib/reports/housing/halls/goret.chart.json";
import jpii from "@/lib/reports/housing/halls/jpii.chart.json";
import sebast from "@/lib/reports/housing/halls/sebast.chart.json";
import stjose from "@/lib/reports/housing/halls/stjose.chart.json";
import teresa from "@/lib/reports/housing/halls/teresa.chart.json";
import xavier from "@/lib/reports/housing/halls/xavier.chart.json";

export const dynamic = "force-dynamic";

const CHARTS: Record<string, unknown> = {
  "goret.chart.json": goret,
  "jpii.chart.json": jpii,
  "sebast.chart.json": sebast,
  "stjose.chart.json": stjose,
  "teresa.chart.json": teresa,
  "xavier.chart.json": xavier,
};

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const denied = requireHousingPreviewAccess(req);
  if (denied) return denied;

  const { file } = await ctx.params;
  const requested = decodeURIComponent(file || "");
  if (!HALL_CHARTS.has(requested) || requested.includes("/") || requested.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const chart = CHARTS[requested];
  if (!chart) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(chart, {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
