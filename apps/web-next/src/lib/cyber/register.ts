/**
 * Cybersecurity risk register and manual KPIs: types, strict validation,
 * and DynamoDB key layout. Safe to import from client and server code
 * (no AWS SDK here; the store lives in register-store.ts).
 *
 * Table (CYBER_REGISTER_TABLE, amu-reporting-cyber-register):
 *   pk "RISK",        sk <risk id>     one risk item
 *   pk "KPI",         sk <kpi id>      one manual KPI
 *   pk "HIST#<id>",   sk <iso ts>#<r>  one history row per write {by, before, after}
 *
 * Text fields refuse anything that looks like an email address or an IPv4
 * address: the register is for roles, counts and statuses, never people or hosts.
 */

import { CYBER_SECTIONS, RAGS, type CyberSection, type Rag } from "./shape";

export const RISK_CATEGORIES = [
  "identity",
  "endpoint",
  "email",
  "cloud",
  "network",
  "application",
  "data",
  "resilience",
  "governance",
  "vendor",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const TREATMENTS = ["mitigate", "accept", "transfer", "avoid"] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const RISK_STATUSES = ["open", "in_progress", "accepted", "closed"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

/** Fields a person supplies for a risk. */
export type RiskInput = {
  id: string;
  title: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  /** A role ("IT Director", "SKB Cyber"), never a person's email. */
  owner: string;
  treatment: Treatment;
  dueDate: string | null;
  status: RiskStatus;
  kpiId: string | null;
  acceptedExpiry: string | null;
  notes: string;
  /** Where the risk was documented (doc name or "board"), not a URL with secrets. */
  source: string;
};

/** Server-maintained fields. */
export type RecordMeta = {
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type RiskItem = RiskInput & RecordMeta;

export type ManualKpiInput = {
  id: string;
  label: string;
  section: CyberSection;
  value: number | string | null;
  unit: string;
  target: string;
  rag: Rag | null;
  asOf: string | null;
  notes: string;
};

export type ManualKpi = ManualKpiInput & RecordMeta;

export type RegisterKind = "risk" | "kpi";

export const PK_RISK = "RISK";
export const PK_KPI = "KPI";

export function pkForKind(kind: RegisterKind): string {
  return kind === "risk" ? PK_RISK : PK_KPI;
}

export function historyPk(id: string): string {
  return `HIST#${id}`;
}

export function riskScore(r: Pick<RiskInput, "likelihood" | "impact">): number {
  return r.likelihood * r.impact;
}

/** Ratings bands for the 5x5 heatmap: >= 15 red, >= 8 amber, else green. */
export function riskBand(score: number): Exclude<Rag, "grey"> {
  if (score >= 15) return "red";
  if (score >= 8) return "amber";
  return "green";
}

// ---------------------------------------------------------------------------
// Validation (manual: the repo has no zod). Unknown keys are rejected so a
// typo never silently drops a field and nothing unexpected is stored.
// ---------------------------------------------------------------------------

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

const RISK_KEYS: readonly (keyof RiskInput)[] = [
  "id",
  "title",
  "category",
  "likelihood",
  "impact",
  "owner",
  "treatment",
  "dueDate",
  "status",
  "kpiId",
  "acceptedExpiry",
  "notes",
  "source",
];

const KPI_KEYS: readonly (keyof ManualKpiInput)[] = [
  "id",
  "label",
  "section",
  "value",
  "unit",
  "target",
  "rag",
  "asOf",
  "notes",
];

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function text(
  errors: string[],
  field: string,
  raw: unknown,
  opts: { max: number; required?: boolean },
): string {
  if (raw === undefined || raw === null) raw = "";
  if (typeof raw !== "string") {
    errors.push(`${field} must be a string`);
    return "";
  }
  const v = raw.trim();
  if (opts.required && !v) errors.push(`${field} is required`);
  if (v.length > opts.max) errors.push(`${field} must be at most ${opts.max} characters`);
  if (CONTROL_RE.test(v)) errors.push(`${field} contains control characters`);
  if (EMAIL_RE.test(v)) errors.push(`${field} must not contain an email address`);
  if (IPV4_RE.test(v)) errors.push(`${field} must not contain an IP address`);
  return v;
}

function oneOf<T extends string>(
  errors: string[],
  field: string,
  raw: unknown,
  allowed: readonly T[],
): T {
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) return raw as T;
  errors.push(`${field} must be one of ${allowed.join(", ")}`);
  return allowed[0]!;
}

function rating(errors: string[], field: string, raw: unknown): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5) return raw;
  errors.push(`${field} must be an integer 1 to 5`);
  return 1;
}

