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
  /** Outbound SMS sent, from the Slate messages feed. */
  sms: number;
  /** Whitelisted calls/SMS/video/notes from the Slate interactions feed. */
  touchpoints: number;
  /** Touchpoints divided by distinct applicants touched. */
  touchpointsPerApp: number | null;
  /** Median days from an outbound SMS to that applicant's next SMS reply — a day-granularity proxy, not true response time. */
  smsReplyDays: number | null;
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
    sms: 0,
    touchpoints: 0,
    touchpointsPerApp: null,
    smsReplyDays: null,
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
