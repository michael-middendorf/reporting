"use client";

import Link from "next/link";
import gyreneWordmark from "@/assets/athletics/gyrene-wordmark.png";

export default function AthleticsMasterHubPage() {
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <img className="ath-hub-wordmark" src={gyreneWordmark.src} alt="" width={220} height={55} />
        <h1>Master</h1>
        <p>Department-wide recruiting, sector boards, applications, and prospects.</p>
      </header>
      <div className="ath-hub-grid">
        <Link href="/athletics/master/recruiting" className="ath-hub-card">
          <h2>Recruiting</h2>
          <p>Sector boards, athlete applications, and prospects / inquiries.</p>
          <strong>Open →</strong>
        </Link>
      </div>
    </main>
  );
}
