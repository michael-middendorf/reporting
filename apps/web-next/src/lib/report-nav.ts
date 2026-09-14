import type { ReportId } from "@/lib/access";
import { sportByKey } from "@/lib/reports/athletics-coaching/sports";

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
  { href: "/advancement/fall-appeal", label: "Fall Appeal", report: "advancement" },
  { href: "/advancement/points", label: "MA Points", report: "points", exact: true },
  { href: "/advancement/points/methodology", label: "Points Methodology", report: "points" },
  { href: "/advancement/chapel-naming", label: "Chapel Naming", report: "chapel" },
  { href: "/advancement/stained-glass-windows", label: "Stained Glass", report: "chapel" },
  { href: "/athletics/giving", label: "Athletics Giving", report: "advancement" },
];

export const ENROLLMENT_NAV: ReportNavItem[] = [
  { href: "/enrollment", label: "Overview", exact: true },
  { href: "/enrollment/admissions", label: "Admissions" },
  { href: "/enrollment/events", label: "Events" },
  { href: "/enrollment/withdrawals", label: "Withdrawals" },
];

export const POINTS_NAV: ReportNavItem[] = [
  { href: "/advancement/points", label: "Dashboard", exact: true },
  { href: "/advancement/points/methodology", label: "Methodology" },
];

export const ATHLETICS_RECRUITING_NAV: ReportNavItem[] = [
  { href: "/athletics/master/recruiting", label: "Overview", exact: true, report: "athletics" },
  { href: "/athletics/master/recruiting/sectors", label: "Sector Boards", report: "athletics" },
  { href: "/athletics/master/recruiting/applications", label: "Applications", report: "athletics" },
  { href: "/athletics/master/recruiting/prospects", label: "Prospects / Inquiries", report: "athletics" },
];

export const ATHLETICS_NAV: ReportNavItem[] = [
  { href: "/athletics/master", label: "Master", report: "athletics" },
  { href: "/athletics/master/recruiting", label: "Recruiting", exact: true, report: "athletics" },
  { href: "/athletics/master/recruiting/sectors", label: "Sector Boards", report: "athletics" },
  { href: "/athletics/master/recruiting/applications", label: "Applications", report: "athletics" },
  { href: "/athletics/master/recruiting/prospects", label: "Prospects / Inquiries", report: "athletics" },
  { href: "/athletics/giving", label: "Giving", report: "athletics-coaching" },
  { href: "/athletics/coaching", label: "Coaching", exact: true, report: "athletics-coaching" },
  { href: "/athletics/coaching/overview", label: "Overview", report: "athletics-coaching" },
];

export const ATHLETICS_COACHING_NAV: ReportNavItem[] = [
  { href: "/athletics/coaching/overview", label: "Overview", report: "athletics-coaching" },
];

export const ASPIREDU_NAV: ReportNavItem[] = [
  { href: "/aspiredu", label: "Overview", exact: true },
  { href: "/aspiredu/provisional/fall", label: "Fall Athletic Provisional" },
  { href: "/aspiredu/provisional/athletics", label: "Athletics Provisional" },
  { href: "/aspiredu/eot/spring", label: "Spring EOT Grade Report" },
  { href: "/aspiredu/students", label: "Student follow-up" },
];

export function navForReports(nav: ReportNavItem[], reports: ReportId[]): ReportNavItem[] {
  return nav.filter((item) => !item.report || reports.includes(item.report));
}

export type Crumb = { href: string; label: string };

export type ReportFolder = {
  href: string;
  label: string;
  /** Path prefixes that belong to this folder (including aliases). */
  match: string[];
  nav?: ReportNavItem[];
};

/** Departments / hubs. Nested dashboards resolve a leaf label from `nav`. */
export const REPORT_FOLDERS: ReportFolder[] = [
  {
    href: "/advancement",
    label: "Advancement",
    match: ["/advancement", "/annunciation"],
    nav: ADVANCEMENT_NAV,
  },
  {
    href: "/enrollment",
    label: "Enrollment",
    match: ["/enrollment"],
    nav: ENROLLMENT_NAV,
  },
  {
    href: "/athletics",
    label: "Athletics",
    match: ["/athletics"],
    nav: ATHLETICS_NAV,
  },
  {
    href: "/aspiredu",
    label: "Academic Affairs",
    match: ["/aspiredu"],
    nav: ASPIREDU_NAV,
  },
  { href: "/institute", label: "The Institute", match: ["/institute"] },
  { href: "/housing", label: "Housing", match: ["/housing"] },
  { href: "/census", label: "Census", match: ["/census"] },
];

const EXTRA_LEAVES: Crumb[] = [
  { href: "/aspiredu/mfa", label: "Authenticator" },
  { href: "/athletics/coaching/mfa", label: "Authenticator" },
  { href: "/auth/mfa", label: "Authenticator" },
  { href: "/settings/security", label: "Security" },
  { href: "/enrollment/activity", label: "Activity" },
];

function folderForPath(pathname: string): ReportFolder | undefined {
  return REPORT_FOLDERS.find((folder) =>
    folder.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}

/** True on a department card hub (e.g. /advancement), not on a report inside it. */
export function isDepartmentHub(pathname: string): boolean {
  const folder = folderForPath(pathname);
  if (!folder || pathname !== folder.href) return false;
  return !(folder.nav ?? []).some((item) => item.href === folder.href);
}

function titleCaseSegment(seg: string): string {
  return seg
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Clickable trail: Reports / Advancement / MA Points */
export function reportCrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ href: "/", label: "Reports" }];
  if (!pathname || pathname === "/") return crumbs;

  const folder = folderForPath(pathname);
  if (!folder) {
    const extra = EXTRA_LEAVES.find((leaf) => leaf.href === pathname);
    const leaf = pathname.split("/").filter(Boolean).pop() || "Page";
    crumbs.push(extra ?? { href: pathname, label: titleCaseSegment(leaf) });
    return crumbs;
  }

  crumbs.push({ href: folder.href, label: folder.label });
  if (pathname === folder.href) return crumbs;

  const chain = (folder.nav ?? [])
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => a.href.length - b.href.length);

  for (const item of chain) {
    if (item.href === folder.href) continue;
    if (crumbs.some((crumb) => crumb.href === item.href)) continue;
    crumbs.push({ href: item.href, label: item.label });
  }

  if (crumbs[crumbs.length - 1]?.href !== pathname) {
    const extra = EXTRA_LEAVES.find((leaf) => leaf.href === pathname);
    const coachingKey = pathname.startsWith("/athletics/coaching/")
      ? pathname.slice("/athletics/coaching/".length)
      : "";
    const sport = coachingKey && !coachingKey.includes("/") ? sportByKey[coachingKey] : undefined;
    const leaf = pathname.split("/").filter(Boolean).pop() || "Page";
    crumbs.push(
      extra ??
        (sport
          ? { href: pathname, label: sport.label }
          : { href: pathname, label: titleCaseSegment(leaf) }),
    );
  }
  return crumbs;
}

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
