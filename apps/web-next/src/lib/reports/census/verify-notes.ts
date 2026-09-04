import { isBlankCensusState, normPcid, type CensusRawStudent } from "./lists-core";

/**
 * Fall 2026 Verify-tab notes (last column). Applied after eRez / Ireland
 * residency so they win.
 */

/** Off-campus / commuter — overrides Unassigned. Shephard stays Ireland (commuter at MM). */
export const CENSUS_RESIDENCY_NOTES: Record<string, string> = {
  P000352989: "Commuter", // Andrew Trumpore — off-campus; attending AMSOL
};

/**
 * Intervening UG (or MA) graduates who are on Fall 2026 registration.
 * Registration Status marks them Returning because they were here last year;
 * the note says how to count the new program.
 */
export const CENSUS_INCOMING_NOTES: Record<string, "Incoming" | "Returning"> = {
  P000339472: "Incoming", // Anthony Cabrera — incoming phd
  P000343255: "Incoming", // Ivy Verburgt — started mba in summer; fall incoming mba
  P000343257: "Incoming", // Lily Verburgt — started mba in summer; fall incoming mba
  P000343498: "Incoming", // Victoria Smith — incoming ma
  P000343906: "Returning", // Elena Barnes — current mba
  P000343989: "Incoming", // Samuel Little — incoming mba
  P000344149: "Incoming", // Magdalen Gross — incoming ma
  P000344159: "Incoming", // Simon Tan — incoming ma
  P000345086: "Incoming", // Robert Lee — incoming mba
  P000346145: "Returning", // Michael Kelly — started mba spring 2026; mba returning
  P000346438: "Incoming", // Judea Sonntag — incoming ma
  P000349612: "Incoming", // Wesley From — mba over summer; incoming fall 2026
  P000352027: "Incoming", // Isaac Cordero — incoming ma phil
  P000358027: "Incoming", // Tharcisse Onema — incoming phd
  P000379206: "Incoming", // Marcus Wiseman — enrolling in ma theology
  P000381942: "Returning", // Talia Pellegrini — started mba in spring; returning grad
};

/** Arrived, never registered, should be out of the halls. Do not count the eRez room. */
export const CENSUS_HOUSING_EXCLUDE = new Set(["P000382666"].map(normPcid)); // Jack Pankratz

/** Dual UG+GRAD: count undergraduate only (drop the graduate/Lux Mundi row). */
export const CENSUS_UNDERG_ONLY = new Set(["P000390750"].map(normPcid)); // Arianna Rodriguez

/** Sport corrections. Peloso is rugby, not ultimate frisbee. */
export const CENSUS_SPORT_NOTES: Record<string, string> = {
  P000382172: "Rugby-Men", // Christopher Peloso
};

/** Registration Class is blank. Incoming SECB are Freshman (Battis, Nored, Schantz). */
export const CENSUS_CLASS_NOTES: Record<string, string> = {
  P000389994: "Freshman", // John O'Connor — Incoming SECB, 0 credits
};

/**
 * US state from FA25 Incoming Students Census 20260903-135650 Person State.
 * Canadians and FC stay blank so tables list them as International.
 * Fills blank/"-" only. Does not overwrite a filled state.
 */
export const CENSUS_STATE_NOTES: Record<string, string> = {
  P000384774: "UT", // Zachary Szymakowski
};

export function applyCensusVerifyNotes(
  students: CensusRawStudent[],
  opts?: { incomingNotes?: boolean },
): CensusRawStudent[] {
  const useIncoming = opts?.incomingNotes !== false;
  return dropGraduateIfUndergOnly(
    students.map((s) => {
      const id = normPcid(s.pcid);
      const residency = CENSUS_RESIDENCY_NOTES[id];
      const incomingReturning = useIncoming ? CENSUS_INCOMING_NOTES[id] : undefined;
      const sport = CENSUS_SPORT_NOTES[id];
      const classLevel = CENSUS_CLASS_NOTES[id];
      const stateNote = CENSUS_STATE_NOTES[id];
      const state = stateNote && isBlankCensusState(s.state) ? stateNote : undefined;
      if (!residency && !incomingReturning && !sport && !state && !classLevel) return s;
      return {
        ...s,
        ...(residency ? { residency } : {}),
        ...(incomingReturning ? { incomingReturning } : {}),
        ...(sport ? { sport, athlete: "Athlete" } : {}),
        ...(state ? { state } : {}),
        ...(classLevel ? { classLevel } : {}),
      };
    }),
  );
}

export function dropGraduateIfUndergOnly(students: CensusRawStudent[]): CensusRawStudent[] {
  return students.filter((s) => {
    if (!CENSUS_UNDERG_ONLY.has(normPcid(s.pcid))) return true;
    return (s.program || "").trim().toUpperCase() !== "GRAD";
  });
}

export function omitExcludedHousing<T extends { pcid?: string }>(rows: T[]): T[] {
  return rows.filter((r) => !CENSUS_HOUSING_EXCLUDE.has(normPcid(r.pcid || "")));
}
