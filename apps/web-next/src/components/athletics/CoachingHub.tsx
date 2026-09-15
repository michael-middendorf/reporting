"use client";

import Link from "next/link";
import type { SportDef } from "@/lib/reports/athletics-coaching/sports";

export function CoachingDenied({ message }: { message?: string }) {
  return (
    <div className="ath-state">
      <p>{message || "You do not have access to this report."}</p>
      <Link href="/athletics">Back to Athletics</Link>
    </div>
  );
}

export function TeamPicker({
  sports,
  title,
  description,
  sportHref,
  sportBlurb,
}: {
  sports: SportDef[];
  title: string;
  description: string;
  sportHref?: (key: string) => string;
  sportBlurb?: string;
}) {
  const ordered = [...sports].sort((a, b) => a.label.localeCompare(b.label));
  const hrefFor = sportHref || ((key: string) => `/athletics/coaching/${key}`);
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {ordered.length ? (
        <div className="ath-hub-grid">
          {ordered.map((sport) => (
            <Link key={sport.key} href={hrefFor(sport.key)} className="ath-hub-card">
              <h2>{sport.label}</h2>
              <p>{sportBlurb || "Team dashboard for fundraising, enrollment, and academics."}</p>
              <strong>Open →</strong>
            </Link>
          ))}
        </div>
      ) : (
        <p className="ath-empty">No teams are assigned to this account yet.</p>
      )}
    </main>
  );
}

export function formatCount(count: number | null): string {
  if (count === null) return "n/a";
  return String(count);
}

export function formatMoney(amount: number | null): string {
  if (amount === null) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatAsOf(asOf: string | null): string {
  if (!asOf) return "";
  return `As of ${asOf.slice(0, 10)}`;
}

export function formatWhen(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleDateString();
}
