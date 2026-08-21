"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReportId } from "@/lib/access";
import { fetchMe } from "@/lib/api";
import styles from "../home.module.css";

const REPORTS: {
  href: string;
  title: string;
  desc: string;
  report: ReportId;
}[] = [
  {
    href: "/advancement/overview",
    title: "Advancement Overview",
    desc: "FY 2025-26 fundraising results, MGO goals, and the Virtuous pipeline.",
    report: "advancement",
  },
  {
    href: "/annunciation",
    title: "Annunciation Circle",
    desc: "Current Annunciation Circle members and new-member activity from Virtuous.",
    report: "annunciation",
  },
  {
    href: "/advancement/mgo-top-prospects",
    title: "MGO Top Prospects",
    desc: "FY open gift asks by MGO portfolio, with every named donor.",
    report: "advancement",
  },
  {
    href: "/advancement/chapel-naming",
    title: "Chapel Naming Opportunities",
    desc: "Student chapel naming catalog and gifts received, from Virtuous.",
    report: "chapel",
  },
  {
    href: "/advancement/stained-glass-windows",
    title: "Stained Glass Windows",
    desc: "Named rose, sanctuary, and nave windows with every donor, from Virtuous.",
    report: "chapel",
  },
];

export default function AdvancementHubPage() {
  const [reports, setReports] = useState<ReportId[] | null>(null);
  useEffect(() => {
    fetchMe().then((me) => setReports(me.reports || []));
  }, []);
  const visible = REPORTS.filter((r) => (reports || []).includes(r.report));

  return (
    <main className={styles.hub}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Reporting</div>
          <h1>Advancement</h1>
          <p className={styles.sub}>
            Giving and donor reports for University Advancement.
          </p>
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
      </div>
    </main>
  );
}
