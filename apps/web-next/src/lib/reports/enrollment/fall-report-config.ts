/**
 * Static lookups for the Fall Admissions Report tables.
 * Live application / accept / deposit counts are never stored here —
 * those come from the Slate admissions feed. These cells have no
 * applicant-feed source (planning targets, FTE census, sport list).
 */

export const TUITION = 33315;

export const STUDENT_TYPE_LABELS = [
  "First-Time Freshmen",
  "Transfer",
  "Re-Admit",
  "Second Bachelor's",
] as const;

export type StudentTypeLabel = (typeof STUDENT_TYPE_LABELS)[number];

/** Extra accepted decision codes (PDF note 6). */
export const EXTRA_ACCEPT_CODES = ["ADM", "COMM", "COND"] as const;

export const CONDITIONAL_CODES = ["CA", "COND"] as const;

/**
 * Current Varsity NAIA associations (PDF note 5).
 * Matching is canonicalized (gender tokens, hyphens vs spaces).
 */
export const NAIA_SPORTS = [
  "Competitive Dance",
  "Baseball",
  "Basketball-Men",
  "Basketball-Women",
  "Color Guard-Dance",
  "Football",
  "Golf-Men",
  "Golf-Women",
  "Soccer-Men",
  "Soccer-Women",
  "Softball",
  "Swimming Men",
  "Swimming Women",
  "Tennis-Men",
  "Tennis-Women",
  "Track Men",
  "Track Women",
  "Volleyball",
  "Cross Country-Men",
  "Cross Country-Women",
  "Lacrosse",
] as const;

/** Removed from the athlete count starting FA26 recruitment (9/16/2025). */
export const REMOVED_FROM_ATHLETE_FA26 = [
  "Pickleball",
  "Band",
  "Rugby",
  "Ultimate Frisbee",
  "Ultimate",
] as const;

export type YearMetric = {
  apps: number | null;
  accepted: number | null;
  deposits: number | null;
};

export type AidGoal = { aid: number | null; dr: number | null };

/** YEAR (FALL) GOAL — planning targets, not live Slate counts. */
export const YEAR_GOAL: Record<number, YearMetric> = {
  2020: { apps: 3000, accepted: 1400, deposits: 350 },
  2021: { apps: 3600, accepted: 1560, deposits: 475 },
  2022: { apps: 4500, accepted: 1600, deposits: 462 },
  2023: { apps: 3900, accepted: 1600, deposits: 480 },
  2024: { apps: 3220, accepted: 1450, deposits: 460 },
};

/**
 * YEAR (FALL) FINAL — official census. Deposit FINAL is FTE
 * (PDF note 1), not all active deposits. In-progress year is N/A.
 */
export const YEAR_FINAL: Record<number, YearMetric> = {
  2020: { apps: 2959, accepted: 1808, deposits: 363 },
  2021: { apps: 4211, accepted: 2611, deposits: 501 },
  2022: { apps: 3405, accepted: 1503, deposits: 432 },
  2023: { apps: 2864, accepted: 1289, deposits: 411 },
  2024: { apps: 3127, accepted: 1254, deposits: 427 },
  2025: { apps: 2793, accepted: 1099, deposits: 457 },
};

export const AID_GOAL: Record<number, AidGoal> = {
  2023: { aid: 14577, dr: 54.0 },
  2024: { aid: 15848, dr: 55.0 },
  2025: { aid: 15733, dr: 52.0 },
  2026: { aid: 17315, dr: 52.0 },
};
