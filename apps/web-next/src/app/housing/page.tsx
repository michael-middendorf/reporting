"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { legacyHousingDest } from "@/lib/reports/housing/legacy-route";
import styles from "../home.module.css";

const subscribeNoop = () => () => {};

const CARDS = [
  {
    href: "/housing/capacity-quest",
    title: "Capacity Quest",
    desc: "Fall 2026 occupancy and fill. Spring 2027 and Fall 2027 are on the same dashboard.",
  },
  {
    href: "/housing/residence-life",
    title: "Residence Life",
    desc: "Hall assignments, move-ins, and room verification.",
  },
];

export default function HousingHubPage() {
  const router = useRouter();
  const search = useSyncExternalStore(subscribeNoop, () => window.location.search, () => null);
  const dest = search === null ? null : legacyHousingDest(search);

  useEffect(() => {
    if (dest) router.replace(dest);
  }, [dest, router]);

  if (search === null || dest) return <p className="rc-loading">Loading…</p>;

  return (
    <main className={styles.hub}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Reporting</div>
          <h1>Housing</h1>
          <p className={styles.sub}>Capacity planning and residence life for Ave Maria University.</p>
        </div>
      </header>
      <div className={styles.grid}>
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className={styles.card}>
            <h2>{card.title}</h2>
            <p>{card.desc}</p>
            <span className={styles.open}>Open →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
