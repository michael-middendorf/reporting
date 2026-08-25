"use client";

import Link from "next/link";

export default function AthleticsHubPage() {
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>Gyrenes</h1>
        <p>Department reports for recruiting.</p>
      </header>
      <div className="ath-hub-grid">
        <Link href="/athletics/master" className="ath-hub-card">
          <h2>Master</h2>
          <p>Department-wide recruiting, sector boards, applications, and prospects.</p>
          <strong>Open →</strong>
        </Link>
      </div>
    </main>
  );
}
