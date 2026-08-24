"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, fetchMe, setBearer } from "@/lib/api";
import { filterOptions, recordMatches, STAGE_COLORS } from "@/lib/reports/athletics/normalize";
import {
  type AthleticsPayload,
  type AthleticsRecord,
  type FilterKey,
  type FilterState,
} from "@/lib/reports/athletics/types";

const EMPTY_FILTERS: FilterState = {
  sport: [],
  position: [],
  gender: [],
  term: [],
  sector: [],
  stage: [],
  athleteStatus: [],
  applicationStatus: [],
  workflowBin: [],
  withdrawn: [],
  purchasedList: [],
  riskRating: [],
  readyToOffer: [],
  signed: [],
};

const FILTER_LABELS: Record<FilterKey, string> = {
  sport: "Sport",
  position: "Position",
  gender: "Gender",
  term: "Application Term",
  sector: "Sector",
  stage: "Applicant Stage",
  athleteStatus: "Athlete Status",
  applicationStatus: "Application Status",
  workflowBin: "Workflow / Stage",
  withdrawn: "Withdrawn",
  purchasedList: "Purchased List",
  riskRating: "Risk Rating",
  readyToOffer: "Ready to Offer",
  signed: "Signed",
};

const DIMENSION_FILTERS: FilterKey[] = [
  "sport",
  "gender",
  "term",
  "sector",
  "stage",
  "athleteStatus",
  "applicationStatus",
  "position",
  "riskRating",
  "purchasedList",
];

type AthleticsContextValue = {
  applications: AthleticsRecord[];
  prospects: AthleticsRecord[];
  allRecords: AthleticsRecord[];
  filteredApplications: AthleticsRecord[];
  filteredProspects: AthleticsRecord[];
  filteredAll: AthleticsRecord[];
  generatedAt: string | null;
  filters: FilterState;
  options: Record<FilterKey, string[]>;
  activeFilterCount: number;
  setFilter: (key: FilterKey, value: string, checked: boolean) => void;
  clearFilters: () => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const AthleticsContext = createContext<AthleticsContextValue | null>(null);

export function useAthletics() {
  const context = useContext(AthleticsContext);
  if (!context) throw new Error("useAthletics must be used within AthleticsProvider");
  return context;
}

export function AthleticsProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [payload, setPayload] = useState<AthleticsPayload | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetchMe().then((me) => {
      if (!me.authenticated) {
        window.location.href = "/login";
        return;
      }
      setAccess(me.reports?.includes("athletics") ? "allowed" : "denied");
    });
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    let cancelled = false;
    apiFetch("/api/athletics-data")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load Athletics data");
        if (!cancelled) setPayload(body as AthleticsPayload);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [access, tick]);

  const applications = useMemo(() => payload?.applications || [], [payload]);
  const prospects = useMemo(() => payload?.prospects || [], [payload]);
  const allRecords = useMemo(() => [...applications, ...prospects], [applications, prospects]);
  const filteredApplications = useMemo(
    () => applications.filter((record) => recordMatches(record, filters)),
    [applications, filters],
  );
  const filteredProspects = useMemo(
    () => prospects.filter((record) => recordMatches(record, filters)),
    [prospects, filters],
  );
  const filteredAll = useMemo(
    () => allRecords.filter((record) => recordMatches(record, filters)),
    [allRecords, filters],
  );
  const options = useMemo(() => filterOptions(allRecords), [allRecords]);
  const activeFilterCount = Object.values(filters).reduce((total, selected) => total + selected.length, 0);

  const value = useMemo<AthleticsContextValue>(() => ({
    applications,
    prospects,
    allRecords,
    filteredApplications,
    filteredProspects,
    filteredAll,
    generatedAt: payload?.generatedAt || null,
    filters,
    options,
    activeFilterCount,
    setFilter: (key, item, checked) => setFilters((current) => ({
      ...current,
      [key]: checked
        ? [...new Set([...current[key], item])]
        : current[key].filter((candidate) => candidate !== item),
    })),
    clearFilters: () => setFilters(EMPTY_FILTERS),
    loading,
    error,
    refresh: () => {
      setLoading(true);
      setError(null);
      setTick((current) => current + 1);
    },
  }), [applications, prospects, allRecords, filteredApplications, filteredProspects, filteredAll,
    payload?.generatedAt, filters, options, activeFilterCount, loading, error]);

  if (access === "loading") return <div className="ath-state">Checking access…</div>;
  if (access === "denied") return <div className="ath-state"><p>You do not have access to Athletics Master.</p><Link href="/">← Hub</Link></div>;
  return <AthleticsContext.Provider value={value}>{children}</AthleticsContext.Provider>;
}

