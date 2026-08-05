"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { ReportId } from "@/lib/access";
import { apiFetch, fetchMe, setBearer } from "@/lib/api";

type Props = {
  report: ReportId;
  title: string;
  children: ReactNode;
  className?: string;
  nav?: { href: string; label: string }[];
  /** When false, only ACL-gate (legacy report supplies its own header). */
  chrome?: boolean;
};

/**
 * Client gate + optional chrome for report pages: auth, ACL, hub link, sign-out.
 */
export function ReportShell({
  report,
  title,
  children,
  className,
  nav,
  chrome = true,
}: Props) {
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  const [email, setEmail] = useState("");

  useEffect(() => {
    fetchMe().then((me) => {
      if (!me.authenticated) {
        window.location.href = "/login";
        return;
      }
      if (!me.reports?.includes(report)) {
        setState("denied");
        return;
      }
      setEmail(me.email || "");
      setState("ok");
    });
  }, [report]);

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setBearer(null);
    window.location.href = "/login";
  }

  if (state === "loading") {
    return (
      <div className={className} style={{ padding: "2rem", fontFamily: "system-ui" }}>
        Loading…
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className={className} style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <p>You do not have access to this report.</p>
        <p>
          <Link href="/">← Back to hub</Link>
        </p>
      </div>
    );
  }

  if (!chrome) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem 1.25rem",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1rem", alignItems: "baseline" }}>
          <Link href="/" style={{ fontSize: "0.85rem", opacity: 0.75 }}>
            ← Hub
          </Link>
          <strong>{title}</strong>
          {nav?.map((n) => (
            <Link key={n.href} href={n.href} style={{ fontSize: "0.9rem" }}>
              {n.label}
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.85rem" }}>
          {email && <span>{email}</span>}
          <button type="button" onClick={logout} style={{ cursor: "pointer" }}>
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
