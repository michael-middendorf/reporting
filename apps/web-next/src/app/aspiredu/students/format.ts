/** Display helpers shared by the student list and profile pages. */

/** Placeholder for a value no feed supplied. */
export const EMPTY = "n/a";

export function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleDateString();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed)
    ? value
    : new Date(parsed).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `${Number(value.toFixed(digits))}%`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return value.toFixed(digits);
}
