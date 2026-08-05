"use client";

import Link from "next/link";
import { useEnrollment } from "./EnrollmentProvider";
import { deltaPct, fmt } from "@/lib/reports/enrollment/load";

function Delta({ cur, prv }: { cur?: number | null; prv?: number | null }) {
  const d = deltaPct(cur ?? null, prv ?? null);
  if (d == null) return null;
  if (Math.abs(d) < 0.05) return <span className="delta-flat">≈ Flat</span>;
  const up = d > 0;
  return (
    <span className={up ? "delta-up" : "delta-dn"}>
      {up ? "↑" : "↓"} {up ? "+" : ""}
      {d.toFixed(1)}%
    </span>
  );
}

export default function EnrollmentHubPage() {
  const { data, error, loading, cycle } = useEnrollment();
  if (loading) return <div className="view active"><p>Loading dashboard data…</p></div>;
  if (error) return <div className="view active"><p>Error: {error}</p></div>;
  if (!data) return null;

  const cur = cycle === "fa26" ? data.admissions.fa26 : data.admissions.fa27;
  const prv = cycle === "fa26" ? data.admissions.fa25 : data.admissions.fa26;
  const label = cycle === "fa26" ? "FA26" : "FA27";
  const vs = cycle === "fa26" ? "FA25" : "FA26";

  const cards = [
    {
      href: "/enrollment/admissions",
      title: `${label} Enrollment YOY`,
      desc: `Funnel and profile for ${label} vs ${vs}.`,
      kpis: [
        { n: fmt(cur.deposits), l: "Net deposits" },
        { n: fmt(cur.accepted), l: "Accepted" },
        { n: fmt(cur.created), l: "Apps" },
      ],
      accent: "var(--gold)",
    },
    {
      href: "/enrollment/slc",
      title: "Summer Leadership Conference",
      desc: "Applied, accepted, and registered by class year.",
      kpis: [
        { n: fmt(data.slc.registered), l: "Registered" },
        { n: fmt(data.slc.accepted), l: "Accepted" },
        { n: fmt(data.slc.applied), l: "Applied" },
      ],
      accent: "var(--teal)",
    },
    {
      href: "/enrollment/campus",
      title: "AME / Campus Visits",
      desc: "Visit registration outcomes.",
      kpis: [
        { n: fmt(data.campus.attended), l: "Attended" },
        { n: fmt(data.campus.registered), l: "Registered" },
        { n: fmt(data.campus.total), l: "Total" },
      ],
      accent: "var(--purple)",
    },
    {
      href: "/enrollment/psw",
      title: "President’s Scholarship Weekend",
      desc: "Attendance by term.",
      kpis: Object.entries(data.psw)
        .slice(0, 3)
        .map(([term, v]) => ({
          n: `${(v as { att: number }).att}/${(v as { total: number }).total}`,
          l: term || "Term",
        })),
      accent: "var(--blue-mid)",
    },
    {
      href: "/enrollment/withdrawals",
      title: "Withdrawals",
      desc: "Withdrawn applications by type and counselor.",
      kpis: [
        { n: fmt(data.withdrawn.total), l: "Total" },
        { n: fmt(data.withdrawn.postAccept), l: "Post-accept" },
        { n: fmt(data.withdrawn.noDecision), l: "No decision" },
      ],
      accent: "var(--red)",
    },
    {
      href: "/enrollment/activity",
      title: "Counselor Activity",
      desc: "Funnel by admissions counselor assignment.",
      kpis: [
        { n: fmt(cur.deposits), l: "Net deposits" },
        { n: fmt(cur.accepted), l: "Accepted" },
        { n: Object.keys(cur.byAC || {}).length.toString(), l: "Counselors" },
      ],
      accent: "var(--blue)",
    },
  ];

  return (
    <div className="view active">
      <div className="hub-intro">
        <h1 className="hub-h1">Admissions Hub</h1>
        <p className="hub-sub">
          {label} view · vs {vs} · net deposits{" "}
          <Delta cur={cur.deposits} prv={prv.deposits} />
        </p>
      </div>
      <div className="g2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="card"
            style={{ ["--c" as string]: c.accent }}
          >
            <div className="card-head">
              <div className="card-title">{c.title}</div>
            </div>
            <div className="card-desc">{c.desc}</div>
            <div className={`krow k3`}>
              {c.kpis.map((k) => (
                <div key={k.l} className="ks">
                  <div className="kn">{k.n}</div>
                  <div className="kl">{k.l}</div>
                </div>
              ))}
            </div>
            <div className="card-foot">
              <span className="open">Open Report →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
