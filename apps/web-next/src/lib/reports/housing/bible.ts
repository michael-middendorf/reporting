/**
 * Residence Hall Bible (5.7.2024) capacity filter, plus Jeff Stankovsky
 * 7 Sep 2026 named rooms (Joseph priests 307/308/311-315, Teresa 402,
 * JPII ghost 240/340, Joseph 207A ADA, Sebastian 153 double).
 *
 * Campus 1203 here includes this-year Joseph 307/308 (Joseph 127 not bible
 * 135). JPII 104 is not on the chart so JPII is 260 vs bible 262. Teresa
 * 276 vs bible 268 (only 402 named). Remaining unlabeled Teresa extras
 * are not guessed.
 */

/** Rooms the bible / Jeff count as 0 beds (emergency, priest, showroom, ghost tiles). */
export const BIBLE_UNAVAILABLE: Record<string, ReadonlySet<string>> = {
  GORET: new Set(["163"]),
  XAVIER: new Set(["163"]),
  JPII: new Set(["318", "240", "340"]),
  SEBAST: new Set(["137", "355"]),
  STJOSE: new Set([
    "215A",
    "215B",
    "307A",
    "307B",
    "308A",
    "308B",
    "311A",
    "311B",
    "313A",
    "313B",
    "314A",
    "314B",
    "315A",
    "315B",
  ]),
  TERESA: new Set(["318", "402"]),
};

/** ADA / designed-cap corrections where the chart overstates beds. Staff edits still win at runtime. */
export const BIBLE_CAP_OVERRIDES: Record<string, Record<string, number>> = {
  GORET: { "151": 2, "251": 1, "351": 1 },
  XAVIER: { "251": 1, "351": 1 },
  STJOSE: { "207A": 1 },
  SEBAST: { "153": 2 },
};

export function isBibleUnavailable(hall: string, room: string): boolean {
  return BIBLE_UNAVAILABLE[hall]?.has(room) === true;
}

export function bibleCapOverride(hall: string, room: string): number | undefined {
  return BIBLE_CAP_OVERRIDES[hall]?.[room];
}
