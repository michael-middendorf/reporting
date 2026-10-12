"use client";

import Link from "next/link";
import { Suspense } from "react";
import type { ReportId } from "@/lib/access";
import { apiFetch, setBearer } from "@/lib/api";
import { useCurrentSession } from "@/components/SessionProvider";
import LoginClient from "./login/LoginClient";
import styles from "./home.module.css";

const REPORTS: {
  id: ReportId;
  href: string;
  title: string;
  desc: string;
}[] = [
  {
    id: "enrollment",
    href: "/enrollment",
    title: "Enrollment",
    desc: "Admissions funnel, decisions, SLC, PSW, visits, and withdrawals.",
  },
  {
    id: "census",
    href: "/census",
    title: "Census",
    desc: "Official fall census: headcount, FTE, UG profile, and retention.",
  },
  {
    id: "athletics",
    href: "/athletics",
    title: "Athletics",
    desc: "Gyrene recruiting and coaching dashboards.",
  },
  {
    id: "housing",
    href: "/housing",
    title: "Housing",
    desc: "Capacity Quest and Residence Life: occupancy, floor maps, move-ins, and verification.",
  },
  {
    id: "institute",
    href: "/institute",
    title: "The Institute",
    desc: "Admissions pipeline: applicant funnel, pace vs goals, and recruiting.",
  },
  {
    id: "advancement",
    href: "/advancement",
    title: "Advancement",
    desc: "Giving, donor, and MA points reports for University Advancement.",
  },
  {
    id: "marketing",
    href: "/marketing",
    title: "Marketing",
    desc: "Audience, course engagement, and Pursuit of Wisdom formation reporting.",
  },
  {
    id: "aspiredu",
    href: "/aspiredu",
    title: "Academic Affairs",
    desc: "Search students or download every student record.",
  },
  {
    // DST-3015: Academic Affairs. Aggregate counts only.
    id: "majors",
    href: "/majors",
    title: "Majors and Minors",
    desc: "Accepted applicants by major, current majors and minors by class, and five-year trends.",
  },
  {
    // Business Office list, hub admins, and athletics leadership (access.ts).
    id: "business-office",
    href: "/business-office",
    title: "Business Office",
    desc: "Athletics revenue, expense, and net by team, fiscal year to date.",
  },
  {
    // Strict report: only the STRICT_REPORTS list in access.ts sees this card.
    id: "cybersecurity",
    href: "/cybersecurity",
    title: "Cybersecurity",
    desc: "Board risk register, security KPIs, and the GLBA board packet.",
  },
];

export default function HomeClient({ microsoftEnabled }: { microsoftEnabled: boolean }) {
  const me = useCurrentSession();
  const email = me?.authenticated ? me.email || "" : "";
  const allowed = me?.authenticated ? me.reports || [] : [];
  const ready = me !== null;

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setBearer(null);
    window.location.href = "/";
  }

  if (!ready) {
    return (
      <div className={styles.loading}>
        <p>Loading…</p>
      </div>
    );
  }

  if (!email) {
    return (
      <Suspense
        fallback={
          <div className={styles.loading}>
            <p>Loading…</p>
          </div>
        }
      >
        <LoginClient microsoftEnabled={microsoftEnabled} />
      </Suspense>
    );
  }

  const visible = REPORTS.filter((r) => {
    if (allowed.includes(r.id)) return true;
    // Chapel-only and Points-only users still land on the Advancement folder
    // (cards inside are filtered to what they can open).
    if (
      r.id === "advancement" &&
      (allowed.includes("chapel") ||
        allowed.includes("points") ||
        allowed.includes("portfolios") ||
        allowed.includes("mgo-analysis"))
    ) {
      return true;
    }
    if (r.id === "athletics" && allowed.includes("athletics-coaching")) {
      return true;
    }
    return false;
  });

  return (
    <main className={styles.hub}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Ave Maria University</div>
          <h1>Reporting</h1>
          <p className={styles.sub}>
            Internal dashboards for admissions, housing, and advancement.
          </p>
        </div>
        <div className={styles.user}>
          {email && <span>{email}</span>}
          {allowed.includes("aspiredu") && (
            <Link href="/settings/security" className={styles.security}>
              Security
            </Link>
          )}
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <div className={styles.grid}>
        {visible.map((r) => (
          <Link key={r.href} href={r.href} className={styles.card}>
            <h2>{r.title}</h2>
            <p>{r.desc}</p>
            <span className={styles.open}>Open →</span>
          </Link>
        ))}
        {visible.length === 0 && (
          <p className={styles.sub}>No reports are available for your account.</p>
        )}
      </div>
    </main>
  );
}
