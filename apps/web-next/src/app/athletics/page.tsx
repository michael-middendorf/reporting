"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReportId } from "@/lib/access";
import { fetchMe } from "@/lib/api";

const CARDS: {
  href: string;
  title: string;
  desc: string;
  report: ReportId;
}[] = [
  {
    href: "/athletics/master",
    title: "Master",
    desc: "Department-wide recruiting, sector boards, applications, and prospects.",
    report: "athletics",
  },
  {
    href: "/athletics/coaching",
    title: "Coaching",
    desc: "Team dashboards for fundraising, enrollment, and academics.",
    report: "athletics-coaching",
  },
];

export default function AthleticsHubPage() {
  const [reports, setReports] = useState<ReportId[] | null>(null);
  useEffect(() => {
    fetchMe().then((me) => setReports(me.reports || []));
  }, []);
  const visible = CARDS.filter((card) => (reports || []).includes(card.report));

  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>Gyrenes</h1>
        <p>Department reports for recruiting and coaching.</p>
      </header>
      <div className="ath-hub-grid">
        {visible.map((card) => (
          <Link key={card.href} href={card.href} className="ath-hub-card">
            <h2>{card.title}</h2>
            <p>{card.desc}</p>
            <strong>Open →</strong>
          </Link>
        ))}
      </div>
    </main>
  );
}
