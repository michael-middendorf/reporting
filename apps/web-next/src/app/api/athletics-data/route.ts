import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { loadSourceRows } from "@/lib/sources";
import type { AthleticsPayload, SlateRow } from "@/lib/reports/athletics/types";
import {
  normalizeApplication,
  normalizeProspect,
  prospectMeetsGpaMinimum,
} from "@/lib/reports/athletics/normalize";

const DATASETS = ["applications", "prospects"] as const;
const MEMORY_TTL_MS = process.env.NODE_ENV === "production" ? 5 * 60_000 : 30 * 60_000;
let memoryCache: { expiresAt: number; payload: AthleticsPayload } | null = null;
let inflightLoad: Promise<AthleticsPayload> | null = null;

function payloadResponse(payload: AthleticsPayload) {
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=300" },
  });
}

async function loadCached() {
  const loaded = await Promise.all(
    DATASETS.map(async (dataset) => {
      const result = await loadSourceRows<SlateRow>("athletics", dataset);
      return [dataset, result] as const;
    }),
  );
  return Object.fromEntries(loaded) as Record<(typeof DATASETS)[number], Awaited<ReturnType<typeof loadSourceRows<SlateRow>>>>;
}

async function loadLocalPreview(): Promise<Record<(typeof DATASETS)[number], { rows: SlateRow[]; latest: { pulled_at?: string } }>> {
  if (process.env.NODE_ENV === "production") throw new Error("Athletics cache is unavailable");
  const raw = (process.env.ATHLETICS_SLATE_QUERIES || "").trim();
  if (!raw) throw new Error("Athletics cache is unavailable and ATHLETICS_SLATE_QUERIES is not set locally");
  const config = JSON.parse(raw) as { queries?: { name?: string; query_id?: string; token?: string; auth?: "bearer" | "query" }[] };
  const entries = await Promise.all(DATASETS.map(async (dataset) => {
    const query = config.queries?.find((item) => item.name === dataset);
    if (!query?.query_id || !query.token) throw new Error(`Missing local ${dataset} query configuration`);
    const auth = query.auth || (dataset === "applications" ? "bearer" : "query");
    const params = new URLSearchParams({ id: query.query_id, cmd: "service", output: "json" });
    const headers: HeadersInit = {};
    if (auth === "bearer") headers.Authorization = `Bearer ${query.token}`;
    else params.set("h", query.token);
    const response = await fetch(`https://apply.avemaria.edu/manage/query/run?${params}`, { cache: "no-store", headers });
    if (!response.ok) throw new Error(`Slate ${dataset} request failed (${response.status})`);
    const body = await response.json() as { row?: SlateRow | SlateRow[] } | SlateRow[];
    const rows = Array.isArray(body) ? body : Array.isArray(body.row) ? body.row : body.row ? [body.row] : [];
    return [dataset, { rows, latest: { pulled_at: new Date().toISOString() } }] as const;
  }));
  return Object.fromEntries(entries) as Record<(typeof DATASETS)[number], { rows: SlateRow[]; latest: { pulled_at?: string } }>;
}

async function buildPayload(): Promise<AthleticsPayload> {
  const hasLocalQueries = process.env.NODE_ENV !== "production" && Boolean(
    (process.env.ATHLETICS_SLATE_QUERIES || "").trim(),
  );
  const data = hasLocalQueries ? await loadLocalPreview() : await loadCached();
  return {
    success: true,
    generatedAt: data.applications.latest.pulled_at || data.prospects.latest.pulled_at || null,
    applications: data.applications.rows.map(normalizeApplication),
    prospects: data.prospects.rows.filter(prospectMeetsGpaMinimum).map(normalizeProspect),
  };
}

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "athletics");
  if (denied) return denied;
  try {
    if (memoryCache && memoryCache.expiresAt > Date.now()) {
      return payloadResponse(memoryCache.payload);
    }
    inflightLoad ||= buildPayload();
    const payload = await inflightLoad.finally(() => { inflightLoad = null; });
    memoryCache = { expiresAt: Date.now() + MEMORY_TTL_MS, payload };
    return payloadResponse(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unable to load Athletics data" },
      { status: 503 },
    );
  }
}
