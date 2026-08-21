import Link from "next/link";
import styles from "../home.module.css";

const REPORTS = [
  {
    href: "/advancement/overview",
    title: "Advancement Overview",
    desc: "FY 2025-26 fundraising results, MGO goals, and the Virtuous pipeline.",
  },
  {
    href: "/annunciation",
    title: "Annunciation Circle",
    desc: "Current Annunciation Circle members and new-member activity from Virtuous.",
  },
  {
    href: "/advancement/mgo-top-prospects",
    title: "MGO Top Prospects",
    desc: "FY open gift asks by MGO portfolio, with every named donor.",
  },
  {
    href: "/advancement/chapel-naming",
    title: "Chapel Naming Opportunities",
    desc: "Student chapel naming catalog and gifts received, from Virtuous.",
  },
  {
    href: "/advancement/stained-glass-windows",
    title: "Stained Glass Windows",
    desc: "Named rose, sanctuary, and nave windows with every donor, from Virtuous.",
  },
];

export default function AdvancementHubPage() {
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
        {REPORTS.map((r) => (
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
