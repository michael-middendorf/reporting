import { apiFetch } from "@/lib/api";
import {
  _dataFetch,
  _procAdm,
  _procCampus,
  _procPSW,
  _procSLC,
  _procWD,
} from "./process.js";

export type EnrollmentBundle = {
  generatedAt?: string;
  admissions: ReturnType<typeof _procAdm>;
  psw: ReturnType<typeof _procPSW>;
  slc: ReturnType<typeof _procSLC>;
  withdrawn: ReturnType<typeof _procWD>;
  campus: ReturnType<typeof _procCampus>;
};

export async function loadEnrollmentBundle(): Promise<EnrollmentBundle> {
  const session = await (async () => {
    const r = await apiFetch("/api/dashboard");
    if (r.status === 401) throw new Error("Authentication required");
    if (!r.ok) throw new Error(`Dashboard API ${r.status}`);
    const json = await r.json();
    if (!json.success) throw new Error(json.error || "Dashboard API failed");
    return json;
  })();
  const [admRows, pswRows, slcRows, wdRows, campusRows] = await Promise.all([
    _dataFetch("admissions", session),
    _dataFetch("psw", session),
    _dataFetch("slc", session),
    _dataFetch("withdrawn", session),
    _dataFetch("campus", session),
  ]);
  return {
    generatedAt: session.generated_at,
    admissions: _procAdm(admRows, session.generated_at),
    psw: _procPSW(pswRows),
    slc: _procSLC(slcRows),
    withdrawn: _procWD(wdRows),
    campus: _procCampus(campusRows),
  };
}

export function fmt(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString();
}

export function fmt1(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(1);
}

export function deltaPct(cur: number | null | undefined, prv: number | null | undefined) {
  if (cur == null || prv == null || !prv) return null;
  return ((cur - prv) / prv) * 100;
}
