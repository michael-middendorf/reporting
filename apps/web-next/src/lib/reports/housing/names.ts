import type { HallMeta } from "./types";

export const TERM = { FA: "FA", SP: "SP", SU: "SU", WI: "WI" } as const;
export type TermCode = (typeof TERM)[keyof typeof TERM];

/** Official Residence Hall labels. eRez building_id is the key. */
export const HALL_REGISTRY: Record<string, HallMeta> = {
  JPII: { abbr: "JPII", name: "St. John Paul II Hall", short: "John Paul II", sec: "w", std: 4 },
  XAVIER: { abbr: "Xav", name: "Francis Xavier Hall", short: "Xavier", sec: "w", std: 3 },
  GORET: { abbr: "Gor", name: "Maria Goretti Hall", short: "Goretti", sec: "w", std: 3 },
  TERESA: { abbr: "MT", name: "St. Mother Teresa Hall", short: "Mother Teresa", sec: "m", std: 4 },
  SEBAST: { abbr: "Seb", name: "St. Sebastian Hall", short: "Sebastian", sec: "m", std: 3 },
  STJOSE: { abbr: "JOS", name: "St. Joseph Hall", short: "Joseph", sec: "m", std: 2 },
};

export const HALL_CODES = ["JPII", "XAVIER", "GORET", "TERESA", "SEBAST", "STJOSE"] as const;
export type HallCode = (typeof HALL_CODES)[number];
