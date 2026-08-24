"use client";

import { FormEvent, useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import styles from "../aspiredu.module.css";

export default function AspireduMfaPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch("/aspiredu/api/mfa/status")
      .then(async (response) => {
        const body = (await response.json()) as { enrolled?: boolean; session?: boolean; error?: string };
        if (body.session) {
          window.location.replace("/aspiredu");
          return;
        }
        if (!response.ok) throw new Error(body.error || "Could not check authenticator status");
        setEnrolled(Boolean(body.enrolled));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not check authenticator status"));
  }, []);

  async function startEnroll() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/aspiredu/api/mfa/enroll", { method: "POST" });
      const body = (await response.json()) as { secret?: string; otpauth?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not start authenticator setup");
      setSecret(body.secret || "");
      setOtpauth(body.otpauth || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start authenticator setup");
    } finally {
      setBusy(false);
    }
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
          <section className={styles.panel}>
            <h1>Authenticator code</h1>
            <p>
              You are already signed in with your reporting email link. Student names and grades need a
              6-digit authenticator code as the second factor. There is no separate Cognito password.
            </p>
            {enrolled === false && !secret && (
              <p>
                <button className={styles.linkButton} type="button" disabled={busy} onClick={() => void startEnroll()}>
                  Set up authenticator
                </button>
              </p>
            )}
            {secret && (
              <p>
                Add this key in Google Authenticator, Authy, or 1Password: <strong>{secret}</strong>
                {otpauth ? (
                  <>
                    <br />
                    <span className={styles.notice}>Authenticator apps can also scan the otpauth URL from that key.</span>
                  </>
                ) : null}
              </p>
            )}
            {(enrolled || secret) && (
              <form onSubmit={(event) => void submit(event)}>
                <label>
                  6-digit code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </label>
                <p>
                  <button className={styles.linkButton} type="submit" disabled={busy}>
                    Continue
                  </button>
                </p>
              </form>
            )}
            {error ? <p>{error}</p> : null}
          </section>
        </main>
      </div>
    </AccessGate>
  );
}
