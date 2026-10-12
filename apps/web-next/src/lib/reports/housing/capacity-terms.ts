/** Capacity Quest terms. Fall 2026 is the live Stats sheet. Later terms stay listed until their eRez sessions and planning numbers are on file. */

export type CapacityTermId = "fa26" | "sp27" | "fa27";

export type CapacitySessions = {
  domestic: string;
  ireland: string;
};

export type CapacityTerm = {
  id: CapacityTermId;
  label: string;
  /** Live occupancy and planning constants exist for this term. */
  ready: boolean;
  sessions: CapacitySessions | null;
  /** Shown in place of the sheet when `ready` is false. */
  pending: string | null;
};

export const CAPACITY_TERMS: readonly CapacityTerm[] = [
  {
    id: "fa26",
    label: "Fall 2026",
    ready: true,
    sessions: { domestic: "2026FALL01", ireland: "2026FALL03Ireland" },
    pending: null,
  },
  {
    id: "sp27",
    label: "Spring 2027",
    ready: false,
    sessions: null,
    pending:
      "Spring 2027 is on this dashboard. Figures wait on the eRez session id and the planning numbers for this term: melt, retention, eligible returners, and the incoming goal.",
  },
  {
    id: "fa27",
    label: "Fall 2027",
    ready: false,
    sessions: null,
    pending:
      "Fall 2027 is on this dashboard. Figures wait on the eRez session id and the planning numbers for this term: melt, retention, eligible returners, and the incoming goal.",
  },
];

const FALL_2026 = CAPACITY_TERMS[0];

export function capacityTermById(id: string | null | undefined): CapacityTerm {
  return CAPACITY_TERMS.find((term) => term.id === id) ?? FALL_2026;
}
