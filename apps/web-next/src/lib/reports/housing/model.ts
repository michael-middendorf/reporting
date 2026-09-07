import { bibleCapOverride, isBibleUnavailable } from "./bible";
import type {
  ChartFloor,
  ChartRoom,
  HallChart,
  HallMeta,
  Resident,
  RoomVerificationState,
  Sec,
} from "./types";
import goret from "./halls/goret.chart.json";
import jpii from "./halls/jpii.chart.json";
import sebast from "./halls/sebast.chart.json";
import stjose from "./halls/stjose.chart.json";
import teresa from "./halls/teresa.chart.json";
import xavier from "./halls/xavier.chart.json";

export const META: Record<string, HallMeta> = {
  JPII: { abbr: "JPII", name: "St. John Paul II Hall", sec: "w", std: 4 },
  XAVIER: { abbr: "Xav", name: "Francis Xavier Hall", sec: "w", std: 3 },
  GORET: { abbr: "Gor", name: "Maria Goretti Hall", sec: "w", std: 3 },
  TERESA: { abbr: "MT", name: "St. Mother Teresa Hall", sec: "m", std: 4 },
  SEBAST: { abbr: "Seb", name: "St. Sebastian Hall", sec: "m", std: 3 },
  STJOSE: { abbr: "JOS", name: "St. Joseph Hall", sec: "m", std: 2 },
};

export const HALL_CHARTS: Record<string, HallChart> = {
  JPII: jpii as HallChart,
  XAVIER: xavier as HallChart,
  GORET: goret as HallChart,
  TERESA: teresa as HallChart,
  SEBAST: sebast as HallChart,
  STJOSE: stjose as HallChart,
};

export const SEC_NAME: Record<Sec, string> = { w: "Women’s", m: "Men’s", o: "Other" };
export const SEC_ORDER: [Sec, string, string[]][] = [
  ["w", "Women’s Residences", ["JPII", "XAVIER", "GORET"]],
  ["m", "Men’s Residences", ["SEBAST", "TERESA", "STJOSE"]],
];
export const WOMEN_HALLS = ["JPII", "XAVIER", "GORET"];
export const MEN_HALLS = ["TERESA", "SEBAST", "STJOSE"];

export const MELT = { all: 12.6, w: 12.9, m: 12.2 };
export const RET = { all: 91.1, w: 93.5, m: 88.2 };
export const ELIG = { w: 559, m: 510 };
export const GOAL = { w: 254, m: 277 };
/** Planning figure only. Occupancy Rome is eRez price type RSTA, not this constant. */
export const ROME = 25;
/** Placement capacity for Ireland (not eRez headcount). Rome is occupancy-only, not placement. */
export const IRELAND_CAP = { w: 50, m: 50, all: 100 } as const;
export const MAIN_MOVEIN = "2026-08-17";

/** eRez `price_type_id` values on Fall 2026 assignments. */
export const EREZ_PRICE = {
  HALL: "UGDP",
  COMMUTER: "NODM",
  IRELAND: "ISTA",
  ROME: "RSTA",
  COMMUTER_ABROAD: "CSTA",
} as const;

const COMMUTER_CITIES = new Set([
  "naples",
  "ave maria",
  "immokalee",
  "marco island",
  "golden gate",
  "everglades city",
  "bonita springs",
  "bonita",
  "estero",
  "fort myers",
  "cape coral",
  "lehigh acres",
  "north fort myers",
  "fort myers beach",
  "sanibel",
  "captiva",
  "san carlos park",
]);

const GROUP_LABELS: Record<string, string> = {
  FB: "Football",
  VB: "Volleyball",
  BAND: "Band",
  MSOC: "Men's Soccer",
  WSOC: "Women's Soccer",
  XC: "Cross Country",
  "ATHLETIC EARLY ARRIVALS": "Athletics",
};

export type OccIndex = Record<string, Record<string, Resident[]>>;

