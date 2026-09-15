/** Snapshot from the portfolios publisher (portfolios/latest.json). */

export type PortfolioTeam = "mgo" | "ma";

export type TagRef = {
  id?: number | null;
  name?: string | null;
  tagId?: number | null;
  tagName?: string | null;
  tag?: string | null;
  tagGroupName?: string | null;
  tagGroup?: string | null;
};

export type StageDef = {
  key: string;
  label: string;
  ids: readonly number[];
  names: readonly string[];
};

export const MGO_STAGES: readonly StageDef[] = [
  { key: "identification", label: "Identification", ids: [74], names: ["identification"] },
  { key: "cultivation", label: "Cultivation", ids: [75], names: ["cultivation"] },
  { key: "solicitation", label: "Solicitation", ids: [76], names: ["solicitation"] },
  { key: "stewardship", label: "Stewardship", ids: [77], names: ["stewardship"] },
];

export const MA_STAGES: readonly StageDef[] = [
  { key: "engagement", label: "Engagement", ids: [82], names: ["engagement", "engage"] },
  { key: "reactivate", label: "Reactivate", ids: [83], names: ["reactivate"] },
  { key: "renewal", label: "Renewal", ids: [84], names: ["renewal"] },
  { key: "stewardship", label: "Stewardship", ids: [85], names: ["stewardship"] },
];

export const UNTAGGED_STAGE: StageDef = {
  key: "untagged",
  label: "Untagged",
  ids: [],
  names: [],
};

export const MGO_RELATIONSHIPS = [
  "Current",
  "Lapsed",
  "Prospect",
  "Estate Prospect",
  "Estate Donor",
  "Foundation Relationship",
  "Personal Relationship",
] as const;

export const MA_RELATIONSHIPS = ["Current", "First Time", "Lapsed", "Prospect"] as const;

/** Leftover tag. Not a pipeline stage. */
export const IGNORED_TAG_IDS = new Set([46]);
export const IGNORED_TAG_NAMES = new Set(["ma engaged"]);

export type PortfolioDonor = {
  contactId: number | null;
  donorName: string | null;
  contactUrl: string | null;
  stage: string;
  relationship: string[];
  lastGiftDate: string | null;
  lastActivityDate: string | null;
  lastActivityBy: string | null;
};

export type PortfolioStage = {
  key: string;
  label: string;
  donorCount: number;
  donors: PortfolioDonor[];
};

export type PortfolioSolicitor = {
  id: string;
  name: string;
  email: string;
  team: PortfolioTeam;
  groupName: string | null;
  groupId: number | null;
  donorCount: number;
  stages: PortfolioStage[];
};

export type PortfolioViewer = {
  email: string;
  canSelectMgo: boolean;
  canSelectMa: boolean;
  defaultSolicitorId: string | null;
};

export type PortfoliosSnapshot = {
  generated_at: string;
  source: string;
  definition: string;
  solicitors: PortfolioSolicitor[];
  viewer?: PortfolioViewer;
  cache?: string;
  error?: string;
};

export function stagesForTeam(team: PortfolioTeam): readonly StageDef[] {
  return team === "ma" ? MA_STAGES : MGO_STAGES;
}

export function relationshipsForTeam(team: PortfolioTeam): readonly string[] {
  return team === "ma" ? MA_RELATIONSHIPS : MGO_RELATIONSHIPS;
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function leafTagName(tag: TagRef | string): string {
  const folded = fold(tagName(tag));
  for (const prefix of ["mgo:", "ma:"] as const) {
    if (folded.startsWith(prefix)) return folded.slice(prefix.length).trim();
  }
  return folded;
}

function tagId(tag: TagRef | string): number | null {
  if (typeof tag === "string") return null;
  const raw = tag.tagId ?? tag.id;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function tagName(tag: TagRef | string): string {
  if (typeof tag === "string") return tag;
  return String(tag.tagName || tag.name || tag.tag || "").trim();
}

function isIgnored(tag: TagRef | string): boolean {
  const id = tagId(tag);
  if (id != null && IGNORED_TAG_IDS.has(id)) return true;
  return IGNORED_TAG_NAMES.has(fold(tagName(tag)));
}

function inPipelineGroup(tag: TagRef | string): boolean {
  if (typeof tag === "string") return true;
  const group = fold(String(tag.tagGroupName || tag.tagGroup || ""));
  return !group || group === "prospect pipeline";
}

export function classifyStage(
  team: PortfolioTeam,
  tags: Array<TagRef | string>,
): StageDef {
  const defs = stagesForTeam(team);
  const live = tags.filter((t) => !isIgnored(t) && inPipelineGroup(t));
  for (const def of defs) {
    for (const tag of live) {
      const id = tagId(tag);
      if (id != null && def.ids.includes(id)) return def;
    }
  }
  for (const def of defs) {
    for (const tag of live) {
      if (def.names.includes(leafTagName(tag))) return def;
    }
  }
  return UNTAGGED_STAGE;
}

export function classifyRelationships(
  team: PortfolioTeam,
  tags: Array<TagRef | string>,
): string[] {
  const allowed = relationshipsForTeam(team);
  const found = new Set<string>();
  for (const tag of tags) {
    if (isIgnored(tag) || !inPipelineGroup(tag)) continue;
    const name = leafTagName(tag);
    for (const label of allowed) {
      if (fold(label) === name) found.add(label);
    }
  }
  return allowed.filter((label) => found.has(label));
}

/** Missing last-activity first (most stale), then oldest date, then name. */
export function sortDonors<T extends { lastActivityDate?: string | null; donorName?: string | null }>(
  donors: T[],
): T[] {
  return [...donors].sort((a, b) => {
    const aDate = a.lastActivityDate || "";
    const bDate = b.lastActivityDate || "";
    if (!aDate && bDate) return -1;
    if (aDate && !bDate) return 1;
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return (a.donorName || "").localeCompare(b.donorName || "", "en", { sensitivity: "base" });
  });
}

export function formatMdDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const day = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export function relationshipLabel(values: string[] | null | undefined): string {
  if (!values || values.length === 0) return "-";
  return values.join(", ");
}
