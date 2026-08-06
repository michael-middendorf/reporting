"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import type { Building, Room } from "@/lib/reports/housing/shape";
import "@/styles/housing.css";

const CAP_WOMEN = 626;
const CAP_MEN = 577;
const CAP_TOTAL = CAP_WOMEN + CAP_MEN;
const HALL_KEYS = new Set(["JPII", "XAVIER", "GORET", "SEBAST", "TERESA", "STJOSE"]);

type HousingPayload = {
  buildings?: Building[];
  planning?: Record<string, number | string>;
  source?: string;
  error?: string;
};

function RoomGrid({
  rooms,
  gender,
  onSelect,
}: {
  rooms: Room[];
  gender: string;
  onSelect: (r: Room) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const cols = Math.max(8, Math.ceil(Math.sqrt(rooms.length * 1.6)));
    const cell = 14;
    const rows = Math.ceil(rooms.length / cols) || 1;
    canvas.width = cols * cell;
    canvas.height = rows * cell;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const color =
      gender === "women" ? "#943060" : gender === "men" ? "#1B5EA8" : "#1F6B42";
    rooms.forEach((r, i) => {
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * cell;
      const cap = r.capacity || 1;
      const occ = r.occupied || 0;
      const fill = occ <= 0 ? "#E8EEF6" : occ >= cap ? color : `${color}99`;
      ctx.fillStyle = fill;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    });
    const onClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const i =
        Math.floor((y * scaleY) / cell) * cols + Math.floor((x * scaleX) / cell);
      if (rooms[i]) onSelect(rooms[i]);
    };
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [rooms, gender, onSelect]);

  return <canvas ref={ref} style={{ width: "100%", maxWidth: 360, cursor: "pointer" }} />;
}

function FillBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 8, background: "#E8EEF6", borderRadius: 4, overflow: "hidden", marginTop: 8 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color }} />
    </div>
  );
}

