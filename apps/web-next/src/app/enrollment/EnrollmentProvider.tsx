"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ReportTopBar } from "@/components/AccessGate";
import type { ReportId } from "@/lib/access";
import { fetchMe } from "@/lib/api";
import { ENROLLMENT_NAV } from "@/lib/report-nav";
import {
  fmtAsOf,
  loadEnrollmentBundle,
  type EnrollmentBundle,
} from "@/lib/reports/enrollment/load";
import "@/styles/enrollment.css";

type Ctx = {
  data: EnrollmentBundle | null;
  error: string | null;
  loading: boolean;
  cycle: "fa26" | "fa27";
  setCycle: (c: "fa26" | "fa27") => void;
  refresh: () => void;
};

const EnrollmentCtx = createContext<Ctx | null>(null);

export function useEnrollment() {
  const v = useContext(EnrollmentCtx);
  if (!v) throw new Error("useEnrollment outside provider");
  return v;
}

function Gate({
  report,
  children,
}: {
  report: ReportId;
  children: ReactNode;
}) {
  const [ok, setOk] = useState<"loading" | "yes" | "no">("loading");
  useEffect(() => {
    fetchMe().then((me) => {
      if (!me.authenticated) {
        window.location.href = "/";
        return;
      }
      setOk(me.reports?.includes(report) ? "yes" : "no");
    });
  }, [report]);
  if (ok === "loading") return <p className="rc-loading">Loading…</p>;
  if (ok === "no")
    return (
      <div className="rc-denied">
        <p>You do not have access to this report.</p>
        <Link href="/">Back to Hub</Link>
      </div>
    );
  return <>{children}</>;
}

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<EnrollmentBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<"fa26" | "fa27">("fa27");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadEnrollmentBundle()
      .then((b) => {
        if (!cancelled) setData(b);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const value = useMemo(
    () => ({
      data,
      error,
      loading,
      cycle,
      setCycle,
      refresh: () => setTick((t) => t + 1),
    }),
    [data, error, loading, cycle],
  );

  return (
    <Gate report="enrollment">
      <EnrollmentCtx.Provider value={value}>
        <div className="enrollment-root" data-cycle={cycle}>
          {children}
        </div>
      </EnrollmentCtx.Provider>
    </Gate>
  );
}

export function EnrollmentChrome({ children }: { children: ReactNode }) {
  const { cycle, setCycle, data, refresh, loading } = useEnrollment();

  return (
    <>
      <ReportTopBar
        title="Admissions Enrollment"
        nav={ENROLLMENT_NAV}
        actions={
          <>
            <span className="rc-meta">
              {loading ? "Loading…" : data?.generatedAt ? `As of ${fmtAsOf(data.generatedAt)}` : ""}
            </span>
            <button type="button" className="rc-btn" onClick={refresh}>
              Refresh
            </button>
          </>
        }
        navExtra={
          <label className="term-filter">
            <span className="term-filter-lbl">Select term</span>
            <select
              className="term-select"
              value={cycle}
              onChange={(e) => setCycle(e.target.value as "fa26" | "fa27")}
              aria-label="Select enrollment term"
            >
              <option value="fa27">Fall 2027</option>
              <option value="fa26">Fall 2026</option>
            </select>
          </label>
        }
      />
      {children}
    </>
  );
}
