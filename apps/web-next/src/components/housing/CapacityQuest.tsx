"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api";
import {
  CAPACITY_TERMS,
  capacityTermById,
  type CapacityTermId,
} from "@/lib/reports/housing/capacity-terms";
import { HALL_CHARTS, indexOccupancy } from "@/lib/reports/housing/model";
import type { OccIndex } from "@/lib/reports/housing/model";
import type { ResidentsPayload, RoomVerificationState, StudyAbroad } from "@/lib/reports/housing/types";
import { CapacityProjection, PriestRoomsNote } from "./CapacityProjection";
import { Overview } from "./Overview";
import styles from "./housing.module.css";

const subscribeNoop = () => () => {};

function termFromSearch(search: string): CapacityTermId {
  return capacityTermById(new URLSearchParams(search).get("term")).id;
}

export function CapacityQuest() {
  const search = useSyncExternalStore(subscribeNoop, () => window.location.search, () => null);
  if (search === null) return null;
  return <CapacityQuestView initialTerm={termFromSearch(search)} />;
}

function CapacityQuestView({ initialTerm }: { initialTerm: CapacityTermId }) {
  const [termId, setTermId] = useState(initialTerm);
  const [payload, setPayload] = useState<ResidentsPayload | null>(null);
  const [error, setError] = useState("");
  const [studyAbroad, setStudyAbroad] = useState<StudyAbroad | null>(null);
  const [edits, setEdits] = useState<RoomVerificationState["edits"]>({});
  const term = capacityTermById(termId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/data/residents.json");
        const json = (await res.json()) as ResidentsPayload;
        if (cancelled) return;
        if (!res.ok || json.error || !Array.isArray(json.residents)) {
          setError(json.error || "Housing data unavailable. Wait for HousingRefresh, then reload.");
          return;
        }
        setPayload(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load housing data");
      }
    })();
    apiFetch("/api/study-abroad")
      .then((r) => r.json())
      .then((d: StudyAbroad) => {
        if (!cancelled && !d.error) setStudyAbroad(d);
      })
      .catch(() => undefined);
    apiFetch("/api/room-verification")
      .then((r) => r.json())
      .then((d: { state?: RoomVerificationState }) => {
        if (!cancelled) setEdits(d.state?.edits || {});
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function selectTerm(id: CapacityTermId) {
    setTermId(id);
    const params = new URLSearchParams(window.location.search);
    if (id === "fa26") params.delete("term");
    else params.set("term", id);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    const cur = `${window.location.pathname}${window.location.search}`;
    if (next !== cur) window.history.replaceState(null, "", next);
  }

  const residents = useMemo(() => payload?.residents ?? [], [payload]);
  const occ: OccIndex = useMemo(() => indexOccupancy(residents), [residents]);

  return (
    <div className={styles.root}>
      <header className={styles.top}>
        <div>
          <div className={styles.eyebrow}>Ave Maria University · Housing</div>
          <h1>Capacity Quest</h1>
          <div className={styles.sub}>
            {term.kind === "live" ? (
              <>
                {term.label}
                {term.sessions
                  ? ` · eRezLife ${term.sessions.domestic} and ${term.sessions.ireland}`
                  : ""}
                {payload?.cached_at ? ` · as of ${payload.cached_at}` : ""}
                <span className={styles.live}>
                  <span className={styles.dot} />
                  LIVE
                </span>
              </>
            ) : (
              <>
                {term.label} · projected from the Fall 2026 pull
                {payload?.cached_at ? ` · as of ${payload.cached_at}` : ""}
              </>
            )}
          </div>
        </div>
      </header>

      <nav className={styles.nav} aria-label="Capacity Quest terms">
        {CAPACITY_TERMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.navtab} ${termId === item.id ? styles.navtabOn : ""}`}
            aria-current={termId === item.id ? "page" : undefined}
            onClick={() => selectTerm(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className={styles.wrap}>
          <p className={styles.error}>{error}</p>
        </div>
      )}
      {!error && !payload && (
        <div className={styles.wrap}>
          <p>Loading housing assignments…</p>
        </div>
      )}
      {!error && payload && term.kind === "live" && (
        <Overview
          residents={residents}
          charts={HALL_CHARTS}
          occ={occ}
          edits={edits}
          withdrawn={payload.withdrawn}
          studyAbroad={studyAbroad}
          cachedAt={payload.cached_at}
        />
      )}
      {!error && payload && term.kind === "projection" && (
        <CapacityProjection termId={term.id} residents={residents} cachedAt={payload.cached_at} />
      )}
      <div className={styles.follow}>
        <PriestRoomsNote />
      </div>
    </div>
  );
}