export default function HousingPage() {
  const [payload, setPayload] = useState<HousingPayload | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  const load = useCallback(async () => {
    setStatus("Loading…");
    try {
      const res = await apiFetch("/api/housing-data");
      const json = (await res.json()) as HousingPayload;
      if (!res.ok) {
        setPayload({ buildings: [], error: json.error || res.statusText });
        setStatus(json.error || "Housing data unavailable");
        return;
      }
      setPayload(json);
      setStatus(json.source || "Cached");
    } catch (e) {
      setPayload({ buildings: [], error: String(e) });
      setStatus("Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const buildings = payload?.buildings || [];
  const women = buildings.filter((b) => b.gender === "women" && HALL_KEYS.has(b.key));
  const men = buildings.filter((b) => b.gender === "men" && HALL_KEYS.has(b.key));
  const other = buildings.filter((b) => !HALL_KEYS.has(b.key));

  const womenIn = useMemo(() => women.reduce((s, b) => s + (b.occupied || 0), 0), [women]);
  const menIn = useMemo(() => men.reduce((s, b) => s + (b.occupied || 0), 0), [men]);
  const inHalls = womenIn + menIn;
  const bedsOpen = Math.max(CAP_TOTAL - inHalls, 0);
  const fillTotal = (inHalls / CAP_TOTAL) * 100;
  const fillW = (womenIn / CAP_WOMEN) * 100;
  const fillM = (menIn / CAP_MEN) * 100;

  const sections: { title: string; items: Building[]; color: string }[] = [
    { title: "Women’s Halls", items: women, color: "#943060" },
    { title: "Men’s Halls", items: men, color: "#1B5EA8" },
    { title: "Townhomes · Other · Commuter", items: other, color: "#1F6B42" },
  ];

  return (
    <AccessGate report="housing">
      <div className="housing-root">
        <ReportTopBar title="Housing" nav={[{ href: "/housing", label: "Dashboard" }]} />
        <main style={{ padding: "24px 28px 48px", maxWidth: 1180, margin: "0 auto" }}>
          <header style={{ marginBottom: 20 }}>
            <p style={{ color: "#B8892A", fontWeight: 700, letterSpacing: "0.08em", fontSize: 12 }}>
              AVE MARIA UNIVERSITY
            </p>
            <h1 style={{ fontFamily: "Georgia, serif", color: "#0D2B5E", margin: "4px 0 8px" }}>
              Housing Dashboard
            </h1>
            <p style={{ color: "#4A6490" }}>
              {status}
              {payload?.planning?.cached_at ? ` · as of ${payload.planning.cached_at}` : ""}{" "}
              <button type="button" onClick={load} style={{ marginLeft: 8 }}>
                Refresh
              </button>
            </p>
            {payload?.error && (
              <p style={{ color: "#943060", marginTop: 8 }}>{payload.error}</p>
            )}
          </header>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {[
              ["In Halls", inHalls.toLocaleString()],
              ["Halls", "6"],
              ["Beds Open", bedsOpen.toLocaleString()],
            ].map(([l, v]) => (
              <div
                key={l}
                style={{ background: "#fff", border: "1px solid #C8D6E8", borderRadius: 8, padding: 14 }}
              >
                <div style={{ fontSize: 11, color: "#4A6490", textTransform: "uppercase" }}>{l}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#0D2B5E" }}>{v}</div>
              </div>
            ))}
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 12,
              marginBottom: 28,
            }}
          >
            <div style={{ background: "#fff", border: "1px solid #C8D6E8", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#4A6490", textTransform: "uppercase" }}>
                Domestic Capacity
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#0D2B5E" }}>
                {CAP_TOTAL.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: "#4A6490", marginTop: 6 }}>
                Women {CAP_WOMEN} · Men {CAP_MEN}
              </div>
              <div style={{ fontSize: 11, color: "#8A9BB5", marginTop: 6 }}>
                Excludes overseas (Rome / Ireland)
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #C8D6E8", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#4A6490", textTransform: "uppercase" }}>
                Current Fill
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#0D2B5E" }}>
                {fillTotal.toFixed(1)}%
              </div>
              <FillBar pct={fillTotal} color="#0D2B5E" />
              <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 13 }}>
                <span style={{ color: "#943060" }}>W {fillW.toFixed(1)}%</span>
                <span style={{ color: "#1B5EA8" }}>M {fillM.toFixed(1)}%</span>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #C8D6E8", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#4A6490", textTransform: "uppercase" }}>
                Occupancy now
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#0D2B5E" }}>
                {inHalls.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: "#4A6490", marginTop: 6 }}>
                Women {womenIn.toLocaleString()} · Men {menIn.toLocaleString()}
              </div>
            </div>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ color: "#0D2B5E", fontSize: 16 }}>Hall Occupancy</h2>
            <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid #C8D6E8" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left" />
                    <th align="right">Capacity</th>
                    <th align="right">Now</th>
                    <th align="right">Fill %</th>
                    <th align="right">Beds open</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ color: "#943060", fontWeight: 700 }}>Women</td>
                    <td align="right">{CAP_WOMEN}</td>
                    <td align="right">{womenIn}</td>
                    <td align="right">{fillW.toFixed(1)}%</td>
                    <td align="right">{Math.max(CAP_WOMEN - womenIn, 0)}</td>
                  </tr>
                  <tr>
                    <td style={{ color: "#1B5EA8", fontWeight: 700 }}>Men</td>
                    <td align="right">{CAP_MEN}</td>
                    <td align="right">{menIn}</td>
                    <td align="right">{fillM.toFixed(1)}%</td>
                    <td align="right">{Math.max(CAP_MEN - menIn, 0)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 700 }}>Total</td>
                    <td align="right">{CAP_TOTAL}</td>
                    <td align="right">{inHalls}</td>
                    <td align="right">{fillTotal.toFixed(1)}%</td>
                    <td align="right">{bedsOpen}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: "#4A6490", marginTop: 8 }}>
              FA26 deposits / melt / incoming-freshmen planning tables require the deposits feed
              (not yet published to ReportData). Live hall occupancy above is from eRezLife/Qlik
              cache.
            </p>
          </section>

          {sections.map((sec) => (
            <section key={sec.title} style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h2 style={{ color: "#0D2B5E", fontSize: 16, margin: 0 }}>{sec.title}</h2>
                <span style={{ color: "#4A6490", fontSize: 13 }}>
                  {sec.items.reduce((s, b) => s + (b.occupied || 0), 0).toLocaleString()} students
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                  gap: 16,
                  marginTop: 12,
                }}
              >
                {sec.items.map((b) => {
                  const fill = b.capacity ? Math.round(((b.occupied || 0) / b.capacity) * 100) : null;
                  return (
                    <article
                      key={b.key || b.name}
                      style={{
                        background: "#fff",
                        border: "1px solid #C8D6E8",
                        borderRadius: 10,
                        padding: 14,
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        setSelectedBuilding(b);
                        setSelectedRoom(null);
                      }}
                    >
                      <h3 style={{ margin: "0 0 6px", color: "#0D2B5E", fontSize: 16 }}>{b.name}</h3>
                      <p style={{ margin: "0 0 10px", color: "#4A6490", fontSize: 13 }}>
                        {(b.occupied ?? 0).toLocaleString()} / {(b.capacity ?? 0).toLocaleString()}
                        {fill != null ? ` · ${fill}%` : ""}
                      </p>
                      <RoomGrid
                        rooms={b.rooms || []}
                        gender={String(b.gender || "other")}
                        onSelect={(room) => {
                          setSelectedBuilding(b);
                          setSelectedRoom(room);
                        }}
                      />
                      <FillBar pct={fill || 0} color={sec.color} />
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </main>

        {selectedBuilding && (
          <div
            role="dialog"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(13,43,94,0.35)",
              display: "grid",
              placeItems: "center",
              zIndex: 50,
            }}
            onClick={() => {
              setSelectedBuilding(null);
              setSelectedRoom(null);
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: 20,
                width: "min(720px,94vw)",
                maxHeight: "85vh",
                overflow: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>{selectedBuilding.name}</h3>
              <p style={{ color: "#4A6490" }}>
                {(selectedBuilding.occupied ?? 0).toLocaleString()} students ·{" "}
                {(selectedBuilding.rooms || []).length} rooms
                {selectedBuilding.capacity
                  ? ` · ${Math.round(((selectedBuilding.occupied || 0) / selectedBuilding.capacity) * 100)}% occupancy`
                  : ""}
              </p>
              {selectedRoom && (
                <p>
                  Selected room {selectedRoom.room}: {selectedRoom.occupied ?? 0} /{" "}
                  {selectedRoom.capacity ?? "—"}
                </p>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Room</th>
                    <th align="right">Occupied</th>
                    <th align="right">Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(selectedBuilding.rooms || [])]
                    .sort((a, b) => String(a.room).localeCompare(String(b.room), undefined, { numeric: true }))
                    .map((r) => (
                      <tr
                        key={r.room}
                        style={{
                          background:
                            selectedRoom?.room === r.room ? "rgba(184,137,42,0.12)" : undefined,
                        }}
                      >
                        <td>{r.room}</td>
                        <td align="right">{r.occupied ?? 0}</td>
                        <td align="right">{r.capacity ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <button type="button" onClick={() => setSelectedBuilding(null)} style={{ marginTop: 12 }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </AccessGate>
  );
}
