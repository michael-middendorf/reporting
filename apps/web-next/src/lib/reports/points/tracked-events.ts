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
