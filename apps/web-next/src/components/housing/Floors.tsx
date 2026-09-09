import { useMemo, useState } from "react";
import { isBibleUnavailable } from "@/lib/reports/housing/bible";
import {
  HALL_CHARTS,
  META,
  ROOM_STATUS_COLOR,
  ROOM_STATUS_LABEL,
  ROOM_STATUS_STORED,
  ROOM_STATUSES,
  SEC_NAME,
  SEC_ORDER,
  bedsOpen,
  floorBands,
  fmtDate,
  hallResidents,
  isEarly,
  isIsoDate,
  peopleIn,
  roomCellFill,
  roomFill,
  roomKey,
  roomListRows,
  roomStatus,
  shade,
  srcLabel,
  todayIso,
} from "@/lib/reports/housing/model";
import type { OccIndex, RoomListRow } from "@/lib/reports/housing/model";
import type { ChartFloor, RoomStaffStatus, RoomVerificationState } from "@/lib/reports/housing/types";
import styles from "./housing.module.css";

const TODAY = todayIso();

type ListSortKey = keyof Pick<
  RoomListRow,
  "hall" | "floor" | "room" | "type" | "cap" | "filled" | "open" | "occupants" | "status"
>;

export function Floors({
  occ,
  edits,
  asof,
  setAsof,
  hall,
  setHall,
  floor,
  setFloor,
  selectedRoom,
  setSelectedRoom,
  onRoomEdit,
  mode,
  setMode,
}: {
  occ: OccIndex;
  edits: RoomVerificationState["edits"];
  asof: string | null;
  setAsof: (d: string | null) => void;
  hall: string;
  setHall: (code: string) => void;
  floor: number | null;
  setFloor: (n: number | null) => void;
  selectedRoom: string | null;
  setSelectedRoom: (n: string | null) => void;
  onRoomEdit: (key: string, field: "status" | "capacity", value: string) => void;
  mode: "chart" | "list";
  setMode: (m: "chart" | "list") => void;
}) {
  const [listScope, setListScope] = useState<"floor" | "hall">("floor");
  const [sortKey, setSortKey] = useState<ListSortKey>("room");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const chart = HALL_CHARTS[hall];
  const meta = META[hall];
  const floors = chart?.floors || [];
  const activeFloor = floors.find((f) => f.level === floor) || floors[0];
  const asofSum = useMemo(() => {
    if (!asof) return "";
    let inn = 0;
    let arr = 0;
    for (const code of Object.keys(META)) {
      for (const rm of Object.keys(occ[code] || {})) {
        for (const p of occ[code][rm]) {
          if (p.move_in && p.move_in <= asof && (!p.end_date || p.end_date >= asof)) {
            inn++;
            if (p.move_in === asof) arr++;
          }
        }
      }
    }
    return { inn, arr, label: fmtDate(asof) };
  }, [asof, occ]);

  const people = selectedRoom ? peopleIn(occ, hall, selectedRoom, asof) : [];
  const selectedChartRoom = selectedRoom
    ? chart?.floors.flatMap((f) => f.rooms).find((r) => r.number === selectedRoom)
    : undefined;
  const cap = selectedChartRoom ? roomFill(edits, hall, selectedChartRoom, occ, asof).cap : 0;
  const status = selectedRoom ? roomStatus(edits, hall, selectedRoom) : "available";
  const off = status === "off-limits";
  const bibleOff = selectedRoom ? isBibleUnavailable(hall, selectedRoom) : false;

  const listRows = useMemo(() => {
    if (!chart || mode !== "list") return [];
    const level = listScope === "hall" ? "all" : activeFloor?.level ?? "all";
    const rows = roomListRows(chart, hall, occ, edits, asof, level);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [chart, mode, listScope, activeFloor, hall, occ, edits, asof, sortKey, sortDir]);

  function toggleSort(key: ListSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.datebar}>
        <span className={styles.sectitle} style={{ margin: 0 }}>View</span>
        <button type="button" className={`${styles.db} ${!asof ? styles.dbOn : ""}`} onClick={() => setAsof(null)}>All assignments</button>
        <button type="button" className={`${styles.db} ${asof === TODAY ? styles.dbOn : ""}`} onClick={() => setAsof(TODAY)}>Today</button>
        <label className={styles.dbDate}>
          As of
          <input
            type="date"
            value={asof || ""}
            onChange={(e) => setAsof(isIsoDate(e.target.value) ? e.target.value : null)}
          />
        </label>
        {asof && asofSum && typeof asofSum !== "string" && (
          <span>
            <b>{asofSum.inn.toLocaleString()}</b> in residence halls as of {asofSum.label}
            {asofSum.arr ? <> · <b style={{ color: "#1B5EA8" }}>{asofSum.arr}</b> moving in that day</> : null}
          </span>
        )}
        <span className={styles.modeSep} />
        <button type="button" className={`${styles.db} ${mode === "chart" ? styles.dbOn : ""}`} onClick={() => setMode("chart")}>Chart View</button>
        <button type="button" className={`${styles.db} ${mode === "list" ? styles.dbOn : ""}`} onClick={() => setMode("list")}>List View</button>
      </div>

      <div className={styles.statusLegend} aria-label="Room status legend">
        {ROOM_STATUSES.filter((s) => s !== "available").map((s) => (
          <span key={s}>
            <i style={{ background: ROOM_STATUS_COLOR[s] || "#cbd8ec" }} />
            {ROOM_STATUS_LABEL[s]}
          </span>
        ))}
        <span>
          <i style={{ background: "#F4F8FE", boxShadow: "inset 0 0 0 1px #c0d0e8" }} />
          Occupancy shade
        </span>
      </div>

      <div className={styles.sectitle}>
        Residence Halls<span className={styles.rule} />
        <span>{Object.keys(META).length} halls</span>
      </div>
      <div className={styles.halls}>
        {SEC_ORDER.flatMap(([, , codes]) =>
          codes.map((code) => {
            const m = META[code];
            return (
              <button
                type="button"
                key={code}
                className={`${styles.hcard} ${code === hall ? styles.hcardOn : ""}`}
                onClick={() => {
                  setHall(code);
                  setFloor(null);
                  setSelectedRoom(null);
                }}
              >
                <div className={`${styles.abbr} ${m.sec === "w" ? styles.w : styles.m}`}>{m.abbr}</div>
                <div>
                  <div className={styles.nm}>{m.name}</div>
                  <div className={`${styles.gen} ${m.sec === "w" ? styles.w : styles.m}`}>{SEC_NAME[m.sec]}</div>
                </div>
                <div className={styles.ct}>
                  <b>{hallResidents(occ, code)}</b>
                  {bedsOpen(HALL_CHARTS[code], code, occ, edits, asof)} open
                </div>
              </button>
            );
          }),
        )}
      </div>

      {chart && meta && activeFloor && (
        <div className={styles.detail}>
          <div className={styles.dhead}>
            <h2>{meta.name}</h2>
            <span className={styles.gtag} style={{ color: meta.sec === "w" ? "var(--women)" : "var(--men)", background: meta.sec === "w" ? "#9430601a" : "#1B5EA81a" }}>
              {SEC_NAME[meta.sec]} Residence
            </span>
            <div className={styles.floors}>
              {floors.map((f) => {
                let open = 0;
                for (const r of f.rooms) {
                  open += roomFill(edits, hall, r, occ, asof).open;
                }
                const on = (floor ?? activeFloor.level) === f.level;
                return (
                  <button key={f.level} type="button" className={`${styles.fbtn} ${on ? styles.fbtnOn : ""}`} onClick={() => { setFloor(f.level); setSelectedRoom(null); }}>
                    <div className={styles.circ}>{f.level}</div>
                    <small>{open} open</small>
                  </button>
                );
              })}
            </div>
          </div>
          {mode === "chart" ? (
            <FloorMap
              hall={hall}
              floor={activeFloor}
              occ={occ}
              edits={edits}
              asof={asof}
              selected={selectedRoom}
              onSelect={setSelectedRoom}
            />
          ) : (
            <RoomList
              rows={listRows}
              selected={selectedRoom}
              onSelect={(room, fl) => {
                setFloor(fl);
                setSelectedRoom(room);
              }}
              listScope={listScope}
              setListScope={setListScope}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              floorLabel={activeFloor.level}
            />
          )}
        </div>
      )}

      {selectedRoom && selectedChartRoom && (
        <>
          <button type="button" className={styles.scrim} aria-label="Close room" onClick={() => setSelectedRoom(null)} />
          <aside className={styles.drawer}>
            <div className={styles.dh}>
              <div>
                <h2>{meta.abbr} {selectedRoom}</h2>
                <div className={styles.sub}>
                  {selectedChartRoom.type || "Room"} · {people.length}/{cap} filled
                  {status !== "available" ? ` · ${ROOM_STATUS_LABEL[status].toUpperCase()}` : ""}
                </div>
              </div>
              <button type="button" className={styles.x} onClick={() => setSelectedRoom(null)}>×</button>
            </div>
            <div className={styles.dcontent}>
              <div className={styles.roommeta}>
                <span className={styles.chip}>
                  Capacity{" "}
                  <input
                    className={styles.capedit}
                    type="number"
                    min={0}
                    max={12}
                    value={cap}
                    onChange={(e) => onRoomEdit(roomKey(hall, selectedRoom), "capacity", e.target.value)}
                  />
                </span>
                <span className={styles.chip}>Filled <b>{people.length}</b></span>
                <span className={styles.chip}>Open <b>{Math.max(0, off ? 0 : cap - people.length)}</b></span>
              </div>
              {bibleOff ? (
                <div className={styles.sub}>Residence Hall Bible: not available for placement.</div>
              ) : null}
              <label className={styles.statusField}>
                Status
                <select
                  className={styles.statusSel}
                  value={status}
                  disabled={bibleOff}
                  onChange={(e) =>
                    onRoomEdit(
                      roomKey(hall, selectedRoom),
                      "status",
                      ROOM_STATUS_STORED[e.target.value as RoomStaffStatus],
                    )
                  }
                >
                  {ROOM_STATUSES.map((s) => (
                    <option key={s} value={s}>{ROOM_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </label>
              <button type="button" className={styles.moveBtn} disabled>
                Move student — coming in a later ticket
              </button>
              {!people.length && <div className={styles.sub}>No residents assigned to this dorm room.</div>}
              {people.map((p) => (
                <div key={p.pcid} className={styles.person}>
                  <div className={styles.pn}>
                    {p.name || "(name unavailable)"}
                    {asof && p.move_in === asof ? <span className={styles.badge} style={{ background: "#E7F0FB", color: "#1B5EA8", borderColor: "#BBD3EE" }}>Moving in</span> : null}
                    {isEarly(p) ? <span className={styles.badge}>Early</span> : null}
                  </div>
                  <div className={styles.psub}>{p.student_type || "Resident"}{p.early_reason ? ` · ${p.early_reason}` : ""}</div>
                  <Kv k="Class year" v={p.class_status || "—"} />
                  <Kv k="Move-in" v={`${fmtDate(p.move_in)}${p.move_in_source ? ` (${srcLabel(p.move_in_source)})` : ""}`} />
                  {p.sport ? <Kv k="Sport" v={p.sport} /> : null}
                  {p.hometown ? <Kv k="Hometown" v={p.hometown} /> : null}
                  <Kv k="PCID" v={p.pcid || "—"} />
                  <Kv k="Email" v={p.email || "—"} />
                </div>
              ))}
              <div className={styles.ferpa}>FERPA — student data for authorized ResLife staff only. Do not share or export.</div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.kv}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function RoomList({
  rows,
  selected,
  onSelect,
  listScope,
  setListScope,
  sortKey,
  sortDir,
  onSort,
  floorLabel,
}: {
  rows: RoomListRow[];
  selected: string | null;
  onSelect: (room: string, floor: number) => void;
  listScope: "floor" | "hall";
  setListScope: (s: "floor" | "hall") => void;
  sortKey: ListSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: ListSortKey) => void;
  floorLabel: number;
}) {
  const cols: { key: ListSortKey; label: string }[] = [
    { key: "hall", label: "Hall" },
    { key: "floor", label: "Floor" },
    { key: "room", label: "Room" },
    { key: "type", label: "Type" },
    { key: "cap", label: "Cap" },
    { key: "filled", label: "Filled" },
    { key: "open", label: "Open" },
    { key: "occupants", label: "Occupants" },
    { key: "status", label: "Status" },
  ];
  return (
    <div className={styles.listWrap}>
      <div className={styles.listBar}>
        <span className={styles.listCount}>
          {rows.length} rooms · {listScope === "hall" ? "whole hall" : `floor ${floorLabel}`}
        </span>
        <button type="button" className={`${styles.db} ${listScope === "floor" ? styles.dbOn : ""}`} onClick={() => setListScope("floor")}>This floor</button>
        <button type="button" className={`${styles.db} ${listScope === "hall" ? styles.dbOn : ""}`} onClick={() => setListScope("hall")}>Whole hall</button>
      </div>
      <div className={styles.listScroll}>
        <table className={styles.listTable}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key}>
                  <button type="button" className={styles.thBtn} onClick={() => onSort(c.key)}>
                    {c.label}
                    {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.hallCode}-${r.room}`}
                className={`${styles.listRow} ${selected === r.room ? styles.listRowOn : ""}`}
                tabIndex={0}
                role="button"
                aria-label={`Open room ${r.room}`}
                onClick={() => onSelect(r.room, r.floor)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(r.room, r.floor);
                  }
                }}
              >
                <td>{r.hall}</td>
                <td>{r.floor}</td>
                <td className={styles.listRoom}>{r.room}</td>
                <td>{r.type || "—"}</td>
                <td>{r.cap}</td>
                <td>{r.filled}</td>
                <td>{r.open}</td>
                <td className={styles.listOcc}>{r.occupants || "—"}</td>
                <td>
                  <span className={styles.stPill}>
                    <i style={{ background: ROOM_STATUS_COLOR[r.status] || shade("o", r.filled, r.cap) }} />
                    {ROOM_STATUS_LABEL[r.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FloorMap({
  hall,
  floor,
  occ,
  edits,
  asof,
  selected,
  onSelect,
}: {
  hall: string;
  floor: ChartFloor;
  occ: OccIndex;
  edits: RoomVerificationState["edits"];
  asof: string | null;
  selected: string | null;
  onSelect: (n: string) => void;
}) {
  const [top, bot] = floorBands(floor);
  const n = Math.max(top.length, bot.length);
  const meta = META[hall];
  const visible = floor.rooms.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  function box(r: (typeof floor.rooms)[number] | undefined, key: string) {
    if (!r) return <div key={key} className={`${styles.room} ${styles.spacer}`} />;
    const ppl = peopleIn(occ, hall, r.number, asof);
    const occN = ppl.length;
    const cap = roomFill(edits, hall, r, occ, asof).cap;
    const st = roomStatus(edits, hall, r.number);
    const movingIn = Boolean(asof && ppl.some((p) => p.move_in === asof));
    const fill = roomCellFill(meta.sec, occN, cap, st);
    const dark = st !== "available" || occN / Math.max(cap, 1) > 0.55;
    return (
      <button
        type="button"
        key={r.number}
        className={`${styles.room} ${cap >= 6 ? styles.suite : ""} ${cap < meta.std && cap <= 2 ? styles.reduced : ""} ${movingIn ? styles.movein : ""} ${selected === r.number ? styles.selroom : ""} ${st !== "available" ? styles.stMark : ""}`}
        style={{
          background: fill,
          color: dark ? "#fff" : "var(--text)",
          ["--st" as string]: ROOM_STATUS_COLOR[st] || "transparent",
        }}
        onClick={() => onSelect(r.number)}
      >
        <div className={styles.rn}>{r.number}</div>
        <div className={styles.rt} style={{ color: dark ? "rgba(255,255,255,.8)" : "var(--dim)" }}>{occN}/{cap}</div>
        <div className={styles.pips}>
          {Array.from({ length: cap }, (_, i) => (
            <span key={i} className={styles.pip} style={{ background: i < occN ? (meta.sec === "w" ? "var(--women)" : "var(--men)") : "#CBD8EC" }} />
          ))}
        </div>
        {!asof && ppl.some(isEarly) ? <span className={styles.early} title="Early arrival" /> : null}
        {movingIn ? <span className={styles.mibadge}>IN</span> : null}
      </button>
    );
  }

  return (
    <>
      <div className={styles.map}>
        <div className={styles.floorgrid}>
          <div className={styles.frow}>{Array.from({ length: n }, (_, i) => box(top[i], `t-${i}`))}</div>
          <div className={styles.hallway}>HALLWAY</div>
          <div className={styles.frow}>{Array.from({ length: n }, (_, i) => box(bot[i], `b-${i}`))}</div>
        </div>
      </div>
      <div className={styles.units}>
        <h3>{visible.length} rooms · this floor</h3>
        <div className={styles.ulist}>
          {visible.map((r) => {
            const occN = peopleIn(occ, hall, r.number, asof).length;
            const cap = roomFill(edits, hall, r, occ, asof).cap;
            const st = roomStatus(edits, hall, r.number);
            return (
              <button
                type="button"
                key={r.number}
                className={`${styles.urow} ${selected === r.number ? styles.urowOn : ""}`}
                onClick={() => onSelect(r.number)}
              >
                <span className={styles.rdot} style={{ background: roomCellFill(meta.sec, occN, cap, st) }} />
                <span className={styles.un}>{r.number}</span>
                <span className={styles.ut}>{r.type || ROOM_STATUS_LABEL[st]}</span>
                <span className={styles.uoc}>{occN}/{cap}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
