"use client";

import Link from "next/link";

export default function AthleticsMasterHubPage() {
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>Master</h1>
        <p>Choose recruiting or current rosters.</p>
      </header>
      <div className="ath-hub-grid">
        <Link href="/athletics/master/recruiting" className="ath-hub-card">
          <h2>Recruiting</h2>
          <p>Sector boards, athlete applications, and prospects / inquiries.</p>
          <strong>Open →</strong>
        </Link>
        <Link href="/athletics/master/rosters" className="ath-hub-card">
          <h2>Current Rosters</h2>
          <p>LOI-signed or deposited varsity recruits, grouped by sport.</p>
          <strong>Open →</strong>
        </Link>
      </div>
    </main>
  );
}
