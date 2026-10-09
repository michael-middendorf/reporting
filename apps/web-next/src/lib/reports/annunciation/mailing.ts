/** New-member mailing list for the Annunciation Circle report.

The date window uses startDate only. firstSeen and memberSince() are not
fallbacks here: a null startDate is outside every window.
*/

import type { AnnunciationMember } from "./shape";

export type NewMemberQuery = {
  from: string;
  to: string;
  /** Null or omitted means no amount floor. */
  minAmount: number | null;
};

export type NewMemberRow = {
  member: AnnunciationMember;
  firstName: string;
  lastName: string;
  formalAddressee: string;
  formalSalutation: string;
};

const TITLE_PREFIXES = [
  "Mr. and Mrs.",
  "Mr. and Mr.",
  "Mrs. and Mrs.",
  "Ms. and Ms.",
  "Dr. and Dr.",
  "Dr. and Mrs.",
  "Dr. and Mr.",
  "Mr.",
  "Mrs.",
  "Ms.",
  "Miss",
  "Dr.",
  "Rev.",
  "Fr.",
  "Sister",
  "Brother",
  "Mother",
] as const;

const RELIGIOUS = new Set(["sister", "brother", "mother"]);

const CSV_COLUMNS = [
  "Virtuous ID",
  "First name",
  "Last name",
  "Formal addressee",
  "Formal salutation",
  "Address 1",
  "Address 2",
  "City",
  "State",
  "Postal",
  "Country",
  "Recurring gift amount",
  "Frequency",
  "Member since",
] as const;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function resolvedNames(member: AnnunciationMember): { first: string; last: string } {
  const first = clean(member.firstName);
  const last = clean(member.lastName);
  if (first) return { first, last };
  const name = clean(member.name);
  const comma = name.indexOf(",");
  if (comma >= 0) {
    return {
      last: name.slice(0, comma).trim(),
      first: name.slice(comma + 1).trim(),
    };
  }
  return { first: name, last: "" };
}

function hasSecondary(member: AnnunciationMember): boolean {
  return Boolean(clean(member.secondaryFirstName) || clean(member.secondaryLastName));
}

function sameLastName(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

/** Formal addressee. Does not invent Mr. or Mrs. when the prefix is empty. */
export function formalAddressee(member: AnnunciationMember): string {
  const formal = clean(member.formalContactName);
  if (formal) return formal;

  const { first, last } = resolvedNames(member);
  const prefix = clean(member.prefix);
  const suffix = clean(member.suffix);
  const secondaryFirst = clean(member.secondaryFirstName);
  const secondaryLast = clean(member.secondaryLastName);
  const secondaryPrefix = clean(member.secondaryPrefix);

  if (!hasSecondary(member)) {
    return [prefix, first, last, suffix].filter(Boolean).join(" ") || clean(member.name);
  }

  if (sameLastName(last, secondaryLast) && prefix && secondaryPrefix && first) {
    return `${prefix} and ${secondaryPrefix} ${first} ${last}`.replace(/\s+/g, " ").trim();
  }

  const left = [prefix, first, last].filter(Boolean).join(" ");
  const right = [secondaryPrefix, secondaryFirst, secondaryLast].filter(Boolean).join(" ");
  if (left && right) return `${left} and ${right}`;
  return left || right || clean(member.name);
}

function titleMatch(addressee: string): { key: string; original: string } | null {
  const lower = addressee.toLowerCase();
  for (const prefix of TITLE_PREFIXES) {
    const key = prefix.toLowerCase();
    if (!lower.startsWith(key)) continue;
    const next = addressee.charAt(prefix.length);
    if (next !== "" && next !== " " && next !== ",") continue;
    return { key, original: addressee.slice(0, prefix.length) };
  }
  return null;
}

function isSuffixToken(token: string): boolean {
  return /^(jr|sr|ii|iii|iv|phd|md)\.?$/i.test(token.replace(/,/g, ""));
}

/** Name line only. No "Dear " prefix. */
export function formalSalutation(addressee: string): string {
  const text = addressee.trim();
  if (!text) return "";
  const match = titleMatch(text);
  if (!match) return text;
  if (RELIGIOUS.has(match.key)) return text;

  const rest = text.slice(match.original.length).trim();
  const tokens = rest ? rest.split(/\s+/) : [];
  while (tokens.length > 0 && isSuffixToken(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0) return match.original;
  const last = tokens[tokens.length - 1].replace(/,+$/g, "");
  return last ? `${match.original} ${last}` : match.original;
}

export function formatMailingAddress(member: AnnunciationMember): string {
  const address1 = clean(member.address1);
  const address2 = clean(member.address2);
  const city = clean(member.city);
  const state = clean(member.state);
  const postal = clean(member.postal);
  if (address1 || address2 || city || state || postal) {
    const loc = [city, state].filter(Boolean).join(", ");
    const tail = [loc, postal].filter(Boolean).join(" ");
    return [address1, address2, tail].filter(Boolean).join(", ");
  }
  return clean(member.address);
}

function inDateWindow(startDate: string, from: string, to: string): boolean {
  if (from && startDate < from) return false;
  if (to && startDate > to) return false;
  return true;
}

function passesAmount(amount: number | null, minAmount: number | null): boolean {
  if (minAmount == null) return true;
  if (amount == null || !Number.isFinite(amount)) return false;
  return amount >= minAmount;
}

export function newMemberRows(members: AnnunciationMember[], query: NewMemberQuery): NewMemberRow[] {
  const from = clean(query.from);
  const to = clean(query.to);
  const rows: NewMemberRow[] = [];
  for (const member of members) {
    const startDate = clean(member.startDate);
    if (!startDate || !inDateWindow(startDate, from, to)) continue;
    if (!passesAmount(member.recurringAmount ?? null, query.minAmount)) continue;
    const names = resolvedNames(member);
    const addressee = formalAddressee(member);
    rows.push({
      member,
      firstName: names.first,
      lastName: names.last,
      formalAddressee: addressee,
      formalSalutation: formalSalutation(addressee),
    });
  }
  rows.sort((a, b) => {
    const byDate = clean(b.member.startDate).localeCompare(clean(a.member.startDate));
    if (byDate) return byDate;
    const byLast = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" });
    if (byLast) return byLast;
    const byFirst = a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" });
    if (byFirst) return byFirst;
    return a.member.id - b.member.id;
  });
  return rows;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function newMemberCsv(rows: NewMemberRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const amount = row.member.recurringAmount;
    const fields = [
      String(row.member.id),
      row.firstName,
      row.lastName,
      row.formalAddressee,
      row.formalSalutation,
      clean(row.member.address1),
      clean(row.member.address2),
      clean(row.member.city),
      clean(row.member.state),
      clean(row.member.postal),
      clean(row.member.country),
      amount == null || !Number.isFinite(amount) ? "" : amount.toFixed(2),
      clean(row.member.recurringFrequency),
      clean(row.member.startDate),
    ];
    lines.push(fields.map(csvField).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
