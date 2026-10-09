/** Official census workbooks published from the local Census folder download. */

export const ARCHIVE_PREFIX = "cache/census/archive";
export const ARCHIVE_MANIFEST_KEY = `${ARCHIVE_PREFIX}/manifest.json`;

const ARCHIVE_ID = /^[a-z0-9-]{1,160}$/;

export type ArchiveKind = "workbook" | "pdf" | "other";
export type ArchiveSeason = "fall" | "spring" | "other";

export type ArchiveFile = {
  id: string;
  folder: string;
  name: string;
  bytes: number;
  ext: string;
  kind: ArchiveKind;
  season: ArchiveSeason;
  year: number | null;
  contentType: string;
  sheets: string[];
  note?: string;
};

export type ArchiveManifest = {
  generated: string;
  source: string;
  files: ArchiveFile[];
};

export type ArchiveSheet = {
  name: string;
  rows: string[][];
  rowCount: number;
  colCount: number;
  truncated: boolean;
};

export type ArchiveGroup = {
  key: string;
  label: string;
  files: ArchiveFile[];
};

export function isArchiveId(id: string): boolean {
  return ARCHIVE_ID.test(id);
}

export function archiveFileKey(id: string): string {
  if (!isArchiveId(id)) throw new Error("Invalid archive id");
  return `${ARCHIVE_PREFIX}/files/${id}`;
}

export function archiveSheetKey(id: string, index: number): string {
  if (!isArchiveId(id) || !Number.isInteger(index) || index < 0 || index > 200) {
    throw new Error("Invalid archive sheet");
  }
  return `${ARCHIVE_PREFIX}/sheets/${id}/${index}.json`;
}

export function termKey(file: Pick<ArchiveFile, "season" | "year">): string {
  if ((file.season === "fall" || file.season === "spring") && file.year) {
    return `${file.season}-${file.year}`;
  }
  return "other";
}

export function termLabel(file: Pick<ArchiveFile, "season" | "year">): string {
  if (file.season === "fall" && file.year) return `Fall ${file.year}`;
  if (file.season === "spring" && file.year) return `Spring ${file.year}`;
  return "Other files";
}

function parseTermKey(key: string): { year: number; season: number } | null {
  const match = /^(fall|spring)-(\d{4})$/.exec(key);
  if (!match) return null;
  return { year: Number(match[2]), season: match[1] === "fall" ? 0 : 1 };
}

export function compareTermKeys(a: string, b: string): number {
  const left = parseTermKey(a);
  const right = parseTermKey(b);
  if (!left && !right) return a.localeCompare(b);
  if (!left) return 1;
  if (!right) return -1;
  if (left.year !== right.year) return right.year - left.year;
  return left.season - right.season;
}

/** Prefer the official workbook over copies, drafts, and side files. */
export function fileScore(file: Pick<ArchiveFile, "name" | "kind">): number {
  const name = file.name.toLowerCase();
  const side = /copy|eric|backup|mock|kathryn|ipeds|draft|residency/.test(name);
  let score = 0;
  if (file.kind === "workbook") score += 100;
  else if (file.kind === "pdf") score += 20;
  if (name.includes("final")) score += 40;
  if (name.includes("census") && !side) score += 50;
  if (side) score -= 80;
  score -= Math.min(file.name.length, 80) / 100;
  return score;
}

export function compareArchiveFiles(a: ArchiveFile, b: ArchiveFile): number {
  const delta = fileScore(b) - fileScore(a);
  if (delta !== 0) return delta;
  return a.name.localeCompare(b.name);
}

export function groupArchive(files: ArchiveFile[]): ArchiveGroup[] {
  const map = new Map<string, ArchiveFile[]>();
  for (const file of files) {
    const key = termKey(file);
    const list = map.get(key);
    if (list) list.push(file);
    else map.set(key, [file]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      label: termLabel(list[0]),
      files: [...list].sort(compareArchiveFiles),
    }))
    .sort((a, b) => compareTermKeys(a.key, b.key));
}

export function contentDisposition(filename: string, disposition: "attachment" | "inline"): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
