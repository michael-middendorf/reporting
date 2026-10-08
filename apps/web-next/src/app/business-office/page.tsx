import Link from "next/link";
import styles from "../home.module.css";

export default function BusinessOfficePage() {
  return (
    <main className={styles.hub}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Reporting</div>
          <h1>Business Office</h1>
          <p className={styles.sub}>Departmental finance reports from the general ledger.</p>
        </div>
      </header>
      <div className={styles.grid}>
        <Link href="/business-office/athletics" className={styles.card}>
          <h2>Athletics</h2>
          <p>Unrestricted revenue, expense, and net by team, fiscal year to date.</p>
          <span className={styles.open}>Open →</span>
        </Link>
      </div>
    </main>
  );
}
