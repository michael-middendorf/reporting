"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ReportId } from "@/lib/access";
import { apiFetch, fetchMe, setBearer } from "@/lib/api";
import {
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
  if (ok === "loading") return <p className="enrollment-root" style={{ padding: 24 }}>Loading…</p>;
  if (ok === "no")
    return (
      <div className="enrollment-root" style={{ padding: 24 }}>
        <p>You do not have access to this report.</p>
        <Link href="/">← Hub</Link>
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

const TABS = [
  { href: "/enrollment", label: "Overview", match: (p: string) => p === "/enrollment" },
  { href: "/enrollment/admissions", label: "Admissions" },
  { href: "/enrollment/events", label: "Events" },
  { href: "/enrollment/withdrawals", label: "Withdrawals" },
] as const;

export function EnrollmentChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { cycle, setCycle, data, refresh, loading } = useEnrollment();

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setBearer(null);
    window.location.href = "/";
  }

  return (
    <>
      <header className="gh">
        <div className="gh-left">
          <Link href="/" className="gh-wordmark">
            AMU
          </Link>
          <span className="gh-sep">|</span>
          <span className="gh-report">Admissions Enrollment</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="gh-date">
            {loading ? "Loading…" : data?.generatedAt ? `As of ${data.generatedAt}` : ""}
          </span>
          <button type="button" className="back-btn" onClick={refresh}>
            Refresh
          </button>
          <button type="button" className="back-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <nav className="tab-nav" aria-label="Enrollment sections">
        {TABS.map((t) => {
          const active =
            "match" in t && t.match
              ? t.match(pathname)
              : pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`tab-btn${active ? " active" : ""}`}
            >
              {t.label}
            </Link>
          );
        })}
        <span style={{ flex: 1 }} />
        <label className="term-filter">
          <span className="term-filter-lbl">Compare</span>
          <select
            className="term-select"
            value={cycle}
            onChange={(e) => setCycle(e.target.value as "fa26" | "fa27")}
            aria-label="Select enrollment term to compare"
          >
            <option value="fa27">Fall 2027</option>
            <option value="fa26">Fall 2026</option>
          </select>
        </label>
      </nav>
      {children}
    </>
  );
}
