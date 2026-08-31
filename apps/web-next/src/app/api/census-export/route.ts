import { NextResponse } from "next/server";
import { loadCensusSnapshot } from "@/lib/reports/census/overlay";
import { DEFAULT_FILTERS, isListExportKind, parseReportFilters } from "@/lib/reports/census/report";
import { buildCensusWorkbook, buildListsWorkbook, censusFileName, listsFileName } from "@/lib/reports/census/workbook";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function xlsxResponse(buf: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Auth-gated Excel draft matching the FA25 census workbook layout. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  try {
    const { data, housingRows, lists, ftcaRaw } = await loadCensusSnapshot();
    const buf = await buildCensusWorkbook(data, housingRows, lists, ftcaRaw);
    return xlsxResponse(buf, censusFileName(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Filtered list export: unretained, sports, raw, FTCA, verify, or all of those with current filters. */
export async function POST(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; filters?: unknown };
    const { data, housingRows, lists, ftcaRaw } = await loadCensusSnapshot();
    if (body.kind === "draft") {
      const buf = await buildCensusWorkbook(data, housingRows, lists, ftcaRaw);
      return xlsxResponse(buf, censusFileName(data));
    }
    const kind = isListExportKind(body.kind) ? body.kind : "filtered";
    const filters = body.filters ? parseReportFilters(body.filters) : DEFAULT_FILTERS;
    const buf = await buildListsWorkbook(data, lists, ftcaRaw, housingRows, filters, kind);
    return xlsxResponse(buf, listsFileName(kind, data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
