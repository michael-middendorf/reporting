/**
 * St. Joseph priest rooms named by Jeff Stankovsky on 7 Sep 2026.
 * 311/313/314/315 are already capacity 0. 307/308 stay student doubles
 * so the residence-hall total remains 1,203.
 */

export const JOSEPH_PRIEST_EXCLUDED = [
  "311A",
  "311B",
  "313A",
  "313B",
  "314A",
  "314B",
  "315A",
  "315B",
] as const;

export const JOSEPH_PRIEST_HOLDS = ["307A", "307B", "308A", "308B"] as const;

/** Eight priest doubles, already outside the 1,203. */
export const JOSEPH_PRIEST_EXCLUDED_BEDS = 16;

/** Four doubles still inside the 1,203. */
export const JOSEPH_PRIEST_HOLD_BEDS = 8;
