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
  /** ISO date (YYYY-MM-DD) the member was first detected in the circle, or null for baseline members. */
  firstSeen: string | null;
};

export type AnnunciationSnapshot = {
  generated_at: string;
  tag: string;
  total: number;
  baseline: boolean;
  members: AnnunciationMember[];
};

/** Members whose firstSeen falls within the last `days` days. */
export function recentlyJoined(
  members: AnnunciationMember[],
  days: number,
  now: Date = new Date(),
): AnnunciationMember[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return members
    .filter((m) => {
      if (!m.firstSeen) return false;
      const d = new Date(`${m.firstSeen}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d >= cutoff;
    })
    .sort((a, b) => (b.firstSeen || "").localeCompare(a.firstSeen || ""));
}
