import { readResidents } from "../housing/store";
import type { Resident } from "../housing/types";
import {
  applyErezResidency,
  deriveUnretained,
  loadCensusLists,
  markIrelandReturning,
  type CensusLists,
} from "./lists";
import {
  ayGraduatePcids,
  buildAllUgSplit,
  buildFtcaAttritionFromPrior,
  collectGpa,
  deriveFtcaRaw,
  toUnretainedSeed,
  type FtcaRawRow,
} from "./retention";
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
      housingRows = housingAssignmentRows(residents);
      lists = { ...lists, students: applyErezResidency(lists.students, housingRows) };
      applyHousingOverlay(data, residents, {
        generated: payload?.generated ?? payload?.cached_at ?? null,
        session: payload?.session ?? null,
      });
    }
  } catch {
    housingRows = [];
  }
  if (lists.students.length) {
    lists = { ...lists, students: markIrelandReturning(lists.students, housingRows) };
    applyRegistrationTotals(data, lists.students);
  }
  if (lists.prior.length && lists.students.length) {
    const gradIds = ayGraduatePcids(lists.graduates);
    lists = {
      ...lists,
      unretained: deriveUnretained(
        toUnretainedSeed(lists.prior),
        lists.students.map((s) => s.pcid),
        gradIds,
      ),
    };
    const gpa = collectGpa(lists);
    const currentIds = lists.students.map((s) => s.pcid);
    data.ftcaAttrition = buildFtcaAttritionFromPrior(lists.prior, currentIds, lists.graduates, gpa);
    const ug = buildAllUgSplit(lists.prior, currentIds, lists.graduates);
    data.allUgRetention = {
      priorUg: ug.all.students,
      graduates: ug.all.graduated,
      pool: ug.all.students - ug.all.graduated,
      enrolledThisFall: ug.all.enrolled,
      notRetained: ug.all.notRetained,
      retentionRate: ug.all.retentionPct ?? 0,
    };
  }
  const ftcaRaw = lists.prior.length
    ? deriveFtcaRaw(lists.prior, lists.students, lists.graduates)
    : [];
  return { data, housingRows, lists, ftcaRaw };
}