export function indexOccupancy(residents: Resident[]): OccIndex {
  const occ: OccIndex = {};
  for (const r of residents) {
    if (!r.building || !r.room) continue;
    occ[r.building] ??= {};
    (occ[r.building][r.room] ??= []).push(r);
  }
  return occ;
}

export function visibleOn(p: Resident, d: string): boolean {
  return Boolean(p.move_in && p.move_in <= d && (!p.end_date || p.end_date >= d));
}

export function peopleIn(occ: OccIndex, code: string, num: string, asof: string | null): Resident[] {
  const all = occ[code]?.[num] || [];
  return asof ? all.filter((p) => visibleOn(p, asof)) : all;
}

export function roomKey(hall: string, num: string): string {
  return `${hall}-${num}`;
}

export function isStaffOffLimits(edits: RoomVerificationState["edits"], hall: string, num: string): boolean {
  return edits[roomKey(hall, num)]?.status === "Off-limits";
}

export function isOffLimits(edits: RoomVerificationState["edits"], hall: string, num: string): boolean {
  return isStaffOffLimits(edits, hall, num) || isBibleUnavailable(hall, num);
}

export function effCap(edits: RoomVerificationState["edits"], hall: string, room: ChartRoom): number {
  const raw = edits[roomKey(hall, room.number)]?.capacity;
  if (raw != null && raw !== "") {
    const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    if (Number.isFinite(n)) return n;
  }
  const override = bibleCapOverride(hall, room.number);
  if (override != null) return override;
  return room.cap;
}

export function hallCap(chart: HallChart | undefined, hall: string, edits: RoomVerificationState["edits"]): number {
  if (!chart) return 0;
  let s = 0;
  for (const f of chart.floors) {
    for (const r of f.rooms) {
      if (isOffLimits(edits, hall, r.number)) continue;
      s += effCap(edits, hall, r);
    }
  }
  return s;
}

export function hallResidents(occ: OccIndex, code: string): number {
  let n = 0;
  for (const rm of Object.keys(occ[code] || {})) n += occ[code][rm].length;
  return n;
}

export function bedsOpen(
  chart: HallChart | undefined,
  hall: string,
  occ: OccIndex,
  edits: RoomVerificationState["edits"],
  asof: string | null,
): number {
  if (!chart) return 0;
  let o = 0;
  for (const f of chart.floors) {
    for (const r of f.rooms) {
      if (isOffLimits(edits, hall, r.number)) continue;
      o += Math.max(0, effCap(edits, hall, r) - peopleIn(occ, hall, r.number, asof).length);
    }
  }
  return o;
}

export function sumHalls(codes: string[], fn: (code: string) => number): number {
  return codes.reduce((a, c) => a + fn(c), 0);
}

export function pct(x: number): string {
  return `${Number.isFinite(x) ? x.toFixed(1) : "0.0"}%`;
}

export function remainingMelt(
  rate: number,
  depositTotal: number | undefined,
  withdrawn: number | undefined,
  currentOcc: number,
): number {
  if (depositTotal != null && withdrawn != null) {
    return Math.max(0, Math.round((rate / 100) * depositTotal) - withdrawn);
  }
  return Math.round((currentOcc * rate) / 100);
}

export function isEarly(p: Resident): boolean {
  return Boolean(p.move_in && p.move_in < MAIN_MOVEIN);
}

export function secOf(building?: string): Sec | undefined {
  return building ? META[building]?.sec : undefined;
}

export function priceTypeOf(r: { price_type?: string }): string {
  return (r.price_type || "").trim().toUpperCase();
}

export function isIreland(building?: string): boolean {
  return building === "CIARA" || building === "MALAC";
}

/** Ireland houses in the extra eRez session (CIARA / MALAC). */
export function isAbroad(building?: string): boolean {
  return isIreland(building);
}

