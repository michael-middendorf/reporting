"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { suffix: "", label: "Overview" },
  { suffix: "/fundraising", label: "Fundraising" },
  { suffix: "/enrollment", label: "Enrollment" },
  { suffix: "/academics", label: "Academics" },
  { suffix: "/alumni", label: "Alumni" },
  { suffix: "/budget", label: "Budget" },
] as const;

export function CoachingSportNav({ sportKey }: { sportKey: string }) {
  const pathname = usePathname() || "";
  const base = `/athletics/coaching/${sportKey}`;
  return (
    <nav className="ath-coach-subnav" aria-label="Team sections">
      {TABS.map((tab) => {
        const href = `${base}${tab.suffix}`;
        const active = tab.suffix === "" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
