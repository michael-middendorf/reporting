"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { ReportId } from "@/lib/access";
import { apiFetch, fetchMe, setBearer } from "@/lib/api";

export function AccessGate({
  report,
  children,
}: {
  report: ReportId;
  children: ReactNode;
}) {
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  useEffect(() => {
    fetchMe().then((me) => {
      if (!me.authenticated) {
        window.location.href = "/";
        return;
      }
      setState(me.reports?.includes(report) ? "ok" : "denied");
    });
  }, [report]);
  if (state === "loading") return <p style={{ padding: 24 }}>Loading…</p>;
  if (state === "denied")
    return (
      <div style={{ padding: 24 }}>
        <p>You do not have access to this report.</p>
        <Link href="/">← Hub</Link>
      </div>
    );
  return <>{children}</>;
}

export function ReportTopBar({
  title,
  nav,
}: {
  title: string;
  nav: { href: string; label: string }[];
}) {
  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setBearer(null);
    window.location.href = "/";
  }
  return (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem 1.25rem",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.85rem 1.25rem",
        borderBottom: "1px solid rgba(0,0,0,0.1)",
        background: "#fff",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1rem", alignItems: "baseline" }}>
        <Link href="/" style={{ fontSize: "0.85rem", opacity: 0.7 }}>
          ← Hub
        </Link>
        <strong>{title}</strong>
        {nav.map((n) => (
          <Link key={n.href} href={n.href} style={{ fontSize: "0.9rem" }}>
            {n.label}
          </Link>
        ))}
      </div>
      <button type="button" onClick={logout} style={{ cursor: "pointer" }}>
        Sign out
      </button>
    </header>
  );
}
