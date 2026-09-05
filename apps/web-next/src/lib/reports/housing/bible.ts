/**
 * Residence Hall Bible (5.7.2024) capacity filter.
 *
 * Named emergency / admissions-show / priest rooms the bible counts as 0 beds.
 * Do not invent Joseph priest numbers, Teresa show, JPII extra suite, or
 * Sebastian 153/167. Remaining ~38 beds vs the bible campus total of 1203
 * are intentionally unlabeled.
 */

/** Rooms that the 5.7.2024 Residence Hall Bible counts as 0 beds (emergency, admissions show, priest). */
export const BIBLE_UNAVAILABLE: Record<string, ReadonlySet<string>> = {
  GORET: new Set(["163"]),
  XAVIER: new Set(["163"]),
  JPII: new Set(["318"]),
  SEBAST: new Set(["137", "355"]),
  STJOSE: new Set(["215A", "215B"]),
  TERESA: new Set(["318"]),
};

/** ADA / designed-cap corrections where the chart overstates beds. Staff edits still win at runtime. */
export const BIBLE_CAP_OVERRIDES: Record<string, Record<string, number>> = {
  GORET: { "151": 2, "251": 1, "351": 1 },
  XAVIER: { "251": 1, "351": 1 },
};

export function isBibleUnavailable(hall: string, room: string): boolean {
  return BIBLE_UNAVAILABLE[hall]?.has(room) === true;
}

export function bibleCapOverride(hall: string, room: string): number | undefined {
  return BIBLE_CAP_OVERRIDES[hall]?.[room];
}
