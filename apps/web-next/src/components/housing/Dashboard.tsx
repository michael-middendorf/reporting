"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  HALL_CHARTS,
  META,
  bedsOpen,
  hallResidents,
  indexOccupancy,
  isIreland,
  isIsoDate,
  isRome,
} from "@/lib/reports/housing/model";
import type { OccIndex } from "@/lib/reports/housing/model";
import type {
  ResidentsPayload,
  RoomVerificationState,
  StudyAbroad,
} from "@/lib/reports/housing/types";
import { Floors } from "./Floors";
import { Moveins } from "./Moveins";
import { Overview } from "./Overview";
import { Verification } from "./Verification";
import styles from "./housing.module.css";

type View = "overview" | "floor" | "movein" | "verify";

export function HousingDashboard() {
  const [payload, setPayload] = useState<ResidentsPayload | null>(null);
  const [error, setError] = useState("");
  const [studyAbroad, setStudyAbroad] = useState<StudyAbroad | null>(null);
  const [edits, setEdits] = useState<RoomVerificationState["edits"]>({});
  const [view, setView] = useState<View>("overview");
  const [hall, setHall] = useState("JPII");
  const [floor, setFloor] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [asof, setAsof] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hallParam = params.get("hall");
    if (hallParam && META[hallParam]) setHall(hallParam);
    const floorParam = params.get("floor");
    if (floorParam) setFloor(Number(floorParam));
    const asofParam = params.get("asof");
    if (asofParam && isIsoDate(asofParam)) setAsof(asofParam);
    const viewParam = params.get("view");
    if (viewParam === "floor" || viewParam === "movein" || viewParam === "verify") setView(viewParam);
    const roomParam = params.get("room");
    if (roomParam) setSelectedRoom(roomParam);
  }, []);

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
  const ireland =
    studyAbroad?.total ?? residents.filter((r) => isIreland(r.building)).length;
  const rome = residents.filter(isRome).length;
  const inHalls = inResidenceHalls + ireland + rome;
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
          ["overview", "Stats"],
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

      {!error && payload && view === "overview" && (
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