function optionalDate(errors: string[], field: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string" && isValidDate(raw)) return raw;
  errors.push(`${field} must be a date YYYY-MM-DD`);
  return null;
}

function optionalId(errors: string[], field: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string" && ID_RE.test(raw)) return raw;
  errors.push(`${field} must be lowercase letters, digits and hyphens`);
  return null;
}

function requireId(errors: string[], raw: unknown): string {
  if (typeof raw === "string" && ID_RE.test(raw)) return raw;
  errors.push("id must be 2 to 64 lowercase letters, digits and hyphens");
  return "";
}

function rejectUnknownKeys(errors: string[], obj: Record<string, unknown>, keys: readonly string[]) {
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) errors.push(`unknown field ${k}`);
  }
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function validateRiskInput(raw: unknown): ValidationResult<RiskInput> {
  const obj = asObject(raw);
  if (!obj) return { ok: false, errors: ["risk must be an object"] };
  const errors: string[] = [];
  rejectUnknownKeys(errors, obj, RISK_KEYS);
  const id = requireId(errors, obj.id);
  if (id.startsWith("kpi-")) errors.push("risk ids must not start with kpi-");
  const value: RiskInput = {
    id,
    title: text(errors, "title", obj.title, { max: 200, required: true }),
    category: oneOf(errors, "category", obj.category, RISK_CATEGORIES),
    likelihood: rating(errors, "likelihood", obj.likelihood),
    impact: rating(errors, "impact", obj.impact),
    owner: text(errors, "owner", obj.owner, { max: 100, required: true }),
    treatment: oneOf(errors, "treatment", obj.treatment, TREATMENTS),
    dueDate: optionalDate(errors, "dueDate", obj.dueDate),
    status: oneOf(errors, "status", obj.status, RISK_STATUSES),
    kpiId: optionalId(errors, "kpiId", obj.kpiId),
    acceptedExpiry: optionalDate(errors, "acceptedExpiry", obj.acceptedExpiry),
    notes: text(errors, "notes", obj.notes, { max: 2000 }),
    source: text(errors, "source", obj.source, { max: 200, required: true }),
  };
  if (value.status === "accepted" && !value.acceptedExpiry) {
    errors.push("acceptedExpiry is required when status is accepted");
  }
  if (value.status === "accepted" && value.treatment !== "accept") {
    errors.push("status accepted requires treatment accept");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function validateManualKpiInput(raw: unknown): ValidationResult<ManualKpiInput> {
  const obj = asObject(raw);
  if (!obj) return { ok: false, errors: ["kpi must be an object"] };
  const errors: string[] = [];
  rejectUnknownKeys(errors, obj, KPI_KEYS);
  const id = requireId(errors, obj.id);
  if (id && !id.startsWith("kpi-")) errors.push("manual KPI ids must start with kpi-");
  let kpiValue: number | string | null = null;
  if (typeof obj.value === "number") {
    if (Number.isFinite(obj.value)) kpiValue = obj.value;
    else errors.push("value must be a finite number");
  } else if (typeof obj.value === "string") {
    kpiValue = text(errors, "value", obj.value, { max: 60 });
  } else if (obj.value !== null && obj.value !== undefined) {
    errors.push("value must be a number, a short string, or null");
  }
  let rag: Rag | null = null;
  if (obj.rag !== undefined && obj.rag !== null && obj.rag !== "") {
    rag = oneOf(errors, "rag", obj.rag, RAGS);
  }
  const value: ManualKpiInput = {
    id,
    label: text(errors, "label", obj.label, { max: 120, required: true }),
    section: oneOf(errors, "section", obj.section, CYBER_SECTIONS),
    value: kpiValue,
    unit: text(errors, "unit", obj.unit, { max: 20 }),
    target: text(errors, "target", obj.target, { max: 60 }),
    rag,
    asOf: optionalDate(errors, "asOf", obj.asOf),
    notes: text(errors, "notes", obj.notes, { max: 2000 }),
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function validateInput(
  kind: RegisterKind,
  raw: unknown,
): ValidationResult<RiskInput | ManualKpiInput> {
  return kind === "risk" ? validateRiskInput(raw) : validateManualKpiInput(raw);
}

export function parseKind(raw: unknown): RegisterKind | null {
  return raw === "risk" || raw === "kpi" ? raw : null;
}

/** Strip server meta so a stored item can be re-validated after a PATCH merge. */
export function inputFields<T extends RecordMeta>(item: T): Omit<T, keyof RecordMeta> {
  const { createdAt: _c, updatedAt: _u, updatedBy: _b, version: _v, ...rest } = item;
  void _c;
  void _u;
  void _b;
  void _v;
  return rest;
}
