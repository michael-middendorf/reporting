/**
 * Director view of counted gifts: age, university relationship, and which
 * contact type those dollars followed. This does not assign gifts.
 */
import { DONOR_TAGS, GENERATIONS, RELATIONSHIPS, generationForYear } from "./profiles.js";

/** Labels match the reached-by column on the Points tab. */
export const CHANNELS = [
  { id: "conversation", label: "Phone conversation", short: "Phone" },
  { id: "dial", label: "Voicemail / dial", short: "Voicemail" },
  { id: "email", label: "Email conversation", short: "Email reply" },
  { id: "reach", label: "Email reach-out", short: "Email sent" },
  { id: "text", label: "Text message", short: "Text" },
  { id: "letter", label: "Handwritten note / letter", short: "Letter" },
  { id: "face", label: "Face-to-face (coffee/lunch)", short: "In person" },
  { id: "meeting", label: "MAS Meeting (face-to-face)", short: "Meeting" },
  { id: "general", label: "General note", short: "General" },
  { id: "verbal", label: "Verbal commitment", short: "Verbal" },
  { id: "none", label: "No contact logged", short: "No contact" },
];

const OUTREACH_BUCKETS = new Set([
  "conversation",
  "dial",
  "email",
  "note",
  "facetoface",
  "general",
  "commitment",
]);
const SKIP_LABELS = new Set(["Email bounced"]);

/**
 * @typedef {{ gifts: number, amount: number, rate: number | null }} InsightCell
 */

const UNKNOWN_GENERATION = { id: "unknown", label: "Age unknown", born: "no birth year" };
const UNTAGGED_RELATIONSHIP = { id: "untagged", label: "Not tagged", born: "" };
const UNTAGGED_DONOR = { id: "untagged", label: "Not tagged", born: "" };

function money(n) {
  return `$${Math.round(n || 0).toLocaleString("en-US")}`;
}

function channelFor(label) {
  const text = label || "No contact logged";
  return CHANNELS.find((channel) => channel.label === text) || { id: `other:${text}`, label: text, short: text };
}

function donorKey(row) {
  if (row.contactId != null && row.contactId !== "") return `c:${row.contactId}`;
  if (row.giftId != null && row.giftId !== "") return `g:${row.giftId}`;
  return `row:${row.day || ""}:${row.amount || 0}`;
}

function createBucket(id, label, detail) {
  return { id, label, detail: detail || "", donorKeys: new Set(), gifts: 0, amount: 0, channels: new Map() };
}

function cell(bucket, channelId) {
  let found = bucket.channels.get(channelId);
  if (!found) {
    found = { gifts: 0, amount: 0, giftDonors: new Set(), reached: new Set() };
    bucket.channels.set(channelId, found);
  }
  return found;
}

function addGift(bucket, channel, gift, key) {
  bucket.donorKeys.add(key);
  bucket.gifts += 1;
  bucket.amount += Number(gift.amount) || 0;
  const found = cell(bucket, channel.id);
  found.gifts += 1;
  found.amount += Number(gift.amount) || 0;
  found.giftDonors.add(key);
}

function pickBest(cells, amount) {
  const ranked = Object.entries(cells)
    .filter(([, value]) => value.gifts > 0)
    .map(([id, value]) => ({ id, ...value }));
  const preferred = ranked.filter((value) => value.id !== "none");
  const pool = preferred.length ? preferred : ranked;
  pool.sort((a, b) => b.amount - a.amount || b.gifts - a.gifts || a.id.localeCompare(b.id));
  const best = pool[0];
  if (!best) return null;
  const known = CHANNELS.find((channel) => channel.id === best.id);
  return {
    id: best.id,
    label: known?.label || best.id.replace(/^other:/, ""),
    amount: best.amount,
    gifts: best.gifts,
    share: amount > 0 ? best.amount / amount : 0,
    rate: best.rate,
  };
}

function view(bucket) {
  /** @type {Record<string, InsightCell>} */
  const cells = {};
  for (const [id, found] of bucket.channels) {
    let gave = 0;
    for (const key of found.giftDonors) {
      if (found.reached.has(key)) gave += 1;
    }
    cells[id] = {
      gifts: found.gifts,
      amount: found.amount,
      rate: found.reached.size ? gave / found.reached.size : null,
    };
  }
  return {
    id: bucket.id,
    label: bucket.label,
    detail: bucket.detail,
    donors: bucket.donorKeys.size,
    gifts: bucket.gifts,
    amount: bucket.amount,
    avg: bucket.gifts ? bucket.amount / bucket.gifts : 0,
    best: pickBest(cells, bucket.amount),
    cells,
  };
}

function channelsUsed(groups) {
  const ids = new Set();
  const extras = new Map();
  for (const group of groups) {
    for (const [id, found] of Object.entries(group.cells)) {
      if (!found.gifts) continue;
      ids.add(id);
      if (!CHANNELS.some((channel) => channel.id === id)) extras.set(id, id.replace(/^other:/, ""));
    }
  }
  return [
    ...CHANNELS.filter((channel) => ids.has(channel.id)),
    ...[...extras.entries()].map(([id, label]) => ({ id, label, short: label })),
  ];
}

function leaders(groups) {
  const ranked = groups.filter((group) => group.amount > 0);
  if (!ranked.length) return [];
  const top = Math.max(...ranked.map((group) => group.amount));
  return ranked.filter((group) => group.amount === top);
}

