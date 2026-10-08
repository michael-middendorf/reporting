"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch, getBearer, setBearer } from "@/lib/api";
import type { ManualKpi, RiskItem } from "@/lib/cyber/register";
import { formatDeltaMagnitude, formatUnitValue, type CyberDataResponse, type CyberKpi, type Rag } from "@/lib/cyber/shape";

export type CyberLoad<T> =
  | { kind: "loading" }
  | { kind: "ok"; data: T }
  | { kind: "reauth" }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

/** Same-origin start of the existing Microsoft sign-in (app/api/auth/microsoft/route.ts). */
export function microsoftSignInHref(returnPath: string): string {
  return `/api/auth/microsoft?next=${encodeURIComponent(returnPath)}`;
}

/**
 * Fetch a Cybersecurity API. 403 reauth_microsoft first drops a tab-scoped
 * Bearer (a magic-link token there would shadow a fresh Microsoft cookie
 * session) and retries once on the cookie. 503 is "nothing published yet".
 */
export function useCyberResource<T>(path: string): CyberLoad<T> & { reload: () => void } {
  const [state, setState] = useState<CyberLoad<T>>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        let res = await apiFetch(path);
        if (res.status === 403 && getBearer()) {
          const body = (await res.clone().json().catch(() => null)) as { error?: string } | null;
          if (body?.error === "reauth_microsoft") {
            setBearer(null);
            res = await apiFetch(path);
          }
        }
        const body = (await res.json().catch(() => null)) as
          | (T & { error?: string; message?: string })
          | null;
        if (cancelled) return;
        if (res.status === 401) {
          window.location.href = "/";
          return;
        }
        if (res.status === 403 && body?.error === "reauth_microsoft") {
          setState({ kind: "reauth" });
        } else if (res.status === 503) {
          setState({ kind: "empty", message: body?.message || "No data published yet." });
        } else if (!res.ok || !body) {
          setState({ kind: "error", message: body?.message || body?.error || `Request failed (${res.status})` });
        } else {
          setState({ kind: "ok", data: body });
        }
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Unable to reach the server." });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { ...state, reload };
}

export type RegisterData = { risks: RiskItem[]; kpis: ManualKpi[] };

export function useCyberData() {
  return useCyberResource<CyberDataResponse>("/api/cybersecurity-data");
}

export function useCyberRegister() {
  return useCyberResource<RegisterData>("/api/cybersecurity-register");
}

export function ReauthPanel() {
  const pathname = usePathname() || "/cybersecurity";
  return (
    <div className="cy-reauth" role="alert">
      <strong>Sign in with Microsoft to continue</strong>
      Cybersecurity opens only with a Microsoft sign-in from the last 12 hours. Email-link
      sessions cannot open it.
      <div>
        <a
          className="cy-btn"
          href={microsoftSignInHref(pathname)}
          onClick={() => setBearer(null)}
        >
          Sign in with Microsoft
        </a>
      </div>
    </div>
  );
}

export function EmptyState({ message, planned }: { message?: string; planned?: string[] }) {
  return (
    <div className="cy-empty">
      <strong>No data published yet</strong>
      {message && message !== "No data published yet." ? message : "The security publisher has not written a snapshot for this space yet."}
      {planned && planned.length > 0 && (
        <>
          <div style={{ marginTop: 10 }}>Planned measures:</div>
          <ul>
            {planned.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="cy-error" role="alert">
      {message}
    </div>
  );
}

/** Loading / reauth / empty / error wrapper. Renders children(data) on ok. */
export function CyberLoadView<T>({
  load,
  planned,
  children,
}: {
  load: CyberLoad<T>;
  planned?: string[];
  children: (data: T) => ReactNode;
}) {
  if (load.kind === "loading") return <p className="rc-loading">Loading…</p>;
  if (load.kind === "reauth") return <ReauthPanel />;
  if (load.kind === "empty") return <EmptyState message={load.message} planned={planned} />;
  if (load.kind === "error") return <ErrorState message={load.message} />;
  return <>{children(load.data)}</>;
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatValue(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "n/a";
  return typeof v === "number" ? NUMBER.format(v) : v;
}

export function formatAsOf(iso: string | null | undefined): string {
  if (!iso) return "date unknown";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "date unknown";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

const RAG_LABEL: Record<Rag, string> = { red: "Red", amber: "Amber", green: "Green", grey: "No target" };

export function RagPill({ rag }: { rag: Rag | null | undefined }) {
  const r = rag ?? "grey";
  return <span className={`cy-pill is-${r}`}>{RAG_LABEL[r]}</span>;
}

function Delta({ kpi }: { kpi: CyberKpi }) {
  if (kpi.delta === null || kpi.delta === undefined) return <span>No prior month</span>;
  if (kpi.delta === 0) return <span>No change</span>;
  const up = kpi.delta > 0;
  const better = kpi.lowerIsBetter ? !up : up;
  return (
    <span className={`cy-delta ${better ? "is-better" : "is-worse"}`}>
      {up ? "▲" : "▼"} {formatDeltaMagnitude(kpi.delta, kpi.unit)} vs last month
    </span>
  );
}

export function KpiTile({ kpi }: { kpi: CyberKpi }) {
  const status = kpi.status ?? "ok";
  const rag: Rag = status === "ok" ? (kpi.rag ?? "grey") : "grey";
  const value =
    status === "not_licensed" ? "Not licensed" : status === "missing" ? "Missing" : formatUnitValue(kpi.value, kpi.unit);
  return (
    <article className={`cy-tile is-${rag}`}>
      <div className="cy-tile-label">{kpi.label}</div>
      <div className="cy-tile-value">{value}</div>
      <div className="cy-tile-row">
        <RagPill rag={rag} />
        <span>Target {kpi.target || "not set"}</span>
      </div>
      <div className="cy-tile-row">
        <Delta kpi={kpi} />
      </div>
      <div className="cy-tile-meta">
        {kpi.source} · {status === "stale" ? "STALE, " : ""}as of {formatAsOf(kpi.asOf)}
      </div>
      {kpi.note && <div className="cy-tile-meta">{kpi.note}</div>}
    </article>
  );
}

/** Manual KPI from the register, rendered with the same tile. */
export function manualToKpi(m: ManualKpi): CyberKpi {
  return {
    id: m.id,
    label: m.label,
    section: m.section,
    value: m.value,
    unit: m.unit || undefined,
    target: m.target || null,
    rag: m.rag,
    delta: null,
    source: "Manual entry",
    asOf: m.asOf ?? m.updatedAt,
    status: "ok",
    note: m.notes || null,
  };
}

export function KpiGrid({ kpis }: { kpis: CyberKpi[] }) {
  return (
    <div className="cy-grid">
      {kpis.map((k) => (
        <KpiTile key={k.id} kpi={k} />
      ))}
    </div>
  );
}

export function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h1>{title}</h1>
      {sub && <p className="cy-sub">{sub}</p>}
    </>
  );
}
