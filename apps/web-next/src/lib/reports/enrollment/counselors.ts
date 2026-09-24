/** Current undergraduate admissions counselors (Slate AC usernames). */
export const UG_COUNSELOR_SHORT: Record<string, string> = {
  "abel.cordero": "Abel C",
  "caroline.g.savoie": "Caroline S",
  "christine.m.gulas": "Christine G",
  "lillian.doyle": "Lillian D",
  "madelyn.r.byers": "Madelyn B",
  "michael.j.mcgrath": "Michael M",
  "joseph.r.pinho": "Joseph P",
  "katherine.n.lyons": "Katherine L",
};

export const UG_COUNSELOR_USERNAMES = Object.keys(UG_COUNSELOR_SHORT);

export type AcFunnel = {
  created: number;
  submitted: number;
  accepted: number;
  deposited: number;
  denied: number;
  interviewed: number;
  /** Catholic (incl. Eastern Rite) with a plausible HS GPA above 3.1. */
  viable: number;
};

export type AcTouchpoints = {
  /** Whitelisted calls/SMS/video/notes from the Slate interactions feed. */
  touchpoints: number;
  /** Touchpoints divided by distinct applicants touched. */
  touchpointsPerApp: number | null;
};

export const EMPTY_AC_TOUCHPOINTS: AcTouchpoints = { touchpoints: 0, touchpointsPerApp: null };

/** 1:1 SMS for one counselor over the messages feed's rolling window. */
export type AcTexting = {
  sent: number;
  studentsTexted: number;
  viableTexted: number;
  received: number;
  replies: number;
  sameDayPct: number | null;
  within1DayPct: number | null;
  medianReplyDays: number | null;
  awaiting: number;
};

export const EMPTY_AC_TEXTING: AcTexting = {
  sent: 0,
  studentsTexted: 0,
  viableTexted: 0,
  received: 0,
  replies: 0,
  sameDayPct: null,
  within1DayPct: null,
  medianReplyDays: null,
  awaiting: 0,
};

export function emptyAcFunnel(): AcFunnel {
  return {
    created: 0,
    submitted: 0,
    accepted: 0,
    deposited: 0,
    denied: 0,
    interviewed: 0,
    viable: 0,
  };
}

/** Current UG ACs plus Unassigned (empty string). Leftover/grad assignees are excluded. */
export function isActivityCounselorKey(ac: string): boolean {
  if (!ac) return true;
  return Object.prototype.hasOwnProperty.call(UG_COUNSELOR_SHORT, ac);
}

export function acShort(ac: string): string {
  if (!ac) return "Unassigned";
  return (
    UG_COUNSELOR_SHORT[ac] ||
    ac
      .split(".")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
  );
}

/**
 * Activity-page view of byAC: always include the current UG roster (zero-filled),
 * keep Unassigned when it has volume, drop former/grad assignees.
 */
export function activityByAC(byAC: Record<string, AcFunnel>): Record<string, AcFunnel> {
  const out: Record<string, AcFunnel> = {};
  for (const ac of UG_COUNSELOR_USERNAMES) {
    out[ac] = byAC[ac] ? { ...byAC[ac] } : emptyAcFunnel();
  }
  const unassigned = byAC[""];
  if (unassigned && unassigned.created > 0) out[""] = { ...unassigned };
  return out;
}
