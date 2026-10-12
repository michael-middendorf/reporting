/**
 * Thank-you letter donor cards (DST-3062).
 *
 * Snapshot published by services/publishers/ty-letters to
 * DATA_BUCKET/ty-letters/latest.json. One card per Virtuous gift of at least
 * `minAmount` dated windowStart..windowEnd. Rows and totalGiving are point in
 * time as of the thanked gift (history dated on or before it), with hard and
 * soft credit, and without $0, reversed, or reversing gifts.
 */

export type TyLetterRow = {
  giftId: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string | null;
  /** Raw Virtuous giftType (Check, Cash, Credit, Stock, EFT, QCD, NonCash...). */
  type: string | null;
  /** Designation project names, largest first, joined with "; ". */
  fund: string | null;
  /** Segment with any trailing -HIST_xx suffix removed. */
  appeal: string | null;
  /** Gift contactName (the hard credit donor). */
  hardCredit: string | null;
};

export type TyLetterRows = {
  latest: TyLetterRow | null;
  secondLatest: TyLetterRow | null;
  largest: TyLetterRow | null;
  first: TyLetterRow | null;
};

export type TyLetterCard = {
  giftId: string;
  giftDate: string | null;
  amount: number;
  donorContactId: string;
  donorName: string;
  solicitor: string;
  salutation: string;
  addressee: string;
  addressLines: string[];
  cellPhone: string;
  homePhone: string;
  anonymous: boolean;
  rows: TyLetterRows;
  totalGiving: number;
  batch: string | null;
  giftModified?: string | null;
  /** Gift ids counted on this card; the publisher rebuilds it if one is later reversed. */
  historyGiftIds?: number[];
  virtuousGiftUrl?: string | null;
  /** Merged in by /api/ty-letters-data from DynamoDB. */
  sent?: boolean;
  sentBy?: string | null;
  sentAt?: string | null;
};

export type TyLettersSnapshot = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  minAmount: number;
  partial: boolean;
  pending: number;
  cards: TyLetterCard[];
  error?: string;
};

export type SentFilter = "all" | "not-sent" | "sent";

export type TyLetterFilters = {
  from: string;
  to: string;
  minAmount: number;
  sent: SentFilter;
  q: string;
};

export const ROW_LABELS: { key: keyof TyLetterRows; label: string }[] = [
  { key: "latest", label: "Latest" },
  { key: "secondLatest", label: "2nd Latest" },
  { key: "largest", label: "Largest" },
  { key: "first", label: "1st" },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: string): boolean {
  return ISO_DAY.test(value);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clampDay(value: string, lo: string, hi: string): string {
  if (!isIsoDay(value)) return value;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** Default view: the last 7 days of the snapshot window, at the snapshot floor. */
export function defaultFilters(snap: Pick<TyLettersSnapshot, "windowStart" | "windowEnd" | "minAmount">): TyLetterFilters {
  const to = snap.windowEnd;
  const from = clampDay(addDays(to, -7), snap.windowStart, snap.windowEnd);
  return { from, to, minAmount: snap.minAmount, sent: "all", q: "" };
}

/** Keeps dates inside the snapshot window and the amount at or above its floor. */
export function boundFilters(
  f: TyLetterFilters,
  snap: Pick<TyLettersSnapshot, "windowStart" | "windowEnd" | "minAmount">,
): TyLetterFilters {
  const amount = Number.isFinite(f.minAmount) ? f.minAmount : snap.minAmount;
  return {
    ...f,
    from: clampDay(f.from, snap.windowStart, snap.windowEnd),
    to: clampDay(f.to, snap.windowStart, snap.windowEnd),
    minAmount: Math.max(snap.minAmount, amount),
  };
}

/** Cards matching the filters, gift date desc then amount desc. */
export function filterCards(cards: TyLetterCard[] | undefined, f: TyLetterFilters): TyLetterCard[] {
  const q = f.q.trim().toLowerCase();
  const out = (cards ?? []).filter((c) => {
    const day = c.giftDate ?? "";
    if (isIsoDay(f.from) && day < f.from) return false;
    if (isIsoDay(f.to) && day > f.to) return false;
    if (c.amount < f.minAmount) return false;
    if (f.sent === "sent" && !c.sent) return false;
    if (f.sent === "not-sent" && c.sent) return false;
    if (q && !(c.donorName || "").toLowerCase().includes(q)) return false;
    return true;
  });
  return out.sort(
    (a, b) =>
      (b.giftDate ?? "").localeCompare(a.giftDate ?? "") ||
      b.amount - a.amount ||
      b.giftId.localeCompare(a.giftId),
  );
}

export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function mdy(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/** Gift ids are Virtuous integer ids, sent as strings. */
export function isGiftId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,20}$/.test(value);
}
