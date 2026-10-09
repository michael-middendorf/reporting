"use client";
import { useSyncExternalStore } from "react";
import styles from "@/app/auth.module.css";
function subscribeSearch(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
export function SsoLogin({ enabled, href, returnParam = "from" }: { enabled: boolean; href: string; returnParam?: string }) {
  const search = useSyncExternalStore(subscribeSearch, () => window.location.search, () => "");
  const query = new URLSearchParams(search);
  const path = query.get("callbackUrl") ?? query.get("from") ?? query.get("next") ?? query.get("returnTo");
  const safe = path?.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(path);
  const destination = safe ? href + "?" + returnParam + "=" + encodeURIComponent(path!) : href;
  const failed = query.get("microsoft") === "failed" || !!query.get("error");
  return <main className={styles.card}>
    <div className={styles.eyebrow}>Ave Maria University</div>
    <h1>AMU Reporting</h1>
    <p className={styles.copy}>Use your regular Ave Maria University staff Microsoft account.</p>
    {failed && <p role="alert" className={`${styles.status} err`}>Microsoft sign-in did not complete. Try again with your regular University staff account, or contact IT.</p>}
    {enabled ? <a className={styles.microsoftLink} href={destination}>Sign in with Microsoft</a>
      : <p role="alert" className={`${styles.status} err`}>Microsoft sign-in is temporarily unavailable. Please contact IT.</p>}
  </main>;
}
