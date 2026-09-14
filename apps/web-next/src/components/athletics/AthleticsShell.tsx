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
import { ReportTopBar } from "@/components/AccessGate";
import { apiFetch, fetchMe } from "@/lib/api";
import { filterOptions, recordMatches, STAGE_COLORS } from "@/lib/reports/athletics/normalize";
import {
  type AthleticsPayload,
  type AthleticsRecord,
  type FilterKey,
  type FilterState,
} from "@/lib/reports/athletics/types";
import { ATHLETICS_COACHING_NAV, ATHLETICS_RECRUITING_NAV } from "@/lib/report-nav";
import gyreneG from "@/assets/athletics/gyrene-g.png";
import gyreneG2x from "@/assets/athletics/gyrene-g@2x.png";
import gyreneG3x from "@/assets/athletics/gyrene-g@3x.png";

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

const CORE_FILTERS: FilterKey[] = [
  "sport",
  "gender",
  "term",
  "sector",
  "stage",
  "athleteStatus",
  "applicationStatus",
  "riskRating",
  "purchasedList",
];

function filterKeysForPath(pathname: string): FilterKey[] {
  if (pathname.startsWith("/athletics/master/recruiting/sectors")) {
    return CORE_FILTERS.filter((key) => key !== "sector" && key !== "stage");
  }
  if (pathname.startsWith("/athletics/master/recruiting/prospects")) {
    return CORE_FILTERS.filter((key) => key !== "sector" && key !== "stage" && key !== "applicationStatus");
  }
  return CORE_FILTERS;
}

function ignoredFilterKeys(pathname: string): FilterKey[] {
  if (pathname.startsWith("/athletics/master/recruiting/sectors")) return ["sector"];
  if (pathname.startsWith("/athletics/master/recruiting/prospects")) return ["sector", "stage", "applicationStatus"];
  return [];
}

function withPosition(keys: FilterKey[], sportSelected: boolean): FilterKey[] {
  if (!sportSelected) return keys;
  const sportIndex = keys.indexOf("sport");
  if (sportIndex < 0) return keys;
  return [...keys.slice(0, sportIndex + 1), "position", ...keys.slice(sportIndex + 1)];
}

function maskFilters(filters: FilterState, ignored: FilterKey[]): FilterState {
  if (!ignored.length) return filters;
  return Object.fromEntries(
    (Object.entries(filters) as [FilterKey, string[]][]).map(([key, selected]) => [
      key,
      ignored.includes(key) ? [] : selected,
    ]),
  ) as FilterState;
}

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
  const pathname = usePathname();
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [canLoadRecruiting, setCanLoadRecruiting] = useState(false);
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
      const reports = me.reports || [];
      const hasAthletics = reports.includes("athletics");
      const hasCoaching = reports.includes("athletics-coaching");
      const hasAdvancement = reports.includes("advancement");
      const path = pathname || "";
      const coachingPath = path.startsWith("/athletics/coaching");
      const givingPath = path === "/athletics/giving" || path.startsWith("/athletics/giving/");
      const hubPath = path === "/athletics";
      const allowed = coachingPath
        ? hasCoaching
        : givingPath
          ? hasCoaching || hasAdvancement
          : hubPath
            ? hasAthletics || hasCoaching
            : hasAthletics;
      setCanLoadRecruiting(hasAthletics);
      setAccess(allowed ? "allowed" : "denied");
    });
  }, [pathname]);

  useEffect(() => {
    if (access !== "allowed") return;
    if (!canLoadRecruiting) {
      setLoading(false);
      return;
    }
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
  }, [access, canLoadRecruiting, tick]);

  const applications = useMemo(() => payload?.applications || [], [payload]);
  const prospects = useMemo(() => payload?.prospects || [], [payload]);
  const allRecords = useMemo(() => [...applications, ...prospects], [applications, prospects]);
  const pageFilters = useMemo(
    () => maskFilters(filters, ignoredFilterKeys(pathname)),
    [filters, pathname],
  );
  const filteredApplications = useMemo(
    () => applications.filter((record) => recordMatches(record, pageFilters)),
    [applications, pageFilters],
  );
  const filteredProspects = useMemo(
    () => prospects.filter((record) => recordMatches(record, pageFilters)),
    [prospects, pageFilters],
  );
  const filteredAll = useMemo(
    () => allRecords.filter((record) => recordMatches(record, pageFilters)),
    [allRecords, pageFilters],
  );
  const options = useMemo(() => {
    const next = filterOptions(allRecords);
    if (filters.sport.length) {
      next.position = [...new Set(
        allRecords
          .filter((record) => filters.sport.includes(record.sport) && record.position)
          .map((record) => record.position),
      )].sort((left, right) => left.localeCompare(right));
    }
    return next;
  }, [allRecords, filters.sport]);
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
    setFilter: (key, item, checked) => setFilters((current) => {
      const selected = checked
        ? [...new Set([...current[key], item])]
        : current[key].filter((candidate) => candidate !== item);
      const next = { ...current, [key]: selected };
      if (key === "sport") {
        if (!next.sport.length) next.position = [];
        else {
          const allowed = new Set(
            allRecords
              .filter((record) => next.sport.includes(record.sport) && record.position)
              .map((record) => record.position),
          );
          next.position = next.position.filter((position) => allowed.has(position));
        }
      }
      return next;
    }),
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
  if (access === "denied") {
    const coachingPath = (pathname || "").startsWith("/athletics/coaching");
    const givingPath = (pathname || "").startsWith("/athletics/giving");
    return (
      <div className="ath-state">
        <p>
          {coachingPath
            ? "You do not have access to the coaching dashboard."
            : givingPath
              ? "You do not have access to Athletics Giving."
              : "You do not have access to Athletics Master."}
        </p>
        <Link href="/">← Hub</Link>
      </div>
    );
  }
  return <AthleticsContext.Provider value={value}>{children}</AthleticsContext.Provider>;
}

