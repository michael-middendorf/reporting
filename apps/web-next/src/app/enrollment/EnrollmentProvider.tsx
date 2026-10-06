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
import {
  ENROLLMENT_CYCLES,
  cycleMeta,
  isEnrollmentCycle,
  type EnrollmentCycle,
} from "@/lib/reports/enrollment/cycle";
import "@/styles/enrollment.css";

type Ctx = {
  data: EnrollmentBundle | null;
  error: string | null;
  loading: boolean;
  cycle: EnrollmentCycle;
  setCycle: (c: EnrollmentCycle) => void;
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
  const [cycle, setCycle] = useState<EnrollmentCycle>("fa27");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // loading starts true and refresh() resets loading/error before bumping tick,
    // so the effect only sets state from the promise callbacks.
    let cancelled = false;
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
      refresh: () => {
        setLoading(true);
        setError(null);
        setTick((t) => t + 1);
      },
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
              onChange={(e) => {
                const v = e.target.value;
                if (isEnrollmentCycle(v)) setCycle(v);
              }}
              aria-label="Select enrollment term"
            >
              {ENROLLMENT_CYCLES.map((c) => (
                <option key={c} value={c}>
                  {cycleMeta(c).option}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {children}
    </>
  );
}
