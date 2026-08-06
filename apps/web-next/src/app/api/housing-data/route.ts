import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { buildingsFromRecords, type HousingRecord } from "@/lib/reports/housing/shape";
import { loadSourceRows, readJson } from "@/lib/sources";

/** Housing occupancy from sources/qlik/housing_occupancy. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "housing");
  if (denied) return denied;

  try {
    const { rows, latest } = await loadSourceRows<HousingRecord>("qlik", "housing_occupancy");
    let session = "—";
    try {
      const meta = await readJson<{ provenance?: { session?: string } }>(
        `${latest.prefix}/meta.json`,
      );
      session = meta.provenance?.session || session;
    } catch {
      /* optional */
    }
    const buildings = buildingsFromRecords(rows);
    return NextResponse.json({
      buildings,
      planning: {
        session,
        total: latest.record_count ?? buildings.reduce((s, b) => s + (b.occupied || 0), 0),
        cached_at: latest.pulled_at || "—",
      },
      source: "sources/qlik/housing_occupancy",
    });
  } catch (e) {
    const qlik = process.env.QLIK_API_KEY || "";
    const tenant = process.env.QLIK_TENANT || "";
    const configured =
      Boolean(qlik) &&
      qlik !== "PLACEHOLDER" &&
      Boolean(tenant) &&
      tenant !== "PLACEHOLDER";

    return NextResponse.json(
      {
        error: configured
          ? "Housing raw source not published yet (sources/qlik/housing_occupancy). Wait for HousingRefresh."
          : `Housing source missing: ${e instanceof Error ? e.message : String(e)}`,
        buildings: [],
      },
      { status: 503 },
    );
  }
}
