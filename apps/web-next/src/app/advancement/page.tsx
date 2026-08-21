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
    href: "/advancement/chapel-naming",
    title: "Chapel Naming Opportunities",
    desc: "Student chapel naming catalog and gifts received, from Virtuous.",
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
