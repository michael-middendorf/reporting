import { eligibleIncomingSigned } from "./normalize";
import type { AthleticsRecord } from "./types";
import { resolveGenderedSportKey } from "../athletics-coaching/sports";

export type RecruitingOverviewStats = {
  applications: number;
  prospects: number;
  signed: number;
  signedWithAid: number;
  totalScholarshipSigned: number;
  avgScholarshipSigned: number | null;
  allAwards: number;
  totalScholarshipAll: number;
  avgScholarshipAll: number | null;
};

/** Map a Slate application/prospect row onto a coaching sport key. */
export function coachingSportKeyForRecord(record: Pick<AthleticsRecord, "sport" | "gender">): string | null {
  return resolveGenderedSportKey(record.sport, record.gender);
}

export function recordMatchesCoachingSport(record: AthleticsRecord, sportKey: string): boolean {
  return coachingSportKeyForRecord(record) === sportKey;
}

export function recruitingOverviewStats(
  applications: AthleticsRecord[],
  prospects: AthleticsRecord[],
  sportKey: string,
): RecruitingOverviewStats {
  const rows = applications.filter((record) => recordMatchesCoachingSport(record, sportKey));
  const prospectRows = prospects.filter((record) => recordMatchesCoachingSport(record, sportKey));
  const signed = rows.filter(eligibleIncomingSigned);
  const signedWithAid = signed.filter((record) => record.athleticScholarship > 0);
  const allAwards = rows.filter((record) => record.athleticScholarship > 0);
  const totalSigned = signedWithAid.reduce((sum, record) => sum + record.athleticScholarship, 0);
  const totalAll = allAwards.reduce((sum, record) => sum + record.athleticScholarship, 0);
  return {
    applications: rows.length,
    prospects: prospectRows.length,
    signed: signed.length,
    signedWithAid: signedWithAid.length,
    totalScholarshipSigned: totalSigned,
    avgScholarshipSigned: signedWithAid.length ? totalSigned / signedWithAid.length : null,
    allAwards: allAwards.length,
    totalScholarshipAll: totalAll,
    avgScholarshipAll: allAwards.length ? totalAll / allAwards.length : null,
  };
}
