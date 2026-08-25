"use client";

import Link from "next/link";

export default function AthleticsHubPage() {
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>Gyrenes</h1>
        <p>Department reports for recruiting, rosters, and — soon — individual sport boards.</p>
      </header>
      <div className="ath-hub-grid">
        <Link href="/athletics/master" className="ath-hub-card">
          <h2>Master</h2>
          <p>Department-wide recruiting, sector boards, applications, prospects, and current rosters.</p>
          <strong>Open →</strong>
        </Link>
        <div className="ath-hub-card is-soon">
          <h2>Sports boards</h2>
          <p>Individual sport boards will live here.</p>
          <strong>Coming soon</strong>
        </div>
      </div>
    </main>
  );
}
