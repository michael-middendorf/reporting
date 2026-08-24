import type { ReportId } from "@/lib/access";

export type ReportNavItem = {
  href: string;
  label: string;
  /** When true, only the exact pathname is active (not nested routes). */
  exact?: boolean;
  /** Hide this tab unless the user has this report id. */
  report?: ReportId;
};

export const ADVANCEMENT_NAV: ReportNavItem[] = [
  { href: "/advancement/overview", label: "Overview", report: "advancement" },
  { href: "/advancement/mgo-top-prospects", label: "MGO Top Prospects", report: "advancement" },
  { href: "/annunciation", label: "Annunciation Circle", report: "annunciation" },
  { href: "/advancement/chapel-naming", label: "Chapel Naming", report: "chapel" },
  { href: "/advancement/stained-glass-windows", label: "Stained Glass", report: "chapel" },
];

export const ENROLLMENT_NAV: ReportNavItem[] = [
  { href: "/enrollment", label: "Overview", exact: true },
  { href: "/enrollment/admissions", label: "Admissions" },
  { href: "/enrollment/events", label: "Events" },
  { href: "/enrollment/withdrawals", label: "Withdrawals" },
];

export const POINTS_NAV: ReportNavItem[] = [
  { href: "/points", label: "Dashboard", exact: true },
  { href: "/points/methodology", label: "Methodology" },
];

export const ASPIREDU_NAV: ReportNavItem[] = [
  { href: "/aspiredu", label: "Overview", exact: true },
  { href: "/aspiredu/provisional/summer-1", label: "Summer 1 Athletic Provisional" },
  { href: "/aspiredu/provisional/athletics", label: "Athletics Provisional" },
  { href: "/aspiredu/students", label: "Student follow-up" },
];

export function reportNavActive(
  item: ReportNavItem,
  nav: ReportNavItem[],
  pathname: string,
): boolean {
  if (item.exact) return pathname === item.href;
  const hasChild = nav.some(
    (other) => other.href !== item.href && other.href.startsWith(`${item.href}/`),
  );
  if (hasChild) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
