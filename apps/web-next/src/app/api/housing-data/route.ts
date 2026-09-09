import { NextResponse } from "next/server";
import { requireHousingPreviewAccess } from "@/lib/s3-proxy";
import { buildingsFromRecords, type HousingRecord } from "@/lib/reports/housing/shape";
import { loadSourceRows, readJson } from "@/lib/sources";

/** Housing occupancy from eRez (mirrored to qlik/housing_occupancy during cutover). */
export async function GET(req: Request) {
  const denied = requireHousingPreviewAccess(req);
  if (denied) return denied;

  try {
    let rows: HousingRecord[];
    let latest: Awaited<ReturnType<typeof loadSourceRows<HousingRecord>>>["latest"];
    let source = "sources/erez/housing_occupancy";
    try {
      const loaded = await loadSourceRows<HousingRecord>("erez", "housing_occupancy");
      rows = loaded.rows;
      latest = loaded.latest;
    } catch {
      const loaded = await loadSourceRows<HousingRecord>("qlik", "housing_occupancy");
      rows = loaded.rows;
      latest = loaded.latest;
      source = "sources/qlik/housing_occupancy";
    }
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
      source,
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
          ? "Housing raw source not published yet (sources/erez/housing_occupancy). Wait for HousingRefresh."
          : `Housing source missing: ${e instanceof Error ? e.message : String(e)}`,
        buildings: [],
      },
      { status: 503 },
    );
  }
}
