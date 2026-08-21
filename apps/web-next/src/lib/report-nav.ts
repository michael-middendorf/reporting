export type ReportNavItem = {
  href: string;
  label: string;
  /** When true, only the exact pathname is active (not nested routes). */
  exact?: boolean;
};

export const ADVANCEMENT_NAV: ReportNavItem[] = [
  { href: "/advancement/overview", label: "Overview" },
  { href: "/advancement/mgo-top-prospects", label: "MGO Top Prospects" },
  { href: "/annunciation", label: "Annunciation Circle" },
  { href: "/advancement/chapel-naming", label: "Chapel Naming" },
  { href: "/advancement/stained-glass-windows", label: "Stained Glass" },
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
  { href: "/aspiredu", label: "Summary", exact: true },
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
