"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { aggregate, assignedNotesFromFlags, evalStartDate, scoreAll } from "@/lib/reports/points/scoring";

export function PointsSubnav({ count }: { count?: number }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [fetched, setFetched] = useState(0);
  useEffect(() => {
    if (count != null) return;
    let cancelled = false;
    Promise.all([
      apiFetch("/api/reports/points/flags").then((r) => (r.ok ? r.json() : { flags: {} })),
      apiFetch("/api/reports/points/notes.json").then((r) => (r.ok ? r.json() : [])),
      apiFetch("/api/reports/points/gifts.json").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([flagsDoc, notes, gifts]) => {
        const flags = (flagsDoc?.flags || {}) as Record<string, unknown>;
        const extra = assignedNotesFromFlags(flags) as unknown[];
        const noteList = Array.isArray(notes) ? notes : [];
        const giftList = Array.isArray(gifts) ? gifts : [];
        const scored = scoreAll({ notes: [...noteList, ...extra], gifts: giftList, flags }) as unknown[];
        const model = aggregate(scored, { start: evalStartDate(), end: null, flags }) as {
          possibleGifts?: unknown[];
          reviewGifts?: unknown[];
        };
        if (!cancelled) {
          setFetched((model.possibleGifts || []).length + (model.reviewGifts || []).length);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [count]);
  const n = count != null ? count : fetched;
  const incoming = pathname === "/advancement/points" && search.get("tab") === "incoming";
  const method = pathname.startsWith("/advancement/points/methodology");
  const dash = pathname === "/advancement/points" && !incoming;
  const badge = n > 0 ? (n > 99 ? "99+" : String(n)) : null;
  return (
    <nav className="points-subnav" aria-label="Points sections">
      <Link
        href="/advancement/points?tab=incoming"
        className={incoming ? "active" : undefined}
        aria-current={incoming ? "page" : undefined}
      >
        Incoming
        {badge ? (
          <span className="points-tab-badge" aria-label={`${n} gifts need a decision`}>
            {badge}
          </span>
        ) : null}
      </Link>
      <Link
        href="/advancement/points"
        className={dash ? "active" : undefined}
        aria-current={dash ? "page" : undefined}
      >
        Points
      </Link>
      <Link
        href="/advancement/points/methodology"
        className={method ? "active" : undefined}
        aria-current={method ? "page" : undefined}
      >
        Methodology
      </Link>
    </nav>
  );
}
