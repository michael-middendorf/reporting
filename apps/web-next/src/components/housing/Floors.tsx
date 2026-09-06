import { useMemo } from "react";
import { isBibleUnavailable } from "@/lib/reports/housing/bible";
import {
  HALL_CHARTS,
  META,
  SEC_NAME,
  SEC_ORDER,
  bedsOpen,
  effCap,
  floorBands,
  fmtDate,
  hallResidents,
  isEarly,
  isIsoDate,
  isOffLimits,
  isStaffOffLimits,
  peopleIn,
  roomKey,
  shade,
  srcLabel,
  todayIso,
} from "@/lib/reports/housing/model";
import type { OccIndex } from "@/lib/reports/housing/model";
import type { ChartFloor, RoomVerificationState } from "@/lib/reports/housing/types";
import styles from "./housing.module.css";

const TODAY = todayIso();

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
}) {
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
  const cap = selectedChartRoom ? effCap(edits, hall, selectedChartRoom) : 0;
  const off = selectedRoom ? isOffLimits(edits, hall, selectedRoom) : false;
  const bibleOff = selectedRoom ? isBibleUnavailable(hall, selectedRoom) : false;

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
            <b>{asofSum.inn.toLocaleString()}</b> in dorms as of {asofSum.label}
            {asofSum.arr ? <> · <b style={{ color: "#1B5EA8" }}>{asofSum.arr}</b> moving in that day</> : null}
          </span>
        )}
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
                  if (isOffLimits(edits, hall, r.number)) continue;
                  open += Math.max(0, effCap(edits, hall, r) - peopleIn(occ, hall, r.number, asof).length);
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
          <FloorMap
            hall={hall}
            floor={activeFloor}
            occ={occ}
            edits={edits}
            asof={asof}
            selected={selectedRoom}
            onSelect={setSelectedRoom}
          />
        </div>
      )}

      {selectedRoom && selectedChartRoom && (
        <>
          <button type="button" className={styles.scrim} aria-label="Close room" onClick={() => setSelectedRoom(null)} />
          <aside className={styles.drawer}>
            <div className={styles.dh}>
              <div>
                <h2>{meta.abbr} {selectedRoom}</h2>
                <div className={styles.sub}>{selectedChartRoom.type || "Room"} · {people.length}/{cap} filled{off ? " · UNAVAILABLE" : ""}</div>
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
                <span className={styles.chip}>Open <b>{Math.max(0, cap - people.length)}</b></span>
              </div>
              {bibleOff ? (
                <div className={styles.sub}>Residence Hall Bible: not available for placement.</div>
              ) : null}
              <button
                type="button"
                className={`${styles.btnroom} ${off ? styles.restore : styles.unavail}`}
                disabled={bibleOff}
                onClick={() => {
                  if (bibleOff) return;
                  onRoomEdit(roomKey(hall, selectedRoom), "status", off ? "Confirmed available" : "Off-limits");
                  if (!off) setSelectedRoom(null);
                }}
              >
                {off ? "Restore to floor plan" : "Mark unavailable"}
              </button>
              {!people.length && <div className={styles.sub}>No residents assigned to this room.</div>}
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
  const [top, bot] = floorBands(floor, hall, edits);
  const n = Math.max(top.length, bot.length);
  const meta = META[hall];
  const visible = floor.rooms.filter((r) => !isStaffOffLimits(edits, hall, r.number)).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  function box(r: (typeof floor.rooms)[number] | undefined, key: string) {
    if (!r) return <div key={key} className={`${styles.room} ${styles.spacer}`} />;
    const ppl = peopleIn(occ, hall, r.number, asof);
    const occN = ppl.length;
    const cap = effCap(edits, hall, r);
    const movingIn = Boolean(asof && ppl.some((p) => p.move_in === asof));
    const dark = occN / Math.max(cap, 1) > 0.55;
    return (
      <button
        type="button"
        key={r.number}
        className={`${styles.room} ${cap >= 6 ? styles.suite : ""} ${cap < meta.std && cap <= 2 ? styles.reduced : ""} ${movingIn ? styles.movein : ""} ${selected === r.number ? styles.selroom : ""}`}
        style={{ background: shade(meta.sec, occN, cap), color: dark ? "#fff" : "var(--text)" }}
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
            const cap = effCap(edits, hall, r);
            return (
              <button
                type="button"
                key={r.number}
                className={`${styles.urow} ${selected === r.number ? styles.urowOn : ""}`}
                onClick={() => onSelect(r.number)}
              >
                <span className={styles.rdot} style={{ background: shade(meta.sec, occN, cap) }} />
                <span className={styles.un}>{r.number}</span>
                <span className={styles.ut}>{r.type || ""}</span>
                <span className={styles.uoc}>{occN}/{cap}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
