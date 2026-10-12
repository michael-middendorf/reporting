const ROOM_KEYS = ["view", "hall", "floor", "room", "asof", "mode"] as const;

/**
 * Old /housing deep links. The Stats sheet is Capacity Quest. Room, move-in,
 * and verification links stay on Residence Life with the same query.
 */
export function legacyHousingDest(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  if (!ROOM_KEYS.some((key) => params.has(key))) return null;
  if (params.get("view") === "overview") return "/housing/capacity-quest";
  const qs = params.toString();
  return `/housing/residence-life${qs ? `?${qs}` : ""}`;
}
