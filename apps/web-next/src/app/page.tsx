"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import type { ReportId } from "@/lib/access";
import { apiFetch, fetchMe, setBearer } from "@/lib/api";
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
    id: "housing",
    href: "/housing",
    title: "Housing",
    desc: "Residence occupancy, floor maps, move-ins, and verification for the current session.",
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
    desc: "Annunciation Circle and other advancement reports.",
  },
  {
    id: "points",
    href: "/points",
    title: "MA Points",
    desc: "Activity points, tiers, and leaderboard for scoped MAs.",
  },
  {
    id: "aspiredu",
    href: "/aspiredu",
    title: "AspireDU Student Risk",
    desc: "Daily risk trends and MFA-protected student-level follow-up.",
  },
];

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [allowed, setAllowed] = useState<ReportId[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchMe().then((me) => {
      if (me.authenticated) {
        setEmail(me.email || "");
        setAllowed(me.reports || []);
      }
      setReady(true);
    });
  }, []);

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
        <LoginClient />
      </Suspense>
    );
  }

  const visible = REPORTS.filter((r) => allowed.includes(r.id));

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
