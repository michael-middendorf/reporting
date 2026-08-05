"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, setBearer } from "@/lib/api";
import styles from "../../auth.module.css";

function MagicInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const router = useRouter();
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/complete", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.session) setBearer(data.session);
      setStatus({ kind: "ok", text: "Signed in. Redirecting…" });
      router.replace(data.redirect || "/");
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
      setBusy(false);
    }
  }

  return (
    <main className={styles.card}>
      <div className={styles.eyebrow}>Ave Maria University</div>
      <h1>Complete sign-in</h1>
      <p className={styles.copy}>
        This extra click prevents email scanners from consuming the sign-in link before you do.
      </p>
      <button type="button" disabled={!token || busy} onClick={confirm}>
        {busy ? "Signing in…" : "Continue to reports"}
      </button>
      {!token && (
        <div className={`${styles.status} err`}>
          This sign-in link is missing its token. Request a new email from the login page.
        </div>
      )}
      <div className={`${styles.status} ${status.kind}`} aria-live="polite">
        {status.text}
      </div>
    </main>
  );
}

export default function MagicPage() {
  return (
    <Suspense fallback={<main className={styles.card}>Loading…</main>}>
      <MagicInner />
    </Suspense>
  );
}
