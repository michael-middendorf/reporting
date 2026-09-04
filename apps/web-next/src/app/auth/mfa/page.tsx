"use client";

import { FormEvent, useEffect, useState } from "react";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { apiFetch, setBearer } from "@/lib/api";
import styles from "../../auth.module.css";

function groupedSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export default function AuthMfaPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/auth/mfa/enroll", { method: "POST" });
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
    apiFetch("/api/auth/mfa/status")
      .then(async (response) => {
        const body = (await response.json()) as {
          enrolled?: boolean;
          hasPasskey?: boolean;
          error?: string;
        };
        if (response.status === 401) {
          window.location.replace("/");
          return;
        }
        if (!response.ok) throw new Error(body.error || "Could not check authenticator status");
        const already = Boolean(body.enrolled);
        setEnrolled(already);
        setHasPasskey(Boolean(body.hasPasskey));
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

  function finishSignIn(session?: string) {
    if (session) setBearer(session);
    window.location.replace("/");
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as { error?: string; session?: string };
      if (!response.ok) throw new Error(body.error || "That code is not valid");
      finishSignIn(body.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That code is not valid");
      setBusy(false);
    }
  }

  async function usePasskey() {
    setBusy(true);
    setError("");
    try {
      const optionsRes = await apiFetch("/api/auth/passkey/auth-options", { method: "POST" });
      const optionsBody = (await optionsRes.json()) as { optionsJSON?: PublicKeyCredentialRequestOptionsJSON; error?: string };
      if (!optionsRes.ok || !optionsBody.optionsJSON) {
        throw new Error(optionsBody.error || "Could not start passkey sign-in");
      }
      const assertion = await startAuthentication({ optionsJSON: optionsBody.optionsJSON });
      const verifyRes = await apiFetch("/api/auth/passkey/auth-verify", {
        method: "POST",
        body: JSON.stringify(assertion),
      });
      const verifyBody = (await verifyRes.json()) as { error?: string; session?: string };
      if (!verifyRes.ok) throw new Error(verifyBody.error || "Could not verify that passkey");
      finishSignIn(verifyBody.session);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        setError("Passkey sign-in was cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Could not verify that passkey");
      }
      setBusy(false);
    }
  }

  return (
    <main className={styles.card}>
      <div className={styles.eyebrow}>Ave Maria University</div>
      <h1>Confirm it is you</h1>
      {enrolled === null && !error ? (
        <p className={styles.copy}>Checking authenticator…</p>
      ) : null}
      {secret ? (
        <>
          <p className={styles.copy}>
            Add this key in Google Authenticator, Authy, or 1Password. After you sign in, you can add a
            passkey on Security so the next sign-in can skip the 6-digit code.
          </p>
          <div className={styles.keyBox}>
            <p className={styles.keyLabel}>Authenticator key</p>
            <p className={styles.keyValue}>{groupedSecret(secret)}</p>
            <button className={styles.secondary} type="button" onClick={() => void copyKey()}>
              {copied ? "Copied" : "Copy key"}
            </button>
          </div>
        </>
      ) : enrolled ? (
        <p className={styles.copy}>
          {hasPasskey
            ? "Use your passkey, or enter a 6-digit authenticator code."
            : "Enter a 6-digit code from your authenticator app. After sign-in you can set up a passkey on Security."}
        </p>
      ) : null}
      {hasPasskey && enrolled ? (
        <button type="button" disabled={busy} onClick={() => void usePasskey()}>
          {busy ? "Waiting for passkey…" : "Use passkey"}
        </button>
      ) : null}
      {(enrolled || secret) && (
        <form onSubmit={(event) => void submitCode(event)}>
          {hasPasskey && enrolled ? <p className={styles.divider}>or enter a 6-digit code</p> : null}
          <label htmlFor="reporting-totp">6-digit code</label>
          <input
            id="reporting-totp"
            className={styles.codeInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
          <button type="submit" disabled={busy || code.length !== 6} className={hasPasskey ? styles.secondary : undefined}>
            Continue
          </button>
        </form>
      )}
      {error ? (
        <div className={`${styles.status} err`} aria-live="polite">
          {error}
        </div>
      ) : null}
    </main>
  );
}
