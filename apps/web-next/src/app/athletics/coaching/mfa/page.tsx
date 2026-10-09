"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AccessGate } from "@/components/AccessGate";
import { MicrosoftAuthenticatorInstructions } from "@/components/MicrosoftAuthenticatorInstructions";
import { AuthenticatorSetup } from "@/components/AuthenticatorQr";
import { apiFetch } from "@/lib/api";

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
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/athletics-coaching/mfa/enroll", { method: "POST" });
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
            Named athlete academics require an additional 6-digit code from Microsoft Authenticator.
          </p>
          {secret ? (
            <div className="ath-mfa-key">
              <MicrosoftAuthenticatorInstructions setup hasQr={Boolean(otpauth)} />
              <AuthenticatorSetup
                secret={secret}
                otpauth={otpauth}
                secretClassName="ath-mfa-secret"
                buttonClassName="ath-text-btn"
                copied={copied}
                onCopy={() => void copyKey()}
              />
            </div>
          ) : null}
          {enrolled && !secret ? <MicrosoftAuthenticatorInstructions setup={false} /> : null}
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
                  Verify
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
