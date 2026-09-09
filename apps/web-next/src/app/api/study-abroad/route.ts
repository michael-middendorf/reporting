import { NextResponse } from "next/server";
import { requireHousingPreviewAccess } from "@/lib/s3-proxy";
import { readJsonObject, STUDY_ABROAD_KEY, readResidents } from "@/lib/reports/housing/store";

export const dynamic = "force-dynamic";

type StudyAbroad = {
  session?: string;
  houses?: Record<string, number>;
  total?: number;
  cached_at?: string;
};

function fromResidents(residents: { building?: string }[] | undefined): StudyAbroad {
  const houses: Record<string, number> = {};
  for (const r of residents || []) {
    const b = (r.building || "").trim();
    if (b === "CIARA" || b === "MALAC") houses[b] = (houses[b] || 0) + 1;
  }
  return {
    session: process.env.EREZ_EXTRA_SESSIONS || "2026FALL03Ireland",
    houses,
    total: Object.values(houses).reduce((s, n) => s + n, 0),
  };
}

export async function GET(req: Request) {
  const denied = requireHousingPreviewAccess(req);
  if (denied) return denied;

  try {
    const cached = await readJsonObject<StudyAbroad>(STUDY_ABROAD_KEY);
    if (cached) {
      return NextResponse.json(cached, { headers: { "Cache-Control": "private, no-store" } });
    }
    const residents = await readResidents();
    return NextResponse.json(fromResidents(residents?.residents as { building?: string }[] | undefined), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
