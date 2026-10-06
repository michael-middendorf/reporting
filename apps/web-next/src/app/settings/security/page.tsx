"use client";

import { useCallback, useEffect, useState } from "react";
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import styles from "./security.module.css";

type Passkey = { id: string; deviceName: string; createdAt: number };

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad";
  if (/Mac/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "Security key";
}

function formatWhen(value: number) {
  if (!value) return "";
  return new Date(value * 1000).toLocaleString();
}

async function fetchSecurityState(): Promise<{ enrolled: boolean; passkeys: Passkey[] }> {
  const [totpRes, passkeyRes] = await Promise.all([
    apiFetch("/aspiredu/api/mfa/status", { cache: "no-store" }),
    apiFetch("/api/auth/passkey", { cache: "no-store" }),
  ]);
  const totpBody = (await totpRes.json()) as { enrolled?: boolean; error?: string };
  const passkeyBody = (await passkeyRes.json()) as { passkeys?: Passkey[]; error?: string };
  if (!totpRes.ok) throw new Error(totpBody.error || "Could not load authenticator status");
  if (!passkeyRes.ok) throw new Error(passkeyBody.error || "Could not load passkeys");
  return { enrolled: Boolean(totpBody.enrolled), passkeys: passkeyBody.passkeys || [] };
}

export default function SecurityPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // State is set only in the promise callbacks so the mount effect never sets
  // state synchronously. error starts empty on mount, and the add/remove
  // handlers clear it themselves before calling load().
  const load = useCallback(
    () =>
      fetchSecurityState()
        .then(({ enrolled: nextEnrolled, passkeys: nextPasskeys }) => {
          setEnrolled(nextEnrolled);
          setPasskeys(nextPasskeys);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Could not load security settings");
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const optionsRes = await apiFetch("/api/auth/passkey/register-options", { method: "POST" });
      const optionsBody = (await optionsRes.json()) as {
        optionsJSON?: PublicKeyCredentialCreationOptionsJSON;
        error?: string;
      };
      if (!optionsRes.ok || !optionsBody.optionsJSON) {
        throw new Error(optionsBody.error || "Could not start passkey setup");
      }
      const attResp = await startRegistration({ optionsJSON: optionsBody.optionsJSON });
      const verifyRes = await apiFetch("/api/auth/passkey/register-verify", {
        method: "POST",
        body: JSON.stringify({ ...attResp, deviceName: guessDeviceName() }),
      });
      const verifyBody = (await verifyRes.json()) as { error?: string };
      if (!verifyRes.ok) throw new Error(verifyBody.error || "Could not save that passkey");
      setStatus("Passkey saved. Next sign-in can use it instead of the 6-digit code.");
      await load();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") setError("Passkey setup was cancelled.");
      else setError(err instanceof Error ? err.message : "Could not save that passkey");
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(credentialId: string) {
    if (!window.confirm("Remove this passkey?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/auth/passkey", {
        method: "DELETE",
        body: JSON.stringify({ credentialId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not delete that passkey");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete that passkey");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Security" nav={[]} />
        <main className={styles.content}>
          <h1>Security</h1>
          <p className={styles.lead}>
            A passkey replaces the 6-digit authenticator code at sign-in. You still click the email
            link first.
          </p>
          <section className={styles.panel}>
            <h2>Authenticator app</h2>
            {enrolled === null ? <p>Loading…</p> : (
              <p className={styles.meta}>{enrolled ? "Enrolled" : "Not enrolled"}</p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Passkeys</h2>
            <p className={styles.meta}>Touch ID, Face ID, or a security key.</p>
            <p>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void addPasskey()}>
                Set up a passkey
              </button>
            </p>
            {passkeys.length === 0 ? <p className={styles.meta}>No passkeys yet.</p> : (
              <ul className={styles.list}>
                {passkeys.map((passkey) => (
                  <li key={passkey.id}>
                    <div>
                      <strong>{passkey.deviceName || "Passkey"}</strong>
                      <span>{formatWhen(passkey.createdAt)}</span>
                    </div>
                    <button
                      className={`${styles.button} ${styles.secondary}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void removePasskey(passkey.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {status ? <p className={styles.ok}>{status}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </main>
      </div>
    </AccessGate>
  );
}
