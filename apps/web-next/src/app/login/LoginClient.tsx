"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, fetchMe } from "@/lib/api";
import { MAGIC_LINK_SENT_MSG, MICROSOFT_FAILED_MSG } from "@/lib/auth-messages";
import { safeLocalPath } from "@/lib/safe-local-path";
import styles from "../auth.module.css";

function microsoftStartHref(next: string): string {
  return next === "/" ? "/api/auth/microsoft" : `/api/auth/microsoft?next=${encodeURIComponent(next)}`;
}

export default function LoginClient({ microsoftEnabled = false }: { microsoftEnabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const router = useRouter();
  const next = safeLocalPath(params.get("next"));
  const microsoftFailed = params.get("microsoft") === "failed";

  useEffect(() => {
    fetchMe().then((me) => {
      if (me.authenticated) router.replace(next);
    });
  }, [router, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus({ kind: "", text: "Sending…" });
    try {
      const res = await apiFetch("/api/auth/request", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus({
        kind: "ok",
        text: data.message || MAGIC_LINK_SENT_MSG,
      });
    } catch (err) {
      setStatus({
        kind: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.card}>
      <div className={styles.eyebrow}>Ave Maria University</div>
      <h1>AMU Reporting</h1>
      <p className={styles.copy}>
        We&apos;ll email you a sign-in link. After you sign in, you&apos;ll see
        the reports you have access to.
      </p>
      {microsoftFailed && (
        <div className={`${styles.status} err`} role="alert">
          {MICROSOFT_FAILED_MSG}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="name@avemaria.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Email me a sign-in link
        </button>
      </form>
      <div className={`${styles.status} ${status.kind}`} aria-live="polite">
        {status.text}
      </div>
      {microsoftEnabled && (
        <>
          <p className={styles.divider}>or</p>
          <a className={styles.microsoftLink} href={microsoftStartHref(next)}>
            Sign in with Microsoft
          </a>
        </>
      )}
    </main>
  );
}
