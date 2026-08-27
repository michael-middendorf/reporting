import type { AttritionRow, CensusSnapshot, LabeledCount } from "./types";

export const COUNTRY_NAMES: Record<string, string> = {
  CAN: "Canada",
  GERMAN: "Germany",
  BRAZIL: "Brazil",
  ITALY: "Italy",
  MEX: "Mexico",
  CAY: "Cayman Islands",
  IRELAN: "Ireland",
  MONT: "Montenegro",
  NICARA: "Nicaragua",
  NORW: "Norway",
  PARAGU: "Paraguay",
  SPAIN: "Spain",
  UK: "United Kingdom",
};

export const ETHNICITY_NAMES: Record<string, string> = {
  WHITE: "White",
  HISPAN: "Hispanic",
  ASIAN: "Asian",
  BLACK: "Black",
  HAWAII: "Native Hawaiian / Pacific Islander",
  AMINDI: "American Indian",
};

export const CLASS_ORDER = ["Freshman", "Sophomore", "Junior", "Senior"];

export const GPA_ORDER = ["<1.0", "1.0 - 1.9", "2.0 - 2.49", "2.5 - 2.99", "3.0 - 3.49", "3.5 - 4.0"];

function prettyBlank(label: string, fallback: string): string {
  const t = (label || "").trim();
  if (!t || t === "-" || t.toLowerCase() === "unknown") return fallback;
  return t;
}

function mapLabel(label: string, dict: Record<string, string>, blank: string): string {
  const t = prettyBlank(label, blank);
  return dict[t.toUpperCase()] || t;
}

function sortLabeled(rows: LabeledCount[], blankLast = "International"): LabeledCount[] {
  return [...rows].sort((a, b) => {
    const aLast = a.label === blankLast || a.label === "Unknown" ? 1 : 0;
    const bLast = b.label === blankLast || b.label === "Unknown" ? 1 : 0;
    if (aLast !== bLast) return aLast - bLast;
    return a.label.localeCompare(b.label);
  });
}

function sortClass(rows: LabeledCount[]): LabeledCount[] {
  return [...rows].sort((a, b) => {
    const ai = CLASS_ORDER.indexOf(a.label);
    const bi = CLASS_ORDER.indexOf(b.label);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

function sortGpa(rows: AttritionRow[]): AttritionRow[] {
  return [...rows].sort((a, b) => {
    const ai = GPA_ORDER.indexOf(a.label);
    const bi = GPA_ORDER.indexOf(b.label);
    const av = ai === -1 ? (a.label.startsWith("No ") ? 100 : 50) : ai;
    const bv = bi === -1 ? (b.label.startsWith("No ") ? 100 : 50) : bi;
    return av - bv;
  });
}

function sortStatesAlpha(rows: AttritionRow[]): AttritionRow[] {
  return [...rows].sort((a, b) => {
    if (a.label === "Total") return 1;
    if (b.label === "Total") return -1;
    return a.label.localeCompare(b.label);
  });
}

/** Display-only cleanup so tables match the FA25 census workbook. */
export function presentSnapshot(data: CensusSnapshot): CensusSnapshot {
  data.ug.states = sortLabeled(data.ug.states, "International");
  data.ug.countries = sortLabeled(
    data.ug.countries.map((r) => ({
      ...r,
      label: mapLabel(r.label, COUNTRY_NAMES, "Unknown"),
    })),
    "Unknown",
  );
  data.ug.classLevel = sortClass(data.ug.classLevel);
  data.ug.honorsByClass = sortClass(data.ug.honorsByClass);
  data.ug.sports = [...data.ug.sports].sort((a, b) => a.label.localeCompare(b.label));
  data.ug.gender = [...data.ug.gender].sort((a, b) => a.label.localeCompare(b.label));
  const athleteOrder = ["Athlete", "Non-Athlete"];
  const sortAthlete = (rows: LabeledCount[]) =>
    [...rows].sort((a, b) => athleteOrder.indexOf(a.label) - athleteOrder.indexOf(b.label));
  data.ug.athlete = sortAthlete(data.ug.athlete);
  data.ug.incomingAthlete = sortAthlete(data.ug.incomingAthlete);
  data.ug.floridaAthlete = sortAthlete(data.ug.floridaAthlete);
  data.ug.nonFloridaCatholicAthlete = sortAthlete(data.ug.nonFloridaCatholicAthlete);
  const resOrder = ["Commuter", "Other", "Resident", "Study Abroad", "Unassigned"];
  data.ug.residency = [...data.ug.residency].sort((a, b) => {
    const ai = resOrder.indexOf(a.label);
    const bi = resOrder.indexOf(b.label);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  data.ftcaAttrition.byState = sortStatesAlpha(data.ftcaAttrition.byState);
  data.ftcaAttrition.byEthnicity = data.ftcaAttrition.byEthnicity.map((r) => ({
    ...r,
    label: mapLabel(r.label, ETHNICITY_NAMES, "No Response"),
  }));
  data.ftcaAttrition.byGpa = sortGpa(
    data.ftcaAttrition.byGpa.map((r) => ({
      ...r,
      label: prettyBlank(r.label, "No AMU GPA"),
    })),
  );
  return data;
}
