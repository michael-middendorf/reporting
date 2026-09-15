import { isAdmin } from "@/lib/access";
import { normalizeEmail } from "@/lib/auth";
import type { PortfolioSolicitor, PortfoliosSnapshot, PortfolioViewer } from "./shape";

const LESLIE = "leslie.sonnen@avemaria.edu";
const ANNIE = "annie.esposito@avemaria.edu";
const JIM = "jim.thomas@avemaria.edu";

function withViewer(
  snapshot: PortfoliosSnapshot,
  solicitors: PortfolioSolicitor[],
  viewer: PortfolioViewer,
): PortfoliosSnapshot {
  return { ...snapshot, solicitors, viewer };
}

function defaultId(solicitors: PortfolioSolicitor[], email: string): string | null {
  const self = solicitors.find((s) => normalizeEmail(s.email) === email);
  if (self) return self.id;
  return solicitors[0]?.id ?? null;
}

/**
 * Row-level filter. Never return the unscoped snapshot from an API route.
 */
export function scopePortfoliosForEmail(
  email: string,
  snapshot: PortfoliosSnapshot,
): PortfoliosSnapshot {
  const e = normalizeEmail(email);
  const all = snapshot.solicitors ?? [];

  if (isAdmin(e) || e === LESLIE) {
    return withViewer(all.length ? snapshot : { ...snapshot, solicitors: [] }, all, {
      email: e,
      canSelectMgo: all.some((s) => s.team === "mgo"),
      canSelectMa: all.some((s) => s.team === "ma"),
      defaultSolicitorId: defaultId(all, e),
    });
  }

  if (e === ANNIE) {
    const solicitors = all.filter((s) => s.team === "ma");
    return withViewer(snapshot, solicitors, {
      email: e,
      canSelectMgo: false,
      canSelectMa: solicitors.length > 0,
      defaultSolicitorId: defaultId(solicitors, e),
    });
  }

  if (e === JIM) {
    const solicitors = all.filter((s) => s.team === "mgo");
    return withViewer(snapshot, solicitors, {
      email: e,
      canSelectMgo: solicitors.length > 0,
      canSelectMa: false,
      defaultSolicitorId: defaultId(solicitors, e),
    });
  }

  const mine = all.filter((s) => normalizeEmail(s.email) === e);
  return withViewer(snapshot, mine, {
    email: e,
    canSelectMgo: false,
    canSelectMa: false,
    defaultSolicitorId: mine[0]?.id ?? null,
  });
}
