export type AppealCampaign = {
  slug: "fall-2026" | "spring-2026";
  label: string;
  virtuousCampaign: string;
  start: string;
  end: string | null;
  cacheKey: string;
  legacyCacheKey?: string;
  audienceTags: { id: number; label: string; creative?: boolean }[];
  /** Gross dollar goal set by Advancement. */
  goalGross?: number;
};

/**
 * This is deliberately code-reviewed rather than administrator-editable. A
 * campaign's Virtuous tags and attribution rules are reporting controls.
 */
export const APPEAL_CAMPAIGNS: readonly AppealCampaign[] = [
  {
    slug: "fall-2026",
    label: "Fall 2026 Appeal",
    virtuousCampaign: "2026 Fall Appeal",
    start: "2026-08-16",
    end: "2027-02-28",
    cacheKey: "appeals/fall-2026/latest.json",
    legacyCacheKey: "fall-appeal/latest.json",
    audienceTags: [{ id: 93, label: "Direct Mail Audience" }],
    goalGross: 70000,
  },
  {
    slug: "spring-2026",
    label: "Spring 2026 Appeal",
    virtuousCampaign: "2026 Spring Appeal",
    start: "2026-03-24",
    end: null,
    cacheKey: "appeals/spring-2026/latest.json",
    audienceTags: [
      { id: 48, label: "Brick", creative: true },
      { id: 47, label: "Chapel", creative: true },
      { id: 49, label: "Vocations", creative: true },
    ],
  },
] as const;

export type AppealSlug = (typeof APPEAL_CAMPAIGNS)[number]["slug"];

export function appealCampaign(slug: string | null | undefined): AppealCampaign | null {
  return APPEAL_CAMPAIGNS.find((campaign) => campaign.slug === slug) ?? null;
}

export const DEFAULT_APPEAL_SLUG: AppealSlug = "fall-2026";
