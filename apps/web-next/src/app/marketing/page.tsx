import Link from "next/link";
import styles from "../home.module.css";

export default function MarketingPage() {
  return <main className={styles.hub}><header className={styles.header}><div><div className={styles.eyebrow}>Reporting</div><h1>Marketing</h1><p className={styles.sub}>Audience and formation reporting for University marketing.</p></div></header><div className={styles.grid}><Link href="/marketing/pursuit-of-wisdom" className={styles.card}><h2>Pursuit of Wisdom</h2><p>Website reach, course engagement, audience match, and public YouTube trailer metrics.</p><span className={styles.open}>Open →</span></Link></div></main>;
}
