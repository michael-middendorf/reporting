"use client";

import Link from "next/link";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import "@/styles/mas.css";

const NAV = [
  { href: "/mas", label: "Overview" },
  { href: "/mas/gifts", label: "Gifts" },
  { href: "/mas/activity", label: "Activity" },
  { href: "/mas/methodology", label: "Methodology" },
];

export function MasShell({ children }: { children: React.ReactNode }) {
  return (
    <AccessGate report="mas">
      <div className="mas-root">
        <ReportTopBar title="MA Follow-on Giving" nav={NAV} />
        <div className="page-shell" style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
          {children}
        </div>
      </div>
    </AccessGate>
  );
}

export function MetricCard({
  href,
  label,
  value,
  context,
}: {
  href?: string;
  label: string;
  value: string | number;
  context?: string;
}) {
  const inner = (
    <>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
      <strong style={{ display: "block", fontSize: 28, marginTop: 6 }}>{value}</strong>
      {context && <div style={{ fontSize: 13, marginTop: 6, opacity: 0.75 }}>{context}</div>}
    </>
  );
  const style: React.CSSProperties = {
    display: "block",
    background: "#fff",
    border: "1px solid #e0d4c0",
    borderRadius: 16,
    padding: 16,
    textDecoration: "none",
    color: "inherit",
  };
  return href ? (
    <Link href={href} style={style}>
      {inner}
    </Link>
  ) : (
    <div style={style}>{inner}</div>
  );
}

export function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
