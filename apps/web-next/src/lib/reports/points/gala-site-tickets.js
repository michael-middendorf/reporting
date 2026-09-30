/**
 * Chancellor's Gala tickets paid on the giving site.
 * stripe-virtuous-sync is not posting these gifts, so the points board
 * reads a snapshot of succeeded Stripe checkouts. Comp tickets are omitted.
 * A unique checkout email can name the Virtuous contact for Incoming.
 * Unsynced Stripe dollars stay off Raised until Assign or a Virtuous post.
 */
import snapshot from "./gala-site-tickets.json";

export const GALA_SITE_TICKETS = snapshot;
export const GALA_SEGMENT_NAME = snapshot.segmentName || "26-27 Chancellor's Gala";

export function isGalaVirtuousGift(record) {
  const blob = `${record?.segment || ""} ${record?.project || ""}`;
  return /gala/i.test(blob);
}

export function galaSiteGiftId(paymentIntentId) {
  return `gala-stripe-${paymentIntentId}`;
}

function foldEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function addEmail(set, value) {
  const email = foldEmail(value);
  if (email.includes("@")) set.add(email);
}

function emailsOf(contact) {
  const out = new Set();
  if (!contact || typeof contact !== "object") return out;
  addEmail(out, contact.email);
  addEmail(out, contact.emailAddress);
  const methods = contact.contactMethods || contact.contactMethod || [];
  for (const method of Array.isArray(methods) ? methods : []) {
    addEmail(out, method?.value);
    addEmail(out, method?.emailAddress);
  }
  const people = contact.contactIndividuals || contact.individuals || [];
  for (const person of Array.isArray(people) ? people : []) {
    addEmail(out, person?.email);
    addEmail(out, person?.emailAddress);
    const personMethods = person?.contactMethods || [];
    for (const method of Array.isArray(personMethods) ? personMethods : []) {
      addEmail(out, method?.value);
      addEmail(out, method?.emailAddress);
    }
  }
  return out;
}

function contactNameOf(contact) {
  return String(
    contact?.contactName || contact?.name || contact?.formalName || "",
  ).replace(/\s+/g, " ").trim();
}

/** email → contact when that email sits on exactly one contact. */
export function uniqueEmailContactIndex(contacts = []) {
  const hits = new Map();
  for (const contact of contacts || []) {
    const cid = Number(contact.id ?? contact.contactId);
    if (!Number.isFinite(cid)) continue;
    for (const email of emailsOf(contact)) {
      const list = hits.get(email) || [];
      if (!list.some((row) => row.contactId === cid)) {
        list.push({
          contactId: cid,
          contactName: contactNameOf(contact),
        });
      }
      hits.set(email, list);
    }
  }
  const unique = new Map();
  for (const [email, list] of hits) {
    if (list.length === 1) unique.set(email, list[0]);
  }
  return unique;
}

function postedGalaKeys(gifts = []) {
  const ids = new Set();
  const contactDays = new Set();
  for (const gift of gifts || []) {
    if (gift?.id != null && gift.id !== "") ids.add(String(gift.id));
    if (!isGalaVirtuousGift(gift) && !gift?.galaSite) continue;
    const cid = Number(gift.contactId);
    const day = String(gift.giftDate || gift.day || "");
    const amount = Math.round((Number(gift.amount) || 0) * 100);
    if (Number.isFinite(cid) && day && amount) {
      contactDays.add(`${cid}|${day}|${amount}`);
    }
  }
  return { ids, contactDays };
}

function ticketAmount(ticket) {
  return Math.round((Number(ticket.amountCents) || 0)) / 100;
}

/**
 * Append synthetic gala-site gifts for succeeded Stripe tickets that are
 * not already a posted Virtuous gala gift. Unique email match only.
 */
export function mergeGalaSiteTickets(gifts = [], contacts = [], tickets = GALA_SITE_TICKETS.tickets) {
  const posted = postedGalaKeys(gifts);
  const unique = uniqueEmailContactIndex(contacts);
  const extra = [];
  for (const ticket of tickets || []) {
    if (!ticket?.paymentIntentId) continue;
    if (ticket.inVirtuous && ticket.giftId != null && posted.ids.has(String(ticket.giftId))) {
      continue;
    }
    if (ticket.inVirtuous) continue;
    const amount = ticketAmount(ticket);
    if (amount <= 0) continue;
    const day = String(ticket.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    let contactId = ticket.contactId != null ? Number(ticket.contactId) : null;
    let contactName = ticket.contactName || ticket.stripeName || "";
    let emailMatch = ticket.emailMatch || "unmatched";
    if (!Number.isFinite(contactId)) contactId = null;
    const email = foldEmail(ticket.email);
    if (!contactId && emailMatch !== "ambiguous" && email && unique.has(email)) {
      const hit = unique.get(email);
      contactId = hit.contactId;
      contactName = hit.contactName || contactName;
      emailMatch = "unique";
    }
    if (contactId && posted.contactDays.has(`${contactId}|${day}|${Math.round(amount * 100)}`)) {
      continue;
    }
    extra.push({
      id: galaSiteGiftId(ticket.paymentIntentId),
      contactId,
      contactName: contactName || ticket.stripeName || "",
      giftDate: day,
      amount,
      giftType: "Credit",
      frequency: "",
      segment: GALA_SEGMENT_NAME,
      project: GALA_SEGMENT_NAME,
      solicitor: "",
      galaSite: true,
      inVirtuous: false,
      emailMatch,
    });
  }
  return [...gifts, ...extra];
}
