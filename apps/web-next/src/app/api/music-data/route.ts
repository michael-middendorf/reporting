import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { loadSourceRows } from "@/lib/sources";
import {
  applyJoins,
  indexAme,
  indexAuditions,
  indexLoiCodes,
  indexPeople,
  toApplicant,
} from "@/lib/reports/music/join";
import { readWorkflow } from "@/lib/reports/music/workflow-store";
import type { MusicBoardPayload, MusicRow } from "@/lib/reports/music/types";

export const dynamic = "force-dynamic";

async function loadRows(source: string, dataset: string): Promise<Record<string, unknown>[]> {
  try {
    const { rows } = await loadSourceRows<Record<string, unknown>>(source, dataset);
    return rows;
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const http = err.$metadata?.httpStatusCode;
    if (err.name === "NoSuchKey" || err.name === "NotFound" || http === 404) return [];
    throw e;
  }
}

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "music");
  if (denied) return denied;

  try {
    const [admissionsRaw, ameRaw, visitsRaw, decisionsRaw, withdrawnRaw, workflow] =
      await Promise.all([
        loadRows("slate", "admissions"),
        loadRows("slate", "ame"),
        loadRows("slate", "campus_visits"),
        loadRows("slate", "app_decisions"),
        loadRows("slate", "withdrawn"),
        readWorkflow(),
      ]);

    const applicants = admissionsRaw
      .map(toApplicant)
      .filter((row): row is MusicRow => row != null);

    const people = indexPeople([...ameRaw, ...visitsRaw, ...withdrawnRaw]);
    const rows = applyJoins(
      applicants,
      indexAme(ameRaw),
      indexAuditions([]),
      workflow,
      people,
      indexLoiCodes(decisionsRaw),
    ).sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));

    const payload: MusicBoardPayload = {
      generatedAt: new Date().toISOString(),
      applicantCount: rows.length,
      rows,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, rows: [], applicantCount: 0 }, { status: 502 });
  }
}
