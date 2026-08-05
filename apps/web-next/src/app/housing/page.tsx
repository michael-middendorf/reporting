"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import "@/styles/housing.css";

type Room = {
  room?: string;
  capacity?: number;
  occupied?: number;
  gender?: string;
  residents?: string[];
};
type Building = {
  name: string;
  gender?: "men" | "women" | "other" | string;
  capacity?: number;
  occupied?: number;
  rooms?: Room[];
};

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

  return <canvas ref={ref} style={{ width: "100%", maxWidth: 320, cursor: "pointer" }} />;
}

export default function HousingPage() {
  const [payload, setPayload] = useState<HousingPayload | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [selected, setSelected] = useState<{ building: Building; room: Room } | null>(null);

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
      setStatus(json.source || "Live");
    } catch (e) {
      setPayload({ buildings: [], error: String(e) });
      setStatus("Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const buildings = payload?.buildings || [];

  return (
    <AccessGate report="housing">
      <div className="housing-root">
        <ReportTopBar title="Housing" nav={[{ href: "/housing", label: "Dashboard" }]} />
        <main style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <header style={{ marginBottom: 20 }}>
            <p style={{ color: "#B8892A", fontWeight: 700, letterSpacing: "0.08em", fontSize: 12 }}>
              AVE MARIA UNIVERSITY
            </p>
            <h1 style={{ fontFamily: "Georgia, serif", color: "#0D2B5E", margin: "4px 0 8px" }}>
              Housing Dashboard
            </h1>
            <p style={{ color: "#4A6490" }}>
              {status}{" "}
              <button type="button" onClick={load} style={{ marginLeft: 8 }}>
                Refresh
              </button>
            </p>
            {payload?.error && (
              <p style={{ color: "#943060", marginTop: 8 }}>
                {payload.error} — configure Qlik/eRezLife secrets for live occupancy.
              </p>
            )}
          </header>

          {payload?.planning && (
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                gap: 12,
                marginBottom: 24,
              }}
            >
              {Object.entries(payload.planning).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    background: "#fff",
                    border: "1px solid #C8D6E8",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: 11, color: "#4A6490", textTransform: "uppercase" }}>{k}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#0D2B5E" }}>{String(v)}</div>
                </div>
              ))}
            </section>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
              gap: 16,
            }}
          >
            {buildings.map((b) => (
              <article
                key={b.name}
                style={{
                  background: "#fff",
                  border: "1px solid #C8D6E8",
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                <h2 style={{ margin: "0 0 6px", color: "#0D2B5E", fontSize: 16 }}>{b.name}</h2>
                <p style={{ margin: "0 0 10px", color: "#4A6490", fontSize: 13 }}>
                  {(b.occupied ?? 0)} / {(b.capacity ?? 0)} · {b.gender || "—"}
                </p>
                <RoomGrid
                  rooms={b.rooms || []}
                  gender={String(b.gender || "other")}
                  onSelect={(room) => setSelected({ building: b, room })}
                />
              </article>
            ))}
            {!buildings.length && (
              <p style={{ color: "#4A6490" }}>No building data yet.</p>
            )}
          </div>
        </main>

        {selected && (
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
            onClick={() => setSelected(null)}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: 20,
                width: "min(480px,92vw)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>
                {selected.building.name} · Room {selected.room.room || "—"}
              </h3>
              <p>
                Occupied {selected.room.occupied ?? 0} / {selected.room.capacity ?? "—"}
              </p>
              <ul>
                {(selected.room.residents || []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <button type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </AccessGate>
  );
}
