/**
 * Lean donor profile for the points Insights tab.
 * Birth year and university relationship come from the Virtuous contact.
 * Names, addresses, and emails stay off this object.
 */

export const RELATIONSHIPS = [
  { id: "alumni", label: "Alumni" },
  { id: "faculty", label: "Faculty/Staff" },
  { id: "parent", label: "Parent" },
  { id: "grandparent", label: "Grandparent" },
  { id: "student", label: "Student" },
];

const RELATIONSHIP_NAMES = {
  alumni: ["alumni"],
  faculty: ["faculty/staff", "staff/faculty"],
  parent: ["parent", "parents", "parents-former", "parents-lifetime"],
  grandparent: ["grandparent", "grandparents"],
  student: ["student", "student-former"],
};

/** Birth-year bands. Gen Z starts in 1997, matching the usual cut. */
export const GENERATIONS = [
  { id: "genz", label: "Gen Z", born: "1997–2012", from: 1997, to: 2012 },
  { id: "millennial", label: "Millennial", born: "1981–1996", from: 1981, to: 1996 },
  { id: "genx", label: "Gen X", born: "1965–1980", from: 1965, to: 1980 },
  { id: "boomer", label: "Boomer", born: "1946–1964", from: 1946, to: 1964 },
  { id: "earlier", label: "Silent & earlier", born: "before 1946", from: 0, to: 1945 },
  { id: "later", label: "Born 2013 or later", born: "2013 or later", from: 2013, to: 9999 },
];

export const DONOR_TAGS = [
  { id: "first", label: "First-time", names: ["first-time donor", "first time donor"] },
  { id: "recurring", label: "Recurring", names: ["recurring giver", "sustaining donor"] },
  { id: "lapsed", label: "Lapsed", names: ["lapsed donor"] },
];

export function generationForYear(year) {
  if (year == null || !Number.isFinite(Number(year))) return null;
  const y = Number(year);
  return GENERATIONS.find((g) => y >= g.from && y <= g.to) || null;
}

function fold(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function truthyField(value) {
  const v = fold(value);
  if (!v) return false;
  return v !== "no" && v !== "false" && v !== "0" && v !== "none" && v !== "n/a";
}

function customFields(record) {
  const out = [];
  for (const field of record?.customFields || []) {
    if (!field || typeof field !== "object") continue;
    out.push({ name: field.name || field.displayName || "", value: field.value });
  }
  return out;
}

function tagNames(record) {
  const names = [];
  for (const tag of record?.tags || record?.contactTags || []) {
    if (typeof tag === "string") names.push(tag);
    else if (tag && typeof tag === "object") names.push(tag.tagName || tag.name || "");
  }
  return names;
}

function individuals(contact) {
  const list = contact?.contactIndividuals || contact?.individuals || [];
  return Array.isArray(list) ? list.filter((person) => person && typeof person === "object") : [];
}

function pickPerson(people) {
  return (
    people.find((person) => person.isPrimary && (person.birthYear || person.approximateAge != null)) ||
    people.find((person) => person.birthYear || person.approximateAge != null) ||
    people.find((person) => person.isPrimary) ||
    people[0] ||
    null
  );
}

/** Age of one Virtuous individual on `asOf`. Birth month counts when the day is blank. */
export function ageFromPerson(person, asOf = new Date()) {
  if (!person) return { age: null, birthYear: null };
  const year = Number(person.birthYear);
  const hasYear = Number.isFinite(year) && year > 1800 && year < 2200;
  const month = Number(person.birthMonth);
  const day = Number(person.birthDay);
  const approx = Number(person.approximateAge);
  const when = asOf instanceof Date ? asOf : new Date();
  if (hasYear && Number.isFinite(month) && month >= 1 && month <= 12) {
    let age = when.getFullYear() - year;
    const beforeMonth = when.getMonth() + 1 < month;
    const beforeDay =
      when.getMonth() + 1 === month && Number.isFinite(day) && day >= 1 && when.getDate() < day;
    if (beforeMonth || beforeDay) age -= 1;
    if (age >= 0 && age <= 120) return { age, birthYear: year };
  }
  if (hasYear) {
    const rough = when.getFullYear() - year;
    if (Number.isFinite(approx) && Math.abs(approx - rough) <= 1 && approx >= 0 && approx <= 120) {
      return { age: approx, birthYear: year };
    }
    if (rough >= 0 && rough <= 120) return { age: rough, birthYear: year };
  }
  if (Number.isFinite(approx) && approx >= 0 && approx <= 120) {
    return { age: approx, birthYear: when.getFullYear() - approx };
  }
  return { age: null, birthYear: null };
}

function relationshipIds(contact, people) {
  const found = new Set();
  const names = [...tagNames(contact)];
  const fields = [...customFields(contact)];
  for (const person of people) {
    names.push(...tagNames(person));
    fields.push(...customFields(person));
  }
  for (const rel of RELATIONSHIPS) {
    const allowed = RELATIONSHIP_NAMES[rel.id];
    for (const name of names) {
      if (allowed.includes(fold(name))) found.add(rel.id);
    }
    for (const field of fields) {
      if (!allowed.includes(fold(field.name))) continue;
      if (truthyField(field.value)) found.add(rel.id);
    }
  }
  return RELATIONSHIPS.filter((rel) => found.has(rel.id)).map((rel) => rel.id);
}

function donorTagIds(contact) {
  const names = new Set(tagNames(contact).map(fold));
  return DONOR_TAGS.filter((tag) => tag.names.some((name) => names.has(name))).map((tag) => tag.id);
}

export function projectProfile(contact, asOf = new Date()) {
  const id = Number(contact?.id ?? contact?.contactId);
  if (!Number.isFinite(id)) return null;
  const people = individuals(contact);
  const person = pickPerson(people);
  const { age, birthYear } = ageFromPerson(person, asOf);
  return {
    id,
    birthYear,
    age,
    deceased: !!(person && (person.isDeceased === true || person.isDeceased === "true")),
    relationships: relationshipIds(contact, people),
    donorTags: donorTagIds(contact),
  };
}

export function projectProfiles(contacts, asOf = new Date()) {
  const out = [];
  const seen = new Set();
  for (const contact of contacts || []) {
    const profile = projectProfile(contact, asOf);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    out.push(profile);
  }
  return out;
}
