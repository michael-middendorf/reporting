"use client";

import Link from "next/link";

export default function AthleticsMasterHubPage() {
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>Master</h1>
        <p>Department-wide recruiting and giving reports.</p>
      </header>
      <div className="ath-hub-grid">
        <Link href="/athletics/master/recruiting" className="ath-hub-card">
          <h2>Recruiting</h2>
          <p>Sector boards, athlete applications, and prospects / inquiries.</p>
          <strong>Open →</strong>
        </Link>
        <Link href="/athletics/master/giving" className="ath-hub-card">
          <h2>Giving</h2>
          <p>Department gift list and fund totals from Virtuous.</p>
          <strong>Open →</strong>
        </Link>
      </div>
    </main>
  );
}
