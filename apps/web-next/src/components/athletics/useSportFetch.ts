"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type LoadState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  mfaUrl: string | null;
};

type SportFetchOptions = {
  /** Send `cache: "no-store"` (named-athlete endpoints). */
  noStore?: boolean;
  /** Treat a 401 carrying `mfaUrl` as "needs authenticator" instead of an error. */
  mfa?: boolean;
  /** Message when the response is not ok and carries no `error`. */
  fallbackError?: string;
};

type Settled = { url: string; error: string | null; mfaUrl: string | null };

/**
 * Loads JSON for `url` and reloads when `url` changes.
 *
 * The last successful `data` is kept while a new url loads. `loading`, `error`,
 * and `mfaUrl` are derived from whether the latest settled request is for the
 * current `url`, so the effect only sets state from promise callbacks and never
 * synchronously (react-hooks/set-state-in-effect).
 */
export function useSportFetch<T>(
  url: string,
  { noStore = false, mfa = false, fallbackError = "Unable to load" }: SportFetchOptions = {},
): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(url, noStore ? { cache: "no-store" } : undefined)
      .then(async (response) => {
        const body = await response.json();
        if (mfa && response.status === 401 && body.mfaUrl) {
          if (!cancelled) setSettled({ url, error: null, mfaUrl: String(body.mfaUrl) });
          return;
        }
        if (!response.ok) throw new Error(body.error || fallbackError);
        if (!cancelled) {
          setData(body as T);
          setSettled({ url, error: null, mfaUrl: null });
        }
      })
      .catch((reason) => {
        if (cancelled) return;
        setSettled({
          url,
          error: reason instanceof Error ? reason.message : String(reason),
          mfaUrl: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url, noStore, mfa, fallbackError]);

  const current = settled?.url === url ? settled : null;
  return {
    data,
    error: current?.error ?? null,
    loading: current === null,
    mfaUrl: current?.mfaUrl ?? null,
  };
}
