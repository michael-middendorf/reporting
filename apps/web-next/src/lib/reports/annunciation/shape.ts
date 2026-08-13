/** Shapes for the Annunciation Circle member snapshot (annunciation/latest.json). */

export type AnnunciationMember = {
  id: number;
  name: string | null;
  contactType: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  address: string | null;
  lifeToDateGiving: string | null;
  lifeToDateGivingNum: number | null;
  yearToDateGiving: string | null;
  yearToDateGivingNum: number | null;
  lastGiftAmount: string | null;
  lastGiftDate: string | null;
  giftAskAmount: string | null;
  createDateUtc: string | null;
  contactUrl: string;
  /** True "member since" date (YYYY-MM-DD): start of the earliest Annunciation
   * Circle recurring gift. Null if no matching recurring gift was found. */
  startDate: string | null;
  /** Current recurring gift for the AC project (active preferred, else latest). */
  recurringAmount: number | null;
  recurringFrequency: string | null;
  recurringStatus: string | null;
  /** ISO date (YYYY-MM-DD) the member was first detected in the circle, or null for baseline members. */
  firstSeen: string | null;
};

export type AnnunciationProjectTotals = {
  id?: number;
  name?: string;
  /** Life-to-date gifts received, counting only Annunciation Circle designations. */
  lifeToDateGiving?: number | null;
  lifeToDateGiftCount?: number | null;
  lifeToDateGiversCount?: number | null;
  calendarYearToDateGiving?: number | null;
};

export type AnnunciationSnapshot = {
  generated_at: string;
  tag: string;
  total: number;
  baseline: boolean;
  /** Authoritative AC giving totals from the project ledger (AC-only). */
  acProject?: AnnunciationProjectTotals;
  members: AnnunciationMember[];
};

/** The date a member joined the circle: their recurring-gift start date,
 * falling back to when we first saw them if no recurring gift is on file. */
export function memberSince(m: AnnunciationMember): string | null {
  return m.startDate || m.firstSeen || null;
}

/** Members who joined (by recurring-gift start date) within the last `days` days. */
export function recentlyJoined(
  members: AnnunciationMember[],
  days: number,
  now: Date = new Date(),
): AnnunciationMember[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return members
    .filter((m) => {
      const since = memberSince(m);
      if (!since) return false;
      const d = new Date(`${since}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d >= cutoff;
    })
    .sort((a, b) => (memberSince(b) || "").localeCompare(memberSince(a) || ""));
}

const FREQ_ABBR: Record<string, string> = {
  Monthly: "/mo",
  Annually: "/yr",
  Quarterly: "/qtr",
  Weekly: "/wk",
  Semiannually: "/6mo",
  Biennially: "/2yr",
  Bimonthly: "/2mo",
  Daily: "/day",
};

/** "$11.10/mo · Up to date" style label for a member's recurring gift. */
export function formatRecurring(m: AnnunciationMember): string {
  if (m.recurringAmount == null) return "—";
  const amt = `$${m.recurringAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const freq = m.recurringFrequency ? FREQ_ABBR[m.recurringFrequency] ?? ` ${m.recurringFrequency}` : "";
  const status = m.recurringStatus ? ` · ${humanStatus(m.recurringStatus)}` : "";
  return `${amt}${freq}${status}`;
}

function humanStatus(s: string): string {
  // Virtuous returns e.g. "UpToDate", "PastDue"; space the camelCase.
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}
