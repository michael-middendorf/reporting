/* Typed wrappers around untyped points JS scoring modules. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const points = require("./points.js") as {
  scoreAll: (input: { notes: unknown[]; gifts?: unknown[] }) => unknown[];
  scoreEventsForDisplay: (events: unknown[]) => unknown[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const aggregateMod = require("./aggregate.js") as {
  aggregate: (rows: unknown[], opts: { start: Date | null; end: Date | null }) => unknown;
  dailyTotals: (rows: unknown[]) => unknown[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reportMod = require("./report.js") as {
  buildCalculationCSV: (
    model: unknown,
    opts?: {
      meta?: Record<string, unknown>;
      rangeLabel?: string;
      generatedOn?: string;
      flags?: Record<string, unknown>;
    },
  ) => string;
  downloadText: (filename: string, text: string, mime?: string) => void;
  virtuousContactUrl: (contactId: unknown) => string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require("./config.js") as {
  TIERS: Array<{ id: string; label: string; min: number; payout?: number; color?: string }>;
  tierFor: (avg: number) => { id: string; label: string; min: number; color?: string };
  POINTS_MAP: Record<string, unknown>;
  CONFLICTS: Record<string, unknown>;
  DAY_TARGETS: Record<string, { points: number; blurb: string }>;
  BUCKETS: Array<{ id: string; label: string; points: number; color: string }>;
  DEFINITIONS: Array<{ term: string; text: string }>;
};

export const scoreAll = points.scoreAll;
export const scoreEventsForDisplay = points.scoreEventsForDisplay;
export const buildCalculationCSV = reportMod.buildCalculationCSV;
export const downloadText = reportMod.downloadText;
export const virtuousContactUrl = reportMod.virtuousContactUrl;
export const aggregate = aggregateMod.aggregate;
export const dailyTotals = aggregateMod.dailyTotals;
export const TIERS = config.TIERS;
export const tierFor = config.tierFor;
export const POINTS_MAP = config.POINTS_MAP;
export const CONFLICTS = config.CONFLICTS;
export const DAY_TARGETS = config.DAY_TARGETS;
export const BUCKETS = config.BUCKETS;
export const DEFINITIONS = config.DEFINITIONS;
