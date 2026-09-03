"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AccessGate } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";

function groupedSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function safeCoachingNext(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value.startsWith("/athletics/coaching")) return "/athletics/coaching";
  if (value.startsWith("//") || value.includes("://")) return "/athletics/coaching";
  return value;
}

export default function CoachingMfaPage() {
  const next = useMemo(() => {
    if (typeof window === "undefined") return "/athletics/coaching";
    return safeCoachingNext(new URLSearchParams(window.location.search).get("next"));
  }, []);
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
      const response = await apiFetch("/api/athletics-coaching/mfa/enroll", { method: "POST" });
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
    apiFetch("/api/athletics-coaching/mfa/status")
      .then(async (response) => {
        const body = (await response.json()) as { enrolled?: boolean; session?: boolean; error?: string };
        if (body.session) {
          window.location.replace(next);
          return;
        }
        if (!response.ok) throw new Error(body.error || "Could not check authenticator status");
        const already = Boolean(body.enrolled);
        setEnrolled(already);
        if (!already) void startEnroll();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not check authenticator status"));
  }, [next]);

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
      const response = await apiFetch("/api/athletics-coaching/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "That code is not valid");
      window.location.replace(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That code is not valid");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccessGate report="athletics-coaching">
      <main className="ath-page">
        <section className="ath-coach-band ath-mfa">
          <h1>Authenticator code</h1>
          <p>
            You are already signed in with your reporting email link. Named athlete academics need a
            6-digit code from an authenticator app.
          </p>
          {secret ? (
            <div className="ath-mfa-key">
              <p>Add this key in Google Authenticator, Authy, or 1Password</p>
              <p className="ath-mfa-secret">{groupedSecret(secret)}</p>
              <button className="ath-text-btn" type="button" onClick={() => void copyKey()}>
                {copied ? "Copied" : "Copy key"}
              </button>
            </div>
          ) : null}
          {(enrolled || secret) && (
            <form className="ath-mfa-form" onSubmit={(event) => void submit(event)}>
              <label htmlFor="coaching-totp">6-digit code</label>
              <input
                id="coaching-totp"
                className="ath-mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
              <p>
                <button className="ath-primary" type="submit" disabled={busy || code.length !== 6}>
                  Continue
                </button>
              </p>
            </form>
          )}
          {error ? <p className="ath-alert ath-alert-error">{error}</p> : null}
        </section>
      </main>
    </AccessGate>
  );
}
