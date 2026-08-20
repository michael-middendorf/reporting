"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, fetchMe } from "@/lib/api";
import styles from "../auth.module.css";

export default function LoginClient() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    fetchMe().then((me) => {
      if (me.authenticated) router.replace(params.get("next") || "/");
    });
  }, [router, params]);

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
        text: data.message || "Check your email for a sign-in link.",
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
        Sign-in links are emailed to approved addresses. After you sign in,
        you&apos;ll see the reports you have access to.
      </p>
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
    </main>
  );
}