const NAV = [
  { href: "/athletics", label: "Overview", exact: true },
  { href: "/athletics/sectors", label: "Sector Boards" },
  { href: "/athletics/applications", label: "Applications" },
  { href: "/athletics/prospects", label: "Prospects / Inquiries" },
];

export function AthleticsChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { generatedAt, refresh, loading } = useAthletics();

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setBearer(null);
    window.location.href = "/login";
  }

  return (
    <div className="ath-root">
      <header className="ath-header">
        <div className="ath-brand"><Link href="/">AMU</Link><span>/</span><strong>Athletics Master</strong></div>
        <div className="ath-actions">
          <span className="ath-asof">{loading ? "Loading…" : generatedAt ? `Updated ${new Date(generatedAt).toLocaleString()}` : ""}</span>
          <button type="button" onClick={refresh}>Refresh</button>
          <button type="button" onClick={logout}>Sign out</button>
        </div>
      </header>
      <nav className="ath-nav" aria-label="Athletics Master sections">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} className={active ? "active" : ""}>{item.label}</Link>;
        })}
      </nav>
      <AthleticsFilters />
      {children}
    </div>
  );
}

function AthleticsFilters() {
  const { filters, options, setFilter, clearFilters, activeFilterCount } = useAthletics();
  return (
    <section className="ath-filter-panel" aria-label="Global Athletics filters">
      <div className="ath-filter-heading">
        <div><strong>Global filters</strong><span>Selections apply to every page, metric, table, and export.</span></div>
        <div><button type="button" onClick={clearFilters} disabled={!activeFilterCount}>Reset all</button></div>
      </div>
      <div className="ath-filter-grid">
        {DIMENSION_FILTERS.map((key) => (
          <details key={key} name="athletics-filter" className="ath-filter-group">
            <summary>{FILTER_LABELS[key]}{filters[key].length ? <b>{filters[key].length}</b> : null}</summary>
            <FilterOptions filterKey={key} filters={filters} options={options} setFilter={setFilter} />
          </details>
        ))}
      </div>
      {activeFilterCount ? (
        <div className="ath-active-filters" aria-label="Active filters">
          <span>Active:</span>
          {(Object.entries(filters) as [FilterKey, string[]][]).flatMap(([key, selected]) =>
            selected.map((item) => (
              <button type="button" key={`${key}-${item}`} onClick={() => setFilter(key, item, false)} title={`Remove ${FILTER_LABELS[key]} filter`}>
                <small>{FILTER_LABELS[key]}</small>{item}<b aria-hidden="true">×</b>
              </button>
            )),
          )}
        </div>
      ) : null}
    </section>
  );
}

function FilterOptions({ filterKey, filters, options, setFilter }: {
  filterKey: FilterKey;
  filters: FilterState;
  options: Record<FilterKey, string[]>;
  setFilter: (key: FilterKey, value: string, checked: boolean) => void;
}) {
  return (
    <div className="ath-filter-options">
      {options[filterKey].map((item) => (
        <label key={item}>
          <input type="checkbox" checked={filters[filterKey].includes(item)} onChange={(event) => setFilter(filterKey, item, event.target.checked)} />
          {filterKey === "stage" && item in STAGE_COLORS ? (
            <i className="ath-stage-swatch" style={{ background: STAGE_COLORS[item as keyof typeof STAGE_COLORS] }} />
          ) : null}
          <span>{item}</span>
        </label>
      ))}
      {!options[filterKey].length && <span className="ath-muted">No values in Slate</span>}
    </div>
  );
}

export function AthleticsPage({ title, description, children, actions }: { title: string; description: string; children: ReactNode; actions?: ReactNode }) {
  const { loading, error } = useAthletics();
  return (
    <main className="ath-page">
      <div className="ath-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions}</div>
      {error && <div className="ath-alert ath-alert-error"><strong>Unable to load Athletics data.</strong><span>{error}</span></div>}
      {loading && <div className="ath-loading">Loading Slate data…</div>}
      {!loading && !error && children}
    </main>
  );
}
