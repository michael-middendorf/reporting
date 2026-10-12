"use client";

import { FormEvent, useEffect, useState } from "react";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { MicrosoftAuthenticatorInstructions } from "@/components/MicrosoftAuthenticatorInstructions";
import { AuthenticatorSetup } from "@/components/AuthenticatorQr";
import { apiFetch, setBearer } from "@/lib/api";
import { carriedReturnPath, withNextParam } from "@/lib/safe-local-path";
import styles from "../../auth.module.css";

/**
 * This page's own ?next= (set by the Microsoft callback), re-validated.
 * Null when missing, unsafe, "/" or a sign-in page. Read at call time from
 * the address bar so the page needs no Suspense boundary.
 */
function returnPathFromAddressBar(): string | null {
  if (typeof window === "undefined") return null;
  return carriedReturnPath(new URLSearchParams(window.location.search).get("next"));
}

export default function AuthMfaPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/auth/mfa/enroll", { method: "POST" });
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

  useEffect(() => {
    apiFetch("/api/auth/mfa/status")
      .then(async (response) => {
        const body = (await response.json()) as {
          enrolled?: boolean;
          hasPasskey?: boolean;
          error?: string;
        };
        if (response.status === 401) {
          // No (or an expired) mfa_pending cookie: start over at sign-in,
          // keeping the return path when there is one.
          const next = returnPathFromAddressBar();
          window.location.replace(next ? withNextParam("/login", next) : "/");
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

  /** Verify endpoint URL carrying this page's validated ?next= for the server. */
  function verifyUrl(path: string) {
    return withNextParam(path, returnPathFromAddressBar());
  }

  /**
   * Only called after the server verified the second factor and minted the
   * session. Goes to the server's re-validated redirect, re-checked here, or
   * "/" when there is none.
   */
  function finishSignIn(session?: string, redirect?: string) {
    if (session) setBearer(session);
    window.location.replace(carriedReturnPath(redirect) ?? "/");
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(verifyUrl("/api/auth/mfa/verify"), {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as { error?: string; session?: string; redirect?: string };
      if (!response.ok) throw new Error(body.error || "That code is not valid");
      finishSignIn(body.session, body.redirect);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That code is not valid");
      setBusy(false);
    }
  }

  async function signInWithPasskey() {
    setBusy(true);
    setError("");
    try {
      const optionsRes = await apiFetch("/api/auth/passkey/auth-options", { method: "POST" });
      const optionsBody = (await optionsRes.json()) as { optionsJSON?: PublicKeyCredentialRequestOptionsJSON; error?: string };
      if (!optionsRes.ok || !optionsBody.optionsJSON) {
        throw new Error(optionsBody.error || "Could not start passkey sign-in");
      }
      const assertion = await startAuthentication({ optionsJSON: optionsBody.optionsJSON });
      const verifyRes = await apiFetch(verifyUrl("/api/auth/passkey/auth-verify"), {
        method: "POST",
        body: JSON.stringify(assertion),
      });
      const verifyBody = (await verifyRes.json()) as { error?: string; session?: string; redirect?: string };
      if (!verifyRes.ok) throw new Error(verifyBody.error || "Could not verify that passkey");
      finishSignIn(verifyBody.session, verifyBody.redirect);
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
          <MicrosoftAuthenticatorInstructions setup hasQr={Boolean(otpauth)} />
          <div className={styles.keyBox}>
            <AuthenticatorSetup
              secret={secret}
              otpauth={otpauth}
              label="Authenticator key"
              labelClassName={styles.keyLabel}
              secretClassName={styles.keyValue}
              buttonClassName={styles.secondary}
              copied={copied}
              onCopy={() => void copyKey()}
            />
          </div>
        </>
      ) : enrolled ? (
        <>
          <MicrosoftAuthenticatorInstructions setup={false} />
          {hasPasskey && <p className={styles.copy}>You can also use your existing passkey.</p>}
        </>
      ) : null}
      {hasPasskey && enrolled ? (
        <button type="button" disabled={busy} onClick={() => void signInWithPasskey()}>
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
            Verify
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
