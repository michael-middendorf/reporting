/**
 * Orchestration for GET /aspiredu/api/export (the "Download spreadsheet"
 * button). Dependencies are injected so tests run without AWS. Returns a
 * standard Response: xlsx bytes on success, a JSON error otherwise.
 *
 * Logs only the actor email, counts, and timing. Never student data, and never
 * a Lambda error message (invokeProcessor embeds the raw payload).
 */
import { aspireduPrivateHeaders } from "../../aspiredu-auth";
import { isAspireduCallerDenied, isCoachingActionUnavailable } from "../athletics-coaching/academics";
import { buildExportWorkbook, exportFileName } from "./export-workbook";
import type { ProfileSources } from "./student-profile";

/** CloudFront gives the origin 30 seconds; stop at 25 with a clean error. */
export const EXPORT_BUDGET_MS = 25_000;
/** 10,000 rows per page: 50 pages is far past any real snapshot. */
const MAX_PAGES = 50;

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ExportDeps = {
  invoke: (payload: Record<string, unknown>) => Promise<unknown>;
  loadRoster: () => Promise<ProfileSources["roster"]>;
  loadHousing: () => Promise<ProfileSources["housing"]>;
  loadCensus: () => Promise<ProfileSources["census"]>;
  now?: () => number;
};

class BudgetExceeded extends Error {
  name = "BudgetExceeded";
}

class ExportFailure extends Error {
  constructor(
    readonly status: 403 | 503,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "ExportFailure";
  }
}

const jsonHeaders = { ...aspireduPrivateHeaders, "Content-Type": "application/json" };

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: jsonHeaders });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function settle<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof BudgetExceeded) throw error;
    // Fixed label and error class only: source errors can carry row data.
    console.warn(`aspiredu export: ${label} source unavailable`, errorName(error));
    return null;
  }
}

export async function buildExportResponse(input: {
  callerEmail: string;
  deps: ExportDeps;
  budgetMs?: number;
}): Promise<Response> {
  const { callerEmail, deps } = input;
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const deadline = started + (input.budgetMs ?? EXPORT_BUDGET_MS);

  /** Rejects with BudgetExceeded once the shared deadline passes. */
  async function withinBudget<T>(promise: Promise<T>): Promise<T> {
    const remaining = deadline - now();
    if (remaining <= 0) throw new BudgetExceeded();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BudgetExceeded()), remaining);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadAllCourses(): Promise<unknown[]> {
    const rows: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let result: unknown;
      try {
        result = await withinBudget(deps.invoke({ action: "courses", callerEmail, cursor }));
      } catch (error) {
        if (error instanceof BudgetExceeded) throw error;
        if (isAspireduCallerDenied(error)) {
          throw new ExportFailure(403, "You do not have access to student records.");
        }
        console.error("aspiredu export: Lambda invoke failed", errorName(error));
        throw new ExportFailure(503, "Student records are unavailable right now.");
      }
      const record = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
      if (!record || record.ok !== true) {
        if (isCoachingActionUnavailable(result)) {
          throw new ExportFailure(503, "The spreadsheet download is not enabled yet.");
        }
        throw new ExportFailure(503, "Student records are unavailable right now.");
      }
      if (record.status === "awaiting_first_delivery") {
        throw new ExportFailure(503, "Awaiting the first AspireDU statistics delivery.");
      }
      if (Array.isArray(record.courses)) rows.push(...record.courses);
      const next = typeof record.cursor === "string" && record.cursor ? record.cursor : undefined;
      if (!next) return rows;
      if (seen.has(next)) throw new ExportFailure(503, "Student records are unavailable right now.");
      seen.add(next);
      cursor = next;
    }
    throw new ExportFailure(503, "Student records are unavailable right now.");
  }

  try {
    const sourcesPromise = Promise.all([
      settle("athletics roster", deps.loadRoster),
      settle("housing", deps.loadHousing),
      settle("census", deps.loadCensus),
    ]);
    // Keep a rejected sources promise from surfacing as unhandled while the
    // course loop is still running.
    sourcesPromise.catch(() => undefined);
    const rows = await loadAllCourses();
    const [roster, housing, census] = await withinBudget(sourcesPromise);
    if (deadline - now() <= 0) throw new BudgetExceeded();

    const { buffer, counts } = buildExportWorkbook(rows, { roster, housing, census });
    const filename = exportFileName(new Date(now()));
    console.info(
      JSON.stringify({
        event: "aspiredu_export",
        actor: callerEmail,
        students: counts.students,
        classes: counts.classes,
        censusMatched: counts.censusMatched,
        ms: now() - started,
      }),
    );
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...aspireduPrivateHeaders,
        "Cache-Control": "private, no-store",
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ExportFailure) return errorResponse(error.status, error.publicMessage);
    if (error instanceof BudgetExceeded) {
      console.warn(JSON.stringify({ event: "aspiredu_export_timeout", actor: callerEmail, ms: now() - started }));
      return errorResponse(503, "Building the spreadsheet took too long. Try again in a minute.");
    }
    console.error("aspiredu export failed", errorName(error));
    return errorResponse(503, "Unable to build the spreadsheet right now.");
  }
}
