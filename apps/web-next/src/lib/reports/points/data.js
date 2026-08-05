/**
 * data.js — fetches RAW Virtuous JSON only. No processing here.
 * In production these files are served from the CloudFront-fronted cache
 * bucket (raw notes/gifts/events written by the backend refresh job).
 */
import { DATA_BASE, RAW_FILES } from "./config.js";

async function getJSON(name, fallback) {
  try {
    const res = await fetch(`${DATA_BASE}/${name}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return await res.json();
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

/** Load all raw inputs the scoring engine needs. */
export async function loadRaw() {
  const [notes, events, meta] = await Promise.all([
    getJSON(RAW_FILES.notes, []),
    getJSON(RAW_FILES.events, []),
    getJSON(RAW_FILES.meta, {}),
  ]);
  // Support either a bare array or a {records:[...]} envelope.
  const arr = (x) => (Array.isArray(x) ? x : x.records || x.list || []);
  return { notes: arr(notes), events: arr(events), meta };
}
