/* Typed wrappers around untyped points JS scoring modules. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const points = require("./points.js") as {
  scoreAll: (input: { notes: unknown[]; gifts?: unknown[] }) => unknown[];
  scoreEventsForDisplay: (events: unknown[]) => unknown[];
  prepareGifts: (posted?: unknown[], recurring?: unknown[]) => unknown[];
  isMonthlyRecurring: (record: unknown) => boolean;
  assignedNotesFromFlags: (flags?: Record<string, unknown>) => unknown[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const aggregateMod = require("./aggregate.js") as {
  aggregate: (
    rows: unknown[],
    opts: { start: Date | null; end: Date | null; flags?: Record<string, unknown> },
  ) => unknown;
  dailyTotals: (rows: unknown[]) => unknown[];
  rowId: (r: unknown) => string | null;
  weekKey: (d: Date) => string;
  weekLabel: (key: string) => string;
  daysOfWeek: (mondayKey: string) => string[];
  trackerBreakdown: (
    rows: unknown[],
    layout?: unknown,
  ) => {
    lines: Array<{ id: string; label: string; section: boolean; indent: boolean; count: number; points: number }>;
    totalPoints: number;
    totalCount: number;
  };
  trackerSpec: (id: string | null, layout?: unknown) => { types: string[]; buckets: string[] } | null;
  rowMatchesTracker: (r: unknown, spec: { types: string[]; buckets: string[] } | null) => boolean;
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
  virtuousGiftUrl: (contactId: unknown) => string;
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
  TRACKER_LAYOUT: unknown[];
  TRACKING_CHART: {
    refresh: string;
    gifts: Array<{ label: string; detail: string }>;
    rows: Array<{ tracker: string; type: string; pts: number }>;
  };
  SETTINGS: { evalStart: string };
  evalStartDate: () => Date;
  MA_ROSTER: Array<{ name: string; short?: string; email?: string }>;
  noteTypeForIncoming: (kind?: string, assist?: boolean) => string;
  maForEmail: (email?: string) => { name: string; short?: string; email?: string } | null;
};

export const scoreAll = points.scoreAll;
export const assignedNotesFromFlags = points.assignedNotesFromFlags;
export const scoreEventsForDisplay = points.scoreEventsForDisplay;
export const prepareGifts = points.prepareGifts;
export const isMonthlyRecurring = points.isMonthlyRecurring;
export const buildCalculationCSV = reportMod.buildCalculationCSV;
export const downloadText = reportMod.downloadText;
export const virtuousContactUrl = reportMod.virtuousContactUrl;
export const virtuousGiftUrl = reportMod.virtuousGiftUrl;
export const aggregate = aggregateMod.aggregate;
export const dailyTotals = aggregateMod.dailyTotals;
export const rowId = aggregateMod.rowId;
export const weekKey = aggregateMod.weekKey;
export const weekLabel = aggregateMod.weekLabel;
export const daysOfWeek = aggregateMod.daysOfWeek;
export const trackerBreakdown = aggregateMod.trackerBreakdown;
export const trackerSpec = aggregateMod.trackerSpec;
export const rowMatchesTracker = aggregateMod.rowMatchesTracker;
export const TIERS = config.TIERS;
export const tierFor = config.tierFor;
export const POINTS_MAP = config.POINTS_MAP;
export const CONFLICTS = config.CONFLICTS;
export const DAY_TARGETS = config.DAY_TARGETS;
export const BUCKETS = config.BUCKETS;
export const DEFINITIONS = config.DEFINITIONS;
export const TRACKER_LAYOUT = config.TRACKER_LAYOUT;
export const TRACKING_CHART = config.TRACKING_CHART;
export const SETTINGS = config.SETTINGS;
export const evalStartDate = config.evalStartDate;
export const MA_ROSTER = config.MA_ROSTER;
export const noteTypeForIncoming = config.noteTypeForIncoming;
export const maForEmail = config.maForEmail;