export function AthleticsChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { generatedAt, refresh, loading } = useAthletics();
  const isHub = pathname === "/athletics" || pathname === "/athletics/master";
  const isRecruiting = pathname === "/athletics/master/recruiting" || pathname.startsWith("/athletics/master/recruiting/");
  const isCoaching = (pathname || "").startsWith("/athletics/coaching");
  const isGiving = (pathname || "").startsWith("/athletics/giving");
  const [coachingLeadership, setCoachingLeadership] = useState(false);

  useEffect(() => {
    if (!isCoaching) {
      setCoachingLeadership(false);
      return;
    }
    let cancelled = false;
    apiFetch("/api/athletics-coaching/me")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled) setCoachingLeadership(body?.role === "leadership");
      })
      .catch(() => {
        if (!cancelled) setCoachingLeadership(false);
      });
    return () => { cancelled = true; };
  }, [isCoaching]);

  const nav = isCoaching
    ? (coachingLeadership ? ATHLETICS_COACHING_NAV : [])
    : isHub || !isRecruiting
      ? []
      : ATHLETICS_RECRUITING_NAV;

  return (
    <div className="ath-root">
      <ReportTopBar
        title="Athletics"
        nav={nav}
        wordmark={
          <img
            className="ath-rc-mark"
            src={gyreneG.src}
            srcSet={`${gyreneG.src} 1x, ${gyreneG2x.src} 2x, ${gyreneG3x.src} 3x`}
            alt="Gyrenes"
            width={40}
            height={36}
          />
        }
        actions={
          isCoaching || isGiving ? undefined : (
            <>
              <span className="rc-meta">
                {loading ? "Loading…" : generatedAt ? `As of ${new Date(generatedAt).toLocaleString()}` : ""}
              </span>
              <button type="button" className="rc-btn" onClick={refresh}>Refresh</button>
            </>
          )
        }
      />
      {isRecruiting || pathname.startsWith("/athletics/master/rosters") ? <AthleticsFilters /> : null}
      {children}
    </div>
  );
}

function AthleticsFilters() {
  const pathname = usePathname();
  const { filters, options, setFilter, clearFilters, activeFilterCount } = useAthletics();
  const visibleKeys = withPosition(filterKeysForPath(pathname), filters.sport.length > 0);
  const chipKeys = new Set(visibleKeys);
  const visibleActive = (Object.entries(filters) as [FilterKey, string[]][])
    .filter(([key, selected]) => chipKeys.has(key) && selected.length);
  return (
    <section className="ath-filter-panel" aria-label="Athletics filters">
      <div className="ath-filter-heading">
        <div>
          <strong>Filters</strong>
          <span>{filters.sport.length ? "Position is limited to the selected sport." : "Select a sport to filter by position."}</span>
        </div>
        <div><button type="button" onClick={clearFilters} disabled={!activeFilterCount}>Reset all</button></div>
      </div>
      <div className="ath-filter-grid">
        {visibleKeys.map((key) => (
          <details key={key} name="athletics-filter" className="ath-filter-group">
            <summary>{FILTER_LABELS[key]}{filters[key].length ? <b>{filters[key].length}</b> : null}</summary>
            <FilterOptions filterKey={key} filters={filters} options={options} setFilter={setFilter} />
          </details>
        ))}
      </div>
      {visibleActive.length ? (
        <div className="ath-active-filters" aria-label="Active filters">
          <span>Active:</span>
          {visibleActive.flatMap(([key, selected]) =>
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

export function AthleticsPage({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  const { loading, error } = useAthletics();
  return (
    <main className="ath-page">
      <div className="ath-page-heading"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions}</div>
      {error && <div className="ath-alert ath-alert-error"><strong>Unable to load Athletics data.</strong><span>{error}</span></div>}
      {loading && <div className="ath-loading">Loading Slate data…</div>}
      {!loading && !error && children}
    </main>
  );
}
