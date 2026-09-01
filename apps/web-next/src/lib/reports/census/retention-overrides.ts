import { normPcid, type CensusRawStudent } from "./lists-core";
import type { GraduateRecord } from "./retention";

/** Dropped after FA25 census — out of the FA25 cohort for F26 retention. */
export const RETENTION_EXCLUDE = new Set(["P000384377", "P000378273"].map(normPcid)); // Aiden Wilson; Hannah Nelson (deceased)

/** AMSOL / still enrolled / finishing credits — count as retained even if not UG-registered. */
export const RETENTION_FORCE_RETAINED = new Set(
  ["P000352989", "P000380426", "P000343155", "P000379038"].map(normPcid),
); // Trumpore AMSOL; Harrell enrolled; Pritchard last credits; Parks AMSOL

/** Intervening graduates missing from the PowerCampus graduate extract. */
export const RETENTION_FORCE_GRADUATED: GraduateRecord[] = [
  ...["P000358025", "P000341586", "P000342817"].map((pcid) => ({ pcid, year: "2025", term: "FALL" })),
  { pcid: "P000346202", year: "2026", term: "SPRING" },
  ...[
    "P000347161",
    "P000354952",
    "P000357988",
    "P000345243",
    "P000379261",
    "P000343142",
    "P000354723",
    "P000346640",
    "P000347632",
    "P000345979",
    "P000343474",
    "P000349726",
    "P000381969",
    "P000354719",
    "P000383151",
    "P000358530",
  ].map((pcid) => ({ pcid, year: "2026", term: "SUMMER" })),
];

export function applyCensusRetentionNotes(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): { prior: CensusRawStudent[]; currentIds: string[]; graduates: GraduateRecord[] } {
  return {
    prior: prior.filter((s) => !RETENTION_EXCLUDE.has(normPcid(s.pcid))),
    currentIds: [...new Set([...currentPcids].map(normPcid).filter(Boolean)), ...RETENTION_FORCE_RETAINED],
    graduates: [...grads, ...RETENTION_FORCE_GRADUATED],
  };
}
