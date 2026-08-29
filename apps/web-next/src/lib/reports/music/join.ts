import {
  cycleTerm,
  defaultWorkflow,
  type MusicCycle,
  type MusicRow,
  type WorkflowState,
} from "./types";

export function pick(row: Record<string, unknown>, keys: string[]): string {
  const compact = (s: string) => s.toLowerCase().replace(/[\s_\-./]/g, "");
  const wanted = keys.map(compact);
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const text = String(v).trim();
    if (!text) continue;
    if (wanted.includes(compact(k))) return text;
  }
  return "";
}

export function normEmail(v: string): string {
  return v.trim().toLowerCase();
}

export function isMusicIntent(major: string, minor: string): boolean {
  const maj = major.trim().toLowerCase();
  const min = minor.trim().toLowerCase();
  if (maj === "music" || maj.startsWith("music ") || maj.endsWith(" music")) return true;
  if (min === "music" || min === "sacred music") return true;
  if (min.includes("sacred music")) return true;
  return false;
}

export function enrollmentStatus(row: Record<string, unknown>): string {
  const withdrawn = pick(row, ["withdrawnDate", "WithdrawnDate", "Withdrawn"]);
  const deposit = pick(row, ["depositDate", "DepositDate", "DepositCode"]);
  const accept = pick(row, ["acceptCode", "AcceptCode"]);
  const submitted = pick(row, ["submittedDate", "ApplicationSubmittedDate", "submitted"]);
  const created = pick(row, ["createdDate", "CreatedDate", "created"]);
  if (withdrawn) return "Withdrawn";
  if (deposit) return "Deposited";
  if (accept) return "Accepted";
  if (submitted) return "Submitted";
  if (created) return "Created";
  return "Unknown";
}

function loiFromCode(code: string): boolean {
  const c = code.trim().toUpperCase();
  return c === "LOIA-MUSIC" || c.startsWith("LOIA");
}

export function toApplicant(row: Record<string, unknown>): MusicRow | null {
  const applicationId = pick(row, [
    "ApplicationReferenceID",
    "applicationId",
    "ApplicationGUID",
    "Application Id",
    "app_id",
  ]);
  const major = pick(row, ["Major", "major", "Intended Major", "app_major"]);
  const minor = pick(row, ["Minor", "minor", "Intended Minor", "app_minor"]);
  if (!applicationId) return null;
  if (!isMusicIntent(major, minor)) return null;
  const loiCode = pick(row, [
    "AllDecisionCodes",
    "DecisionCode",
    "loiCode",
    "LOICode",
  ]);
  const award = pick(row, ["ScholarshipAmount", "ScholarshipName"]);
  const workflow = defaultWorkflow();
  if (award) workflow.musicAward = award;
  return {
    applicationId,
    personId: pick(row, [
      "PersonReferenceID",
      "personId",
      "PersonGUID",
      "Person Id",
    ]),
    first: pick(row, ["first", "First", "FirstName"]),
    last: pick(row, ["last", "Last", "LastName"]),
    email: pick(row, ["email", "Email", "PersonEmail"]),
    phone: pick(row, ["phone", "Phone", "Mobile", "Cell"]),
    term: pick(row, ["ApplicationTerm", "term", "app_term"]),
    studentType: pick(row, [
      "ApplicationStudentType",
      "ApplicationType",
      "studentType",
      "app_type",
    ]),
    major,
    minor,
    enrollmentStatus: enrollmentStatus(row),
    acceptCode: pick(row, ["AcceptCode", "acceptCode"]),
    ameStatus: "",
    ameEvent: "",
    auditionRequested: false,
    auditionDate: "",
    auditionInstrument: "",
    loiFromSlate: loiFromCode(loiCode),
    loiCode,
    workflow,
  };
}

type AmePick = { status: string; event: string; when: string };

export type PersonPick = { first: string; last: string; email: string };

function ameScore(status: string): number {
  const s = status.toLowerCase();
  if (s === "attended") return 3;
  if (s === "registered") return 2;
  if (s === "no show") return 1;
  return 0;
}

function putAme(out: Map<string, AmePick>, key: string, next: AmePick) {
  const prev = out.get(key);
  if (!prev) {
    out.set(key, next);
    return;
  }
  if (ameScore(next.status) > ameScore(prev.status)) {
    out.set(key, next);
    return;
  }
  if (ameScore(next.status) === ameScore(prev.status) && next.when > prev.when) {
    out.set(key, next);
  }
}

