import { readResidents } from "../housing/store";
import type { Resident } from "../housing/types";
import {
  applyErezResidency,
  deriveUnretained,
  loadCensusLists,
  markIrelandReturning,
  promoteFormerDualFtca,
  type CensusLists,
} from "./lists";
import {
  ayGraduatePcids,
  buildAllUgSplit,
  applyLiveRetentionHistory,
  buildFtcaAttritionFromPrior,
  collectGpa,
  deriveFtcaRaw,
  toUnretainedSeed,
  type FtcaRawRow,
} from "./retention";
import {
  applyCensusRetentionNotes,
  loaStudentsFromNotes,
  markUnretainedNotes,
  omitLeaveOfAbsence,
} from "./retention-overrides";
import { applyCensusVerifyNotes, omitExcludedHousing } from "./verify-notes";
import snapshot from "./snapshot.json";
import { presentSnapshot } from "./present";
import { housingAssignmentRows, residencyFromErez, type HousingAssignmentRow } from "./residency";
import { applyRegistrationTotals } from "./from-lists";
import { HOUSING_PENDING, type CensusSnapshot } from "./types";

function cloneSnapshot(): CensusSnapshot {
  return structuredClone(snapshot) as CensusSnapshot;
}

export function applyHousingOverlay(
  data: CensusSnapshot,
  residents: Resident[],
  meta?: { generated?: string | null; session?: string | null },
): CensusSnapshot {
  const ugN = data.ug.n || data.kpis.ugStudents;
  const result = residencyFromErez(residents, ugN);
  data.ug.residency = result.rows;
  data.kpis.ugOnCampusPct = result.ugOnCampusPct;
  data.housing = {
    ...result.housing,
    generated: meta?.generated ?? result.housing.generated,
    session: meta?.session ?? result.housing.session,
  };
  data.pending = data.pending.filter((p) => p !== HOUSING_PENDING && !/^Housing\b/i.test(p));
  return data;
}

export async function loadCensusSnapshot(): Promise<{
  data: CensusSnapshot;
  housingRows: HousingAssignmentRow[];
  lists: CensusLists;
  ftcaRaw: FtcaRawRow[];
}> {
  const data = presentSnapshot(cloneSnapshot());
  let lists = await loadCensusLists();
  let housingRows: HousingAssignmentRow[] = [];
  try {
    const payload = await readResidents();
    const residents = (payload?.residents || []) as Resident[];
    if (residents.length) {
      const kept = omitExcludedHousing(residents);
      housingRows = housingAssignmentRows(kept);
      lists = { ...lists, students: applyErezResidency(lists.students, housingRows) };
      applyHousingOverlay(data, kept, {
        generated: payload?.generated ?? payload?.cached_at ?? null,
        session: payload?.session ?? null,
      });
    }
  } catch {
    housingRows = [];
  }
  if (lists.students.length) {
    lists = { ...lists, students: markIrelandReturning(lists.students, housingRows) };
    if (lists.prior.length) {
      lists = { ...lists, students: promoteFormerDualFtca(lists.students, lists.prior) };
    }
    lists = { ...lists, students: applyCensusVerifyNotes(lists.students) };
    applyRegistrationTotals(data, lists.students);
  }
  if (lists.prior.length) {
    lists = { ...lists, prior: applyCensusVerifyNotes(lists.prior) };
  }
  if (lists.prior.length && lists.students.length) {
    const notes = applyCensusRetentionNotes(lists.prior, lists.students.map((s) => s.pcid), lists.graduates);
    const gradIds = ayGraduatePcids(notes.graduates);
    const priorById = new Map(lists.prior.map((p) => [(p.pcid || "").toUpperCase(), p]));
    lists = {
      ...lists,
      unretained: omitLeaveOfAbsence(
        markUnretainedNotes(
          deriveUnretained(
            toUnretainedSeed(notes.prior),
            notes.currentIds,
            gradIds,
          ).map((s) => {
            const prior = priorById.get((s.pcid || "").toUpperCase());
            return {
              ...s,
              credits: s.credits ?? prior?.credits ?? "",
              earnedCredits: s.earnedCredits || prior?.earnedCredits || "",
            };
          }),
        ),
      ),
    };
    const gpa = collectGpa(lists);
    const currentIds = notes.currentIds;
    data.ftcaAttrition = buildFtcaAttritionFromPrior(notes.prior, currentIds, notes.graduates, gpa);
    const ug = buildAllUgSplit(notes.prior, currentIds, notes.graduates);
    data.allUgRetention = {
      priorUg: ug.all.students,
      graduates: ug.all.graduated,
      pool: ug.all.students - ug.all.graduated,
      enrolledThisFall: ug.all.enrolled,
      notRetained: ug.all.notRetained,
      retentionRate: ug.all.retentionPct ?? 0,
    };
    applyLiveRetentionHistory(data, data.ftcaAttrition.retentionRate, data.allUgRetention.retentionRate);
  }
  lists = { ...lists, loaFall: loaStudentsFromNotes(lists.prior) };
  const ftcaRaw = lists.prior.length
    ? deriveFtcaRaw(lists.prior, lists.students, lists.graduates)
    : [];
  return { data, housingRows, lists, ftcaRaw };
}