function findingsFor(summary) {
  if (!summary.donors) return ["No counted gifts in this range."];
  const lines = [];
  const known = summary.generations.filter((group) => group.id !== "unknown");
  const topAges = leaders(known);
  if (!topAges.length) {
    lines.push("No birth year is on file for these donors, so there is no age breakdown yet.");
  } else if (topAges.length === 1) {
    const group = topAges[0];
    lines.push(
      `${group.label} gave ${money(group.amount)} across ${group.donors} ${group.donors === 1 ? "donor" : "donors"}, the most of any generation with a birth year.`,
    );
    if (group.best && group.best.id !== "none") {
      lines.push(`${group.best.label} brought in the most ${group.label} dollars (${money(group.best.amount)}).`);
    } else if (group.best) {
      lines.push(`${group.label} gifts have no outreach note on or before the gift.`);
    }
  } else {
    lines.push(
      `${topAges.map((group) => group.label).join(" and ")} each gave ${money(topAges[0].amount)}, the most of any generation with a birth year.`,
    );
  }
  const topTies = leaders(summary.relationships);
  if (topTies.length === 1) {
    const group = topTies[0];
    if (group.id === "untagged") {
      lines.push(`Donors with no university relationship on file account for ${money(group.amount)}.`);
    } else {
      lines.push(`${group.label} account for ${money(group.amount)} of the raised dollars in this range.`);
    }
  }
  lines.push(
    `Birth year is on file for ${summary.knownAge} of ${summary.donors} donors.${
      summary.deceased ? ` ${summary.deceased} ${summary.deceased === 1 ? "is" : "are"} marked deceased.` : ""
    }`,
  );
  return lines;
}

/**
 * @param {{ gifts?: any[], notes?: any[], profiles?: any[] }} [input]
 */
export function buildInsights(input = {}) {
  const gifts = input.gifts || [];
  const notes = input.notes || [];
  const profiles = input.profiles || [];
  const byKey = new Map();
  for (const profile of profiles || []) {
    if (profile?.id == null) continue;
    byKey.set(`c:${profile.id}`, profile);
  }
  const profileOf = (row) => byKey.get(donorKey(row)) || null;

  const generations = new Map(
    [...GENERATIONS, UNKNOWN_GENERATION].map((group) => [
      group.id,
      createBucket(group.id, group.label, group.born),
    ]),
  );
  const relationships = new Map(
    [...RELATIONSHIPS, UNTAGGED_RELATIONSHIP].map((group) => [
      group.id,
      createBucket(group.id, group.label, group.born || ""),
    ]),
  );
  const donorTags = new Map(
    [...DONOR_TAGS, UNTAGGED_DONOR].map((group) => [group.id, createBucket(group.id, group.label, "")]),
  );

  const seenDonors = new Set();
  let knownAge = 0;
  let knownRelationship = 0;
  let deceased = 0;

  for (const gift of gifts || []) {
    if ((Number(gift.amount) || 0) <= 0) continue;
    const key = donorKey(gift);
    const profile = profileOf(gift);
    const generation = generationForYear(profile?.birthYear)?.id || "unknown";
    const channel = channelFor(gift.touchLabel);
    addGift(generations.get(generation), channel, gift, key);
    const rels = profile?.relationships?.length ? profile.relationships : ["untagged"];
    for (const rel of rels) addGift(relationships.get(rel), channel, gift, key);
    const tags = profile?.donorTags?.length ? profile.donorTags : ["untagged"];
    for (const tag of tags) {
      const bucket = donorTags.get(tag);
      if (bucket) addGift(bucket, channel, gift, key);
    }
    if (seenDonors.has(key)) continue;
    seenDonors.add(key);
    if (profile?.birthYear) knownAge += 1;
    if (profile?.relationships?.length) knownRelationship += 1;
    if (profile?.deceased) deceased += 1;
  }

  for (const note of notes || []) {
    if (!note || note.unmatched || note.assist) continue;
    if (!OUTREACH_BUCKETS.has(note.bucket)) continue;
    if (SKIP_LABELS.has(note.label)) continue;
    if (note.contactId == null || note.contactId === "") continue;
    const channel = channelFor(note.label);
    if (channel.id === "none") continue;
    const key = donorKey(note);
    const profile = profileOf(note);
    const generation = generations.get(generationForYear(profile?.birthYear)?.id || "unknown");
    cell(generation, channel.id).reached.add(key);
    const rels = profile?.relationships?.length ? profile.relationships : ["untagged"];
    for (const rel of rels) cell(relationships.get(rel), channel.id).reached.add(key);
    const tags = profile?.donorTags?.length ? profile.donorTags : ["untagged"];
    for (const tag of tags) {
      const bucket = donorTags.get(tag);
      if (bucket) cell(bucket, channel.id).reached.add(key);
    }
  }

  const generationViews = [...generations.values()].map(view).filter((group) => group.donors > 0);
  const relationshipViews = [...relationships.values()].map(view).filter((group) => group.donors > 0);
  const donorTagViews = [...donorTags.values()].map(view).filter((group) => group.donors > 0);
  const summary = {
    donors: seenDonors.size,
    gifts: (gifts || []).filter((gift) => (Number(gift.amount) || 0) > 0).length,
    amount: (gifts || []).reduce((sum, gift) => sum + ((Number(gift.amount) || 0) > 0 ? Number(gift.amount) || 0 : 0), 0),
    knownAge,
    knownRelationship,
    deceased,
    generations: generationViews,
    relationships: relationshipViews,
    donorTags: donorTagViews,
  };
  return {
    ...summary,
    findings: findingsFor(summary),
    generationChannels: channelsUsed(generationViews),
    relationshipChannels: channelsUsed(relationshipViews),
  };
}
