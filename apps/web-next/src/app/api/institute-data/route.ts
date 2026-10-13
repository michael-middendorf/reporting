import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";

/**
 * Same-origin proxy for the Institute dashboard payload.
 *
 * Caches the built payload in memory and on local disk with stale-while-revalidate.
 * Fresh reads return immediately (sub-millisecond), while background revalidation
 * keeps data current from the InstituteData Lambda without blocking dashboard loads.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";

const FRESH_TTL_MS = 15 * 60 * 1000; // 15 minutes: serve immediately from cache
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours: serve stale and revalidate in background
const DISK_CACHE_PATH = join(tmpdir(), "institute-data-cache.json");

export interface InstituteCacheEntry {
  payload: Record<string, unknown>;
  timestamp: number;
}

let memoryCache: InstituteCacheEntry | null = null;
let inflightLoad: Promise<Record<string, unknown>> | null = null;

async function readDiskCache(): Promise<InstituteCacheEntry | null> {
  try {
    const text = await readFile(DISK_CACHE_PATH, "utf8");
    const entry = JSON.parse(text) as InstituteCacheEntry;
    if (entry && typeof entry.timestamp === "number" && entry.payload) {
      return entry;
    }
  } catch {
    // Disk cache not present or invalid
  }
  return null;
}

async function writeDiskCache(entry: InstituteCacheEntry): Promise<void> {
  try {
    await writeFile(DISK_CACHE_PATH, JSON.stringify(entry), "utf8");
  } catch (err) {
    console.error("Failed to write Institute disk cache:", err);
  }
}

async function invokeLambda(force = false): Promise<Record<string, unknown>> {
  const fn = (process.env.INSTITUTE_FN_NAME || "").trim();
  if (!fn) {
    throw new Error("INSTITUTE_FN_NAME is not configured");
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 55_000);
  let out;
  try {
    out = await new LambdaClient({ region }).send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(JSON.stringify({ force })),
      }),
      { abortSignal: ac.signal },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = out.Payload ? new TextDecoder().decode(out.Payload) : "";
  if (!text) {
    throw new Error("Institute function returned no data");
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Institute function returned a non-JSON payload");
  }

  if (out.FunctionError) {
    const msg =
      (typeof data.errorMessage === "string" && data.errorMessage) ||
      (typeof data.error === "string" && data.error) ||
      out.FunctionError;
    throw new Error(`Institute data unavailable: ${msg}`);
  }

  return data;
}

export const instituteCache = {
  getMemoryCache: () => memoryCache,
  setMemoryCache: (entry: InstituteCacheEntry | null) => {
    memoryCache = entry;
  },
  getInflightLoad: () => inflightLoad,
  readDisk: readDiskCache,
  writeDisk: writeDiskCache,
  fetchLive: invokeLambda,
  clear: () => {
    memoryCache = null;
    inflightLoad = null;
  },
};

async function loadFresh(force = false): Promise<Record<string, unknown>> {
  if (inflightLoad) return inflightLoad;

  inflightLoad = (async () => {
    try {
      const payload = await instituteCache.fetchLive(force);
      const entry: InstituteCacheEntry = { payload, timestamp: Date.now() };
      memoryCache = entry;
      await instituteCache.writeDisk(entry);
      return payload;
    } finally {
      inflightLoad = null;
    }
  })();

  return inflightLoad;
}

function jsonResponse(payload: Record<string, unknown>, cacheStatus: string) {
  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=120, stale-while-revalidate=600",
      "X-Cache-Status": cacheStatus,
    },
  });
}

// Warm up cache in production background on startup
if (
  typeof process !== "undefined" &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  Boolean((process.env.INSTITUTE_FN_NAME || "").trim())
) {
  void (async () => {
    try {
      const disk = await readDiskCache();
      if (disk) {
        memoryCache = disk;
        if (Date.now() - disk.timestamp >= FRESH_TTL_MS) {
          void loadFresh().catch(() => {});
        }
      } else {
        void loadFresh().catch(() => {});
      }
    } catch {
      // Warmup is non-blocking and best-effort
    }
  })();
}

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "institute");
  if (denied) return denied;

  const url = new URL(req.url);
  const forceRefresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("refresh") === "true";

  if (forceRefresh) {
    try {
      const live = await loadFresh(true);
      return jsonResponse(live, "BYPASS");
    } catch (e) {
      if (memoryCache?.payload) {
        return jsonResponse(memoryCache.payload, "STALE_FALLBACK");
      }
      return NextResponse.json(
        {
          error: "Failed to refresh Institute data",
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 502 },
      );
    }
  }

  if (!memoryCache) {
    memoryCache = await instituteCache.readDisk();
  }

  if (memoryCache?.payload) {
    const age = Date.now() - memoryCache.timestamp;
    if (age < FRESH_TTL_MS) {
      return jsonResponse(memoryCache.payload, "HIT");
    }

    if (age < STALE_TTL_MS) {
      // Stale while revalidate: return cached payload immediately, refresh in background
      if (!inflightLoad) {
        loadFresh().catch((err) => {
          console.error("Background refresh of Institute data failed:", err);
        });
      }
      return jsonResponse(memoryCache.payload, "STALE");
    }
  }

  try {
    const fresh = await loadFresh();
    return jsonResponse(fresh, "MISS");
  } catch (e) {
    if (memoryCache?.payload) {
      return jsonResponse(memoryCache.payload, "STALE_FALLBACK");
    }
    return NextResponse.json(
      {
        error: "Failed to load Institute data",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
