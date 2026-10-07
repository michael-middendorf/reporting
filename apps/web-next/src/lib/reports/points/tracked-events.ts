/**
 * tracked-events.ts — shared types for reporting-only MA event hours.
 *
 * Events added on the Points dashboard are stored here, scored at
 * 25 points per hour, and never written to Virtuous. Client-safe:
 * pure types + constants, no aws-sdk imports. S3 read/write lives
 * in `tracked-events-store.ts`.
 */

export const TRACKED_EVENTS_KEY = "points/tracked-events.json";

export type TrackedEvent = {
  id: string;
  owner: string;
  day: string; // YYYY-MM-DD
  eventType: string; // TRACKED_EVENT_TYPES id, or a Virtuous type string
  name: string;
  /** Free text for a Projects event. Empty for every other event type. */
  projectType?: string;
  hours: number;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type TrackedEventsDoc = {
  version: 1;
  events: Record<string, TrackedEvent>;
};

export function emptyTrackedEventsDoc(): TrackedEventsDoc {
  return { version: 1, events: {} };
}

export type TrackedEventInput = {
  id?: string;
  owner: string;
  day: string;
  eventType: string;
  name?: string | null;
  projectType?: string | null;
  hours: number;
};

/** Project type is stored only on Projects events. Other types keep it blank. */
export function projectTypeFor(eventType: string, value: unknown): string {
  if (eventType !== "projects" && eventType !== "Projects") return "";
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export type EventTypeTotal = {
  id: string;
  label: string;
  count: number;
  hours: number;
  points: number;
};

/** Hours and points by dashboard event type. */
export function summarizeTrackedEventTypes(
  events: Array<{ eventType?: string; hours?: number }>,
  types: Array<{ id: string; label: string; type?: string }>,
  pointsPerHour: number,
): EventTypeTotal[] {
  const labelOf = (id: string) =>
    types.find((t) => t.id === id || t.type === id)?.label || id;
  const map = new Map<string, EventTypeTotal>();
  for (const event of events || []) {
    const id = String(event.eventType || "event");
    const rec = map.get(id) || { id, label: labelOf(id), count: 0, hours: 0, points: 0 };
    const hours = Number(event.hours) || 0;
    rec.count += 1;
    rec.hours += hours;
    rec.points += hours * pointsPerHour;
    map.set(id, rec);
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label));
}

export type EventMaTotal = {
  name: string;
  count: number;
  hours: number;
  points: number;
};

/** Event count, hours, and points for each roster MA, in table order. */
export function summarizeTrackedEventsByMa(
  events: Array<{ owner?: string; hours?: number }>,
  roster: Array<{ name: string; tableOrder?: number }>,
  pointsPerHour: number,
): EventMaTotal[] {
  const order = new Map(roster.map((m, i) => [m.name, m.tableOrder ?? i]));
  const map = new Map<string, EventMaTotal>();
  for (const member of roster) {
    map.set(member.name, { name: member.name, count: 0, hours: 0, points: 0 });
  }
  for (const event of events || []) {
    const name = String(event.owner || "").trim();
    if (!name) continue;
    const rec = map.get(name) || { name, count: 0, hours: 0, points: 0 };
    const hours = Number(event.hours) || 0;
    rec.count += 1;
    rec.hours += hours;
    rec.points += hours * pointsPerHour;
    map.set(name, rec);
  }
  return [...map.values()].sort((a, b) => {
    const ao = order.has(a.name) ? (order.get(a.name) as number) : 99;
    const bo = order.has(b.name) ? (order.get(b.name) as number) : 99;
    return ao - bo || a.name.localeCompare(b.name);
  });
}

/** Roster table order, then newest date. */
export function sortTrackedEventsByMa<T extends { owner?: string; day?: string; name?: string }>(
  events: T[],
  roster: Array<{ name: string; tableOrder?: number }>,
): T[] {
  const order = new Map(roster.map((m, i) => [m.name, m.tableOrder ?? i]));
  return [...(events || [])].sort((a, b) => {
    const ao = order.has(a.owner || "") ? (order.get(a.owner || "") as number) : 99;
    const bo = order.has(b.owner || "") ? (order.get(b.owner || "") as number) : 99;
    return (
      ao - bo ||
      String(b.day || "").localeCompare(String(a.day || "")) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  });
}
