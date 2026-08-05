/* Typed wrappers around untyped points JS scoring modules. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const points = require("./points.js") as {
  scoreAll: (input: { notes: unknown[] }) => unknown[];
  scoreEventsForDisplay: (events: unknown[]) => unknown[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const aggregateMod = require("./aggregate.js") as {
  aggregate: (rows: unknown[], opts: { start: Date | null; end: Date | null }) => unknown;
  dailyTotals: (rows: unknown[]) => unknown[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require("./config.js") as {
  TIERS: Array<{ id: string; label: string; min: number; payout?: number; color?: string }>;
  tierFor: (avg: number) => { id: string; label: string; min: number; color?: string };
  POINTS_MAP: Record<string, unknown>;
  CONFLICTS: Record<string, unknown>;
  DAY_TARGETS: Record<string, { points: number; blurb: string }>;
};

export const scoreAll = points.scoreAll;
export const scoreEventsForDisplay = points.scoreEventsForDisplay;
export const aggregate = aggregateMod.aggregate;
export const dailyTotals = aggregateMod.dailyTotals;
export const TIERS = config.TIERS;
export const tierFor = config.tierFor;
export const POINTS_MAP = config.POINTS_MAP;
export const CONFLICTS = config.CONFLICTS;
export const DAY_TARGETS = config.DAY_TARGETS;
