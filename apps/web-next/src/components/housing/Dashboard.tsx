"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api";
import {
  HALL_CHARTS,
  META,
  bedsOpen,
  hallResidents,
  indexOccupancy,
  isIsoDate,
} from "@/lib/reports/housing/model";
import type { OccIndex } from "@/lib/reports/housing/model";
import type { ResidentsPayload, RoomVerificationState } from "@/lib/reports/housing/types";
import { Floors } from "./Floors";
import { Moveins } from "./Moveins";
import { Verification } from "./Verification";
import styles from "./housing.module.css";

type View = "floor" | "movein" | "verify";
type FloorMode = "chart" | "list";

type UrlState = {
  view: View;
  hall: string;
  floor: number | null;
  asof: string | null;
  selectedRoom: string | null;
  mode: FloorMode;
};

/** Deep-link state (?view=&hall=&floor=&asof=&room=&mode=); invalid values fall back to defaults. */
function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const hallParam = params.get("hall");
  const floorParam = params.get("floor");
  const asofParam = params.get("asof");
  const viewParam = params.get("view");
  const modeParam = params.get("mode");
  return {
    view: viewParam === "movein" || viewParam === "verify" ? viewParam : "floor",
    hall: hallParam && META[hallParam] ? hallParam : "JPII",
    floor: floorParam ? Number(floorParam) : null,
    asof: asofParam && isIsoDate(asofParam) ? asofParam : null,
    selectedRoom: params.get("room") || null,
    mode: modeParam === "list" || modeParam === "chart" ? modeParam : "chart",
  };
}

const subscribeNoop = () => () => {};

/**
 * Reads the URL once on the client (null during server render and hydration),
 * then mounts the dashboard with its initial state taken from the deep link.
 * This replaces a mount effect that copied URL params into state.
 */
export function HousingDashboard() {
  const search = useSyncExternalStore(subscribeNoop, () => window.location.search, () => null);
  if (search === null) return null;
  return <HousingDashboardView initial={readUrlState(search)} />;
}

function HousingDashboardView({ initial }: { initial: UrlState }) {
  const [payload, setPayload] = useState<ResidentsPayload | null>(null);
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<RoomVerificationState["edits"]>({});
  const [view, setView] = useState<View>(initial.view);
  const [hall, setHall] = useState(initial.hall);
  const [floor, setFloor] = useState<number | null>(initial.floor);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(initial.selectedRoom);
  const [asof, setAsof] = useState<string | null>(initial.asof);
  const [mode, setMode] = useState<FloorMode>(initial.mode);

  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "floor") params.set("view", view);
    if (view === "floor") {
      params.set("hall", hall);
      params.set("mode", mode);
      if (floor != null) params.set("floor", String(floor));
      if (asof) params.set("asof", asof);
      if (selectedRoom) params.set("room", selectedRoom);
    }
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    const cur = `${window.location.pathname}${window.location.search}`;
    if (next !== cur) window.history.replaceState(null, "", next);
  }, [view, hall, floor, asof, selectedRoom, mode]);

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

  const residents = payload?.residents || [];
  const occ: OccIndex = useMemo(() => indexOccupancy(residents), [residents]);

  const persistRooms = useCallback((next: RoomVerificationState["edits"]) => {
    setEdits(next);
    apiFetch("/api/room-verification", {
      method: "POST",
      body: JSON.stringify({ edits: next }),
    }).catch(() => undefined);
  }, []);

  function onRoomEdit(key: string, field: "status" | "capacity", value: string) {
    persistRooms({ ...edits, [key]: { ...(edits[key] || {}), [field]: value } });
  }

  const inResidenceHalls = Object.keys(META).reduce((n, c) => n + hallResidents(occ, c), 0);
  const inHalls = inResidenceHalls;
  const openBeds = Object.keys(META).reduce((n, c) => n + bedsOpen(HALL_CHARTS[c], c, occ, edits, asof), 0);

  return (
    <div className={styles.root}>
      <header className={styles.top}>
        <div>
          <div className={styles.eyebrow}>Ave Maria University · Residence Life</div>
          <h1>Residence Life Dashboard</h1>
          <div className={styles.sub}>
            Fall 2026 · eRezLife assignments
            {payload?.cached_at ? ` · as of ${payload.cached_at}` : ""}
            <span className={styles.live}><span className={styles.dot} />LIVE</span>
          </div>
        </div>
        <div className={styles.grow} />
        <div className={styles.stats}>
          <div className={styles.stat}><b>{inHalls.toLocaleString()}</b><span>In halls</span></div>
          <div className={styles.stat}><b>{Object.keys(META).length}</b><span>Halls</span></div>
          <div className={styles.stat}><b>{openBeds.toLocaleString()}</b><span>Beds open</span></div>
        </div>
        <div className={styles.legend}>
          <div><i style={{ background: "var(--men)" }} />Men&apos;s residence</div>
          <div><i style={{ background: "var(--women)" }} />Women&apos;s residence</div>
          <div><i style={{ background: "var(--other)" }} />Other / commuter</div>
          <div><i style={{ background: "#CBD8EC" }} />Partial / open bed</div>
        </div>
      </header>

      <nav className={styles.nav}>
        {([
          ["floor", "Housing"],
          ["movein", "Move-ins"],
          ["verify", "Verification"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.navtab} ${view === id ? styles.navtabOn : ""}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <div className={styles.wrap}><p className={styles.error}>{error}</p></div>}
      {!error && !payload && <div className={styles.wrap}><p>Loading housing assignments…</p></div>}

      {!error && payload && view === "floor" && (
        <Floors
          occ={occ}
          edits={edits}
          asof={asof}
          setAsof={setAsof}
          hall={hall}
          setHall={setHall}
          floor={floor}
          setFloor={setFloor}
          selectedRoom={selectedRoom}
          setSelectedRoom={setSelectedRoom}
          onRoomEdit={onRoomEdit}
          mode={mode}
          setMode={setMode}
        />
      )}
      {!error && payload && view === "movein" && (
        <Moveins
          residents={residents}
          onOpenRoom={(building, room) => {
            setHall(building);
            setSelectedRoom(room);
            setView("floor");
          }}
        />
      )}
      {view === "verify" && <Verification />}
    </div>
  );
}