/** Resident study abroad (Rome). eRez stores these with price type RSTA and no hall. */
export function isRome(r: { price_type?: string }): boolean {
  return priceTypeOf(r) === EREZ_PRICE.ROME;
}

export function isCommuterAbroad(r: { price_type?: string }): boolean {
  return priceTypeOf(r) === EREZ_PRICE.COMMUTER_ABROAD;
}

export function isCommuter(r: { building?: string; price_type?: string }): boolean {
  return r.building === "Commuter" || isCommuterAbroad(r);
}

/** No hall, and not Rome / commuter-abroad (those also have a blank building_id). */
export function isUnassigned(r: { building?: string; price_type?: string }): boolean {
  return !r.building && !isRome(r) && !isCommuterAbroad(r);
}

export function possibleCommuters(incoming: Resident[]): Resident[] {
  return incoming.filter((r) => {
    const hometown = r.hometown || "";
    const city = (hometown.split(",")[0] || "").trim().toLowerCase();
    const isFL = /,\s*FL\b/i.test(hometown);
    const hasHousing = Boolean(r.building && r.building !== "Commuter");
    return isFL && COMMUTER_CITIES.has(city) && !hasHousing;
  });
}

export function srcLabel(s?: string): string {
  if (!s) return "";
  const mapped: Record<string, string> = { eRez: "eRez", "class-default": "Standard" };
  if (mapped[s]) return mapped[s];
  const base = String(s).split(" - ")[0].trim();
  return GROUP_LABELS[base.toUpperCase()] || base;
}

export function fmtDate(d?: string): string {
  if (!d) return "—";
  const [y, mo, da] = d.split("-");
  if (!da) return d;
  return new Date(Number(y), Number(mo) - 1, Number(da)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isIsoDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export function floorBands(floor: ChartFloor, hall: string, edits: RoomVerificationState["edits"]): ChartRoom[][] {
  const bands: Record<number, ChartRoom[]> = {};
  for (const r of floor.rooms) {
    if (isStaffOffLimits(edits, hall, r.number)) continue;
    (bands[r.row] ??= []).push(r);
  }
  const arr = Object.keys(bands)
    .map((k) => ({ row: Number(k), rooms: bands[Number(k)].slice().sort((a, b) => a.col - b.col) }))
    .sort((a, b) => a.row - b.row);
  const bySize = [...arr].sort((a, b) => b.rooms.length - a.rooms.length);
  let top = bySize[0] || { rooms: [] as ChartRoom[], row: 0 };
  let bot = bySize[1] || { rooms: [] as ChartRoom[], row: 0 };
  if ((top.row || 0) > (bot.row || 0)) {
    const t = top;
    top = bot;
    bot = t;
  }
  const T = top.rooms.slice();
  const B = bot.rooms.slice();
  arr
    .filter((b) => b !== top && b !== bot)
    .flatMap((b) => b.rooms)
    .forEach((r, i) => (i % 2 ? B : T).push(r));
  return [T, B];
}

export function shade(sec: Sec, occ: number, cap: number): string {
  const base = { w: [148, 48, 96], m: [27, 94, 168], o: [31, 107, 66] }[sec];
  if (occ === 0) return "#F4F8FE";
  const a = 0.18 + 0.8 * Math.min(occ / Math.max(cap, 1), 1);
  return `rgba(${base[0]},${base[1]},${base[2]},${a.toFixed(2)})`;
}

export function shortReason(r: string): string {
  if (r.includes("Sport mismatch")) return "Sport mismatch";
  if (r.includes("roster or a student manager")) return "No roster/manager status";
  if (r.includes("athletic")) return "Athlete not confirmed";
  if (r.includes("Not matched")) return "Not in roster";
  if (r.includes("multiple")) return "Multiple groups";
  return r;
}

export function statusLabel(p: Resident): string {
  let s = p.student_type || "Resident";
  if (p.transfer && !/Transfer/.test(s)) s += " · Transfer";
  return s;
}
