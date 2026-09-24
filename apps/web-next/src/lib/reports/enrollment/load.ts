import { apiFetch } from "@/lib/api";
import {
  _dataFetch,
  _procAdm,
  _procAME,
  _procCampus,
  _procPSW,
  _procSLC,
} from "./process.js";
import { processWithdrawals, type WithdrawnBundle } from "./withdrawals";

export type EnrollmentBundle = {
  generatedAt?: string;
  admissions: ReturnType<typeof _procAdm>;
  psw: ReturnType<typeof _procPSW>;
  slc: ReturnType<typeof _procSLC>;
  withdrawn: WithdrawnBundle;
  campus: ReturnType<typeof _procCampus>;
  ame: ReturnType<typeof _procAME>;
};

async function loadSession() {
  const r = await apiFetch("/api/dashboard");
  if (r.status === 401) throw new Error("Authentication required");
  if (!r.ok) throw new Error(`Dashboard API ${r.status}`);
  const json = await r.json();
  if (!json.success) throw new Error(json.error || "Dashboard API failed");
  return json;
}

export async function loadEnrollmentBundle(): Promise<EnrollmentBundle> {
  // Session is optional metadata (generated_at); report rows come from same-origin proxy.
  const session = await loadSession().catch((e) => {
    // Still try report proxies if dashboard metadata fails for a non-auth reason.
    if (e instanceof Error && /Authentication required|401/.test(e.message)) throw e;
    return { generated_at: undefined, report_presigned_urls: {} };
  });

  const fetchImpl: typeof fetch = (input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return apiFetch(path, init);
  };

  const [admRows, pswRows, slcRows, islcRows, wdRows, campusRows, ameRows] = await Promise.all([
    _dataFetch("admissions", session, fetchImpl),
    _dataFetch("psw", session, fetchImpl),
    _dataFetch("slc", session, fetchImpl),
    _dataFetch("islc", session, fetchImpl).catch(() => []),
    _dataFetch("withdrawn", session, fetchImpl),
    _dataFetch("campus", session, fetchImpl).catch(() => []),
    _dataFetch("ame", session, fetchImpl).catch(() => []),
  ]);
  return {
    generatedAt: session.generated_at,
    admissions: _procAdm(admRows, session.generated_at),
    psw: _procPSW(pswRows, session.generated_at),
    slc: _procSLC(slcRows, islcRows, session.generated_at),
    withdrawn: processWithdrawals(wdRows, admRows),
    campus: _procCampus(campusRows),
    ame: _procAME(ameRows, session.generated_at),
  };
}

export type OutreachRows = {
  messageRows: Record<string, unknown>[];
  interactionRows: Record<string, unknown>[];
};

/** Messages + touchpoint interactions, only needed by the Activity page. */
export async function loadOutreach(): Promise<OutreachRows> {
  const fetchImpl: typeof fetch = (input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return apiFetch(path, init);
  };
  const [messageRows, interactionRows] = await Promise.all([
    _dataFetch("messages", null, fetchImpl),
    _dataFetch("interactions", null, fetchImpl),
  ]);
  return { messageRows, interactionRows };
}

export function fmt(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString();
}

/** ISO timestamp → "Aug 21, 2026, 10:36 AM" in the viewer's local zone. */
export function fmtAsOf(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmt1(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(1);
}

export function deltaPct(cur: number | null | undefined, prv: number | null | undefined) {
  if (cur == null || prv == null || !prv) return null;
  return ((cur - prv) / prv) * 100;
}
