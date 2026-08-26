import { readResidents } from "../housing/store";
import type { Resident } from "../housing/types";
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
}> {
  const data = presentSnapshot(cloneSnapshot());
  try {
    const payload = await readResidents();
    const residents = (payload?.residents || []) as Resident[];
    if (residents.length === 0) {
      return { data, housingRows: [] };
    }
    applyHousingOverlay(data, residents, {
      generated: payload?.generated ?? payload?.cached_at ?? null,
      session: payload?.session ?? null,
    });
    return { data, housingRows: housingAssignmentRows(residents) };
  } catch {
    return { data, housingRows: [] };
  }
}
