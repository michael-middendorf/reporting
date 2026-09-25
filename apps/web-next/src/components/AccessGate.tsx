"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { ReportId } from "@/lib/access";
import { apiFetch, fetchMe, setBearer } from "@/lib/api";
import {
  isDepartmentHub,
  reportCrumbs,
  reportNavActive,
  withCurrentLabel,
  type ReportNavItem,
} from "@/lib/report-nav";

export function AccessGate({
  report,
  children,
}: {
  report: ReportId | ReportId[];
  children: ReactNode;
}) {
  const neededKey = (Array.isArray(report) ? report : [report]).join(",");
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  useEffect(() => {
    const needed = neededKey.split(",") as ReportId[];
    fetchMe().then((me) => {
      if (!me.authenticated) {
        window.location.href = "/";
        return;
      }
      const allowed = me.reports || [];
      setState(needed.some((r) => allowed.includes(r)) ? "ok" : "denied");
    });
  }, [neededKey]);
  if (state === "loading") return <p className="rc-loading">Loading…</p>;
  if (state === "denied")
    return (
      <div className="rc-denied">
        <p>You do not have access to this report.</p>
        <Link href="/">Back to Reports</Link>
      </div>
    );
  return <>{children}</>;
}

export function ReportTopBar({
  title,
  nav,
  actions,
  navExtra,
  wordmark,
  currentLabel,
}: {
  title: string;
  nav: ReportNavItem[];
  actions?: ReactNode;
  navExtra?: ReactNode;
  wordmark?: ReactNode;
  /** Replaces the last breadcrumb label (e.g. a record name instead of an opaque id segment). */
  currentLabel?: string;
}) {
  const pathname = usePathname() || "";
  const crumbs = withCurrentLabel(reportCrumbs(pathname), currentLabel);
  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setBearer(null);
    window.location.href = "/";
  }
  const showTabs = !isDepartmentHub(pathname) && (nav.length > 0 || navExtra != null);
  return (
    <div className="rc">
      <header className="rc-header">
        <div className="rc-brand">
          <Link href="/" className="rc-wordmark" title="All reports" aria-label="All reports">
            {wordmark ?? "AMU"}
          </Link>
          <span className="rc-sep" aria-hidden="true">
            |
          </span>
          <nav className="rc-crumbs" aria-label="Breadcrumb">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              return (
                <span key={`${crumb.href}-${crumb.label}`} className="rc-crumb-item">
                  {i > 0 && (
                    <span className="rc-crumb-sep" aria-hidden="true">
                      /
                    </span>
                  )}
                  {last ? (
                    <span className="rc-crumb is-current" aria-current="page">
                      {crumb.label}
                    </span>
                  ) : (
                    <Link href={crumb.href} className="rc-crumb">
                      {crumb.label}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
        </div>
        <div className="rc-actions">
          {actions}
          <button type="button" className="rc-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      {showTabs && (
        <nav className="rc-tabs" aria-label={`${title} sections`}>
          {nav.map((n) => {
            const active = reportNavActive(n, nav, pathname);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={active ? "rc-tab is-active" : "rc-tab"}
                aria-current={active ? "page" : undefined}
              >
                {n.label}
              </Link>
            );
          })}
          {navExtra != null && (
            <>
              <span className="rc-tabs-spacer" />
              <div className="rc-tabs-extra">{navExtra}</div>
            </>
          )}
        </nav>
      )}
    </div>
  );
}
