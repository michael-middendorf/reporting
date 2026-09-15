import { eligibleIncomingSigned } from "./normalize";
import type { AthleticsRecord } from "./types";
import { resolveSportKey } from "../athletics-coaching/sports";

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

function genderToken(value: string): "M" | "F" | null {
  const folded = value.trim().toLowerCase();
  if (folded === "m" || folded === "male" || folded === "man" || folded === "men") return "M";
  if (folded === "f" || folded === "female" || folded === "w" || folded === "woman" || folded === "women") {
    return "F";
  }
  return null;
}

/** Map a Slate application/prospect row onto a coaching sport key. */
export function coachingSportKeyForRecord(record: Pick<AthleticsRecord, "sport" | "gender">): string | null {
  const direct = resolveSportKey(record.sport);
  if (direct) return direct;
  const folded = record.sport.trim().toLowerCase();
  const gender = genderToken(record.gender);
  if (folded === "basketball") {
    if (gender === "F") return "womens-basketball";
    if (gender === "M") return "mens-basketball";
    return null;
  }
  if (folded === "soccer") {
    if (gender === "F") return "womens-soccer";
    if (gender === "M") return "mens-soccer";
    return null;
  }
  if (folded === "golf") {
    if (gender === "F") return "womens-golf";
    if (gender === "M") return "mens-golf";
    return null;
  }
  return null;
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
