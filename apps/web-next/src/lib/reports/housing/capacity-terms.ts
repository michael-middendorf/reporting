/** Capacity Quest terms. Fall 2026 is the live assignment sheet. Later terms are projections from that pull. */

export type CapacityTermId = "fa26" | "sp27" | "fa27";

export type CapacityKind = "live" | "projection";

export type CapacitySessions = {
  domestic: string;
  ireland: string;
};

export type CapacityTerm = {
  id: CapacityTermId;
  label: string;
  /** Live occupancy, or a projection from the Fall 2026 pull. */
  kind: CapacityKind;
  sessions: CapacitySessions | null;
};

export const CAPACITY_TERMS: readonly CapacityTerm[] = [
  {
    id: "fa26",
    label: "Fall 2026",
    kind: "live",
    sessions: { domestic: "2026FALL01", ireland: "2026FALL03Ireland" },
  },
  {
    id: "sp27",
    label: "Spring 2027",
    kind: "projection",
    sessions: null,
  },
  {
    id: "fa27",
    label: "Fall 2027",
    kind: "projection",
    sessions: null,
  },
];

const FALL_2026 = CAPACITY_TERMS[0];

export function capacityTermById(id: string | null | undefined): CapacityTerm {
  return CAPACITY_TERMS.find((term) => term.id === id) ?? FALL_2026;
}