export function indexAme(rows: Record<string, unknown>[]): Map<string, AmePick> {
  const out = new Map<string, AmePick>();
  for (const row of rows) {
    const status = pick(row, ["RegistrationStatus", "registrationStatus", "status"]);
    const event = pick(row, ["FormStartDateTime", "FormStartDate", "formStartDate", "eventDate"]);
    const when = pick(row, ["SubmissionDate", "submittedDate"]) || event;
    const next: AmePick = { status, event, when };
    const email = normEmail(pick(row, ["email", "Email", "PersonEmail"]));
    if (email) putAme(out, email, next);
    const personId = pick(row, ["PersonReferenceID", "personId"]).toLowerCase();
    if (personId) putAme(out, `p:${personId}`, next);
  }
  return out;
}

export function indexPeople(rows: Record<string, unknown>[]): Map<string, PersonPick> {
  const out = new Map<string, PersonPick>();
  for (const row of rows) {
    const personId = pick(row, ["PersonReferenceID", "personId"]).toLowerCase();
    if (!personId) continue;
    const next: PersonPick = {
      first: pick(row, ["FirstName", "first", "First"]),
      last: pick(row, ["LastName", "last", "Last", "Name"]),
      email: pick(row, ["Email", "email", "PersonEmail"]),
    };
    const prev = out.get(personId);
    if (!prev || (!prev.first && next.first) || (!prev.email && next.email)) {
      out.set(personId, next);
    }
  }
  return out;
}

export function indexLoiCodes(rows: Record<string, unknown>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const appId = pick(row, ["ApplicationReferenceID", "applicationId"]);
    const code = pick(row, ["DecisionCode", "AllDecisionCodes", "DecisionName"]);
    if (!appId || !code) continue;
    const prev = out.get(appId.toLowerCase()) || "";
    out.set(appId.toLowerCase(), prev ? `${prev};${code}` : code);
  }
  return out;
}

export function indexAuditions(rows: Record<string, unknown>[]): Map<string, { date: string; instrument: string }> {
  const out = new Map<string, { date: string; instrument: string }>();
  for (const row of rows) {
    const email = normEmail(pick(row, ["email", "Email", "PersonEmail"]));
    const personId = pick(row, ["personId", "PersonGUID", "Person Id"]).toLowerCase();
    const date = pick(row, ["submittedDate", "Submitted", "created", "FormSubmitted"]);
    const instrument = pick(row, ["instrument", "auditionInstrument", "Instrument Auditioning With"]);
    const rec = { date, instrument };
    if (email) {
      const prev = out.get(`e:${email}`);
      if (!prev || date > prev.date) out.set(`e:${email}`, rec);
    }
    if (personId) {
      const prev = out.get(`p:${personId}`);
      if (!prev || date > prev.date) out.set(`p:${personId}`, rec);
    }
  }
  return out;
}

export function applyJoins(
  applicants: MusicRow[],
  ame: Map<string, AmePick>,
  auditions: Map<string, { date: string; instrument: string }>,
  workflow: Record<string, WorkflowState>,
  people?: Map<string, PersonPick>,
  loiByApp?: Map<string, string>,
): MusicRow[] {
  return applicants.map((row) => {
    const email = normEmail(row.email);
    const personKey = row.personId.trim().toLowerCase();
    const person = people?.get(personKey);
    const ameHit =
      (email ? ame.get(email) : undefined) ||
      (personKey ? ame.get(`p:${personKey}`) : undefined);
    const aud =
      (email ? auditions.get(`e:${email}`) : undefined) ||
      (personKey ? auditions.get(`p:${personKey}`) : undefined);
    const overlay = workflow[row.applicationId.toLowerCase()] || workflow[row.applicationId];
    const base = {
      ...defaultWorkflow(),
      ...row.workflow,
      ...(overlay || {}),
    };
    const loiCodes = loiByApp?.get(row.applicationId.toLowerCase()) || row.loiCode;
    const loiFromSlate = row.loiFromSlate || loiFromCode(loiCodes);
    if (!overlay && loiFromSlate) base.loiSigned = true;
    return {
      ...row,
      first: row.first || person?.first || "",
      last: row.last || person?.last || "",
      email: row.email || person?.email || "",
      loiCode: loiCodes,
      loiFromSlate,
      ameStatus: ameHit?.status || "",
      ameEvent: ameHit?.event ? ameHit.event.slice(0, 10) : "",
      auditionRequested: Boolean(aud),
      auditionDate: aud?.date ? aud.date.slice(0, 10) : "",
      auditionInstrument: aud?.instrument || "",
      workflow: base,
    };
  });
}

export function filterCycle(rows: MusicRow[], cycle: MusicCycle): MusicRow[] {
  const term = cycleTerm(cycle).toLowerCase();
  return rows.filter((r) => r.term.toLowerCase().includes(term));
}
