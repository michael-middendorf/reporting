"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, setBearer } from "@/lib/api";
import styles from "../../auth.module.css";

/** Survives React Strict Mode remount. useRef does not. */
const inFlight = new Map<string, Promise<void>>();
const completed = new Set<string>();
const lastRedirect = new Map<string, string>();

function friendlyMagicError(raw: string) {
  if (/expired/i.test(raw)) {
    return "This sign-in link has expired. Sign in at AMU Reporting to get a new one.";
  }
  if (/already been used/i.test(raw)) {
    return "This sign-in link has already been used. Sign in at AMU Reporting if you need another.";
  }
  return raw;
}

function tokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!raw) return null;
  const t = new URLSearchParams(raw).get("token");
  return t?.trim() ? t : null;
}

function goTo(dest: string, router: { replace: (href: string) => void }) {
  if (dest === "/auth/mfa") {
    window.location.replace(dest);
    return;
  }
  router.replace(dest);
}

function MagicInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const confirm = useCallback(
    async (magicToken: string) => {
      if (!magicToken) return;

      if (completed.has(magicToken)) {
        goTo(lastRedirect.get(magicToken) || "/", router);
        return;
      }

      const existing = inFlight.get(magicToken);
      if (existing) {
        await existing;
        if (completed.has(magicToken)) {
          goTo(lastRedirect.get(magicToken) || "/", router);
        }
        return;
      }

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      inFlight.set(magicToken, gate);

      setBusy(true);
      setStatus({ kind: "", text: "" });
      try {
        const res = await apiFetch("/api/auth/complete", {
          method: "POST",
          body: JSON.stringify({ token: magicToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.mfaRequired) {
          setBearer(null);
          const dest = data.redirect || "/auth/mfa";
          completed.add(magicToken);
          lastRedirect.set(magicToken, dest);
          window.location.replace(dest);
          return;
        }
        if (data.session) setBearer(data.session);
        const dest = data.redirect || "/";
        completed.add(magicToken);
        lastRedirect.set(magicToken, dest);
        setStatus({ kind: "ok", text: "Signed in. Redirecting…" });
        router.replace(dest);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        setStatus({ kind: "err", text: friendlyMagicError(raw) });
        setBusy(false);
      } finally {
        inFlight.delete(magicToken);
        release();
      }
    },
    [router],
  );

  useEffect(() => {
    const hashToken = tokenFromHash();
    if (hashToken) {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${search}`);
    }
    const resolvedToken = (hashToken || params.get("token") || "").trim() || null;
    setToken(resolvedToken);
    setResolved(true);
    if (!resolvedToken) return;

    // GET must not consume the nonce. Auto-POST once the tab is visible so
    // scanners that only GET (or prefetch a hidden document) do not burn it.
    const start = () => {
      if (startedRef.current) return;
      if (document.visibilityState !== "visible") return;
      startedRef.current = true;
      void confirm(resolvedToken);
    };

    start();
    if (startedRef.current) return;

    const onVisibility = () => {
      start();
      if (startedRef.current) {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [params, confirm]);

  const missingToken = resolved && !token;
  const failed = status.kind === "err";
  const showHubCta = missingToken || failed;

  return (
    <main className={styles.card}>
      <div className={styles.eyebrow}>Ave Maria University</div>
      <h1>AMU Reporting</h1>
      {!failed && !missingToken && <p className={styles.copy}>Signing in…</p>}
      {failed && (
        <button type="button" disabled={busy} onClick={() => token && confirm(token)}>
          {busy ? "Signing in…" : "Try again"}
        </button>
      )}
      {missingToken && (
        <div className={`${styles.status} err`}>
          This sign-in link is missing its token. Request a new one from the sign-in page.
        </div>
      )}
      <div className={`${styles.status} ${status.kind}`} aria-live="polite">
        {status.text}
      </div>
      {showHubCta && (
        <a className={styles.hubLink} href="/">
          Sign in at AMU Reporting
        </a>
      )}
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
