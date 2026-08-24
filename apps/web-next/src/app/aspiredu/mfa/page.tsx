"use client";

import { FormEvent, useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import styles from "../aspiredu.module.css";

function groupedSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export default function AspireduMfaPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/aspiredu/api/mfa/enroll", { method: "POST" });
      const body = (await response.json()) as { secret?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not start authenticator setup");
      setSecret(body.secret || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start authenticator setup");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    apiFetch("/aspiredu/api/mfa/status")
      .then(async (response) => {
        const body = (await response.json()) as { enrolled?: boolean; session?: boolean; error?: string };
        if (body.session) {
          window.location.replace("/aspiredu");
          return;
        }
        if (!response.ok) throw new Error(body.error || "Could not check authenticator status");
        const already = Boolean(body.enrolled);
        setEnrolled(already);
        if (!already) void startEnroll();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not check authenticator status"));
  }, []);

  async function copyKey() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/aspiredu/api/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "That code is not valid");
      window.location.replace("/aspiredu/provisional/athletics");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That code is not valid");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <section className={`${styles.panel} ${styles.mfaPanel}`}>
            <h1>Authenticator code</h1>
            <p className={styles.mfaLead}>
              You are already signed in with your reporting email link. Student names and grades need a
              6-digit code from an authenticator app.
            </p>
            {secret ? (
              <div className={styles.keyBox}>
                <p className={styles.keyLabel}>Add this key in Google Authenticator, Authy, or 1Password</p>
                <p className={styles.keyValue}>{groupedSecret(secret)}</p>
                <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => void copyKey()}>
                  {copied ? "Copied" : "Copy key"}
                </button>
              </div>
            ) : null}
            {(enrolled || secret) && (
              <form className={styles.mfaForm} onSubmit={(event) => void submit(event)}>
                <label htmlFor="aspiredu-totp">6-digit code</label>
                <input
                  id="aspiredu-totp"
                  className={styles.codeInput}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
                <p>
                  <button className={styles.button} type="submit" disabled={busy || code.length !== 6}>
                    Continue
                  </button>
                </p>
              </form>
            )}
            {error ? <p className={styles.error}>{error}</p> : null}
          </section>
        </main>
      </div>
    </AccessGate>
  );
}
