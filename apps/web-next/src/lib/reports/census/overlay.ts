import { readResidents } from "../housing/store";
import type { Resident } from "../housing/types";
import { applyErezResidency, loadCensusLists, type CensusLists } from "./lists";
import snapshot from "./snapshot.json";
import { presentSnapshot } from "./present";
import { housingAssignmentRows, residencyFromErez, type HousingAssignmentRow } from "./residency";
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
}> {
  const data = presentSnapshot(cloneSnapshot());
  const lists = await loadCensusLists();
  try {
    const payload = await readResidents();
    const residents = (payload?.residents || []) as Resident[];
    if (residents.length === 0) {
      return { data, housingRows: [], lists };
    }
    applyHousingOverlay(data, residents, {
      generated: payload?.generated ?? payload?.cached_at ?? null,
      session: payload?.session ?? null,
    });
    const housingRows = housingAssignmentRows(residents);
    return {
      data,
      housingRows,
      lists: { ...lists, students: applyErezResidency(lists.students, housingRows) },
    };
  } catch {
    return { data, housingRows: [], lists };
  }
}
