import type { AthleticsRecord, FilterKey, FilterState, SlateRow } from "./types";

const value = (row: SlateRow, ...keys: string[]) => {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return "";
};

export const PROSPECT_GPA_MINIMUM = 3.1;

const SLATE_READER_CONTEXT = "2facf349-05b1-409e-b5fe-db8b9688dabb";
const SLATE_READER_BIN = "6a805900-8a5f-45ce-baa8-6c261939efee";

function slateProfileUrl(personGuid: string): string {
  return personGuid
    ? `https://apply.avemaria.edu/manage/lookup/record?id=${encodeURIComponent(personGuid)}`
    : "";
}

function slateReaderUrl(applicationGuid: string): string {
  if (!applicationGuid) return "";
  const recordLookup = encodeURIComponent(
    `https://apply.avemaria.edu/manage/lookup/record?id=${SLATE_READER_CONTEXT}`,
  );
  return `https://apply.avemaria.edu/manage/reader/?r=${recordLookup}&b=${SLATE_READER_BIN}&id=${encodeURIComponent(applicationGuid)}`;
}

export function prospectMeetsGpaMinimum(row: SlateRow): boolean {
  const parsed = Number(value(row, "PersonGPA"));
  return Number.isFinite(parsed) && parsed >= PROSPECT_GPA_MINIMUM;
}

export function money(input: unknown): number {
  if (input === null || input === undefined || input === "") return 0;
  const text = String(input).trim();
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
}

function faithFootballAmount(row: SlateRow): number {
  const key = Object.keys(row).find((candidate) =>
    /faith.*football|football.*faith|f\s*(?:&|and)?\s*f.*award/i.test(candidate),
  );
  return key ? money(row[key]) : 0;
}

function normalizedGpa(input: string): number | null {
  const parsed = Number(input);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 5 ? parsed : null;
}

function isCatholic(row: SlateRow): boolean {
  const combined = `${value(row, "PersonReligion", "App_Religion")} ${value(row, "CatholicCollegeInfo")}`;
  return /catholic/i.test(combined) && !/not catholic|non-catholic/i.test(combined);
}

export function normalizeApplication(row: SlateRow, index: number): AthleticsRecord {
  const applicationGuid = value(row, "ApplicationGUID");
  const personGuid = value(row, "PersonGUID");
  const sector = value(row, "Sector");
  const loiStatus = value(row, "LOIStatus");
  const deposited = Boolean(value(row, "ApplicationDepositedDate"));
  const signed = /loi signed or deposited/i.test(loiStatus) || deposited;
  const workflowBin = value(row, "ApplicationWorkflowBin");
  const purchased = value(row, "InPurchasedList");
  const record: AthleticsRecord = {
    kind: "application",
    id: applicationGuid || personGuid || value(row, "PersonReferenceID") || `application-${index}`,
    firstName: value(row, "PersonFirstName"),
    lastName: value(row, "PersonLastName"),
    email: value(row, "PersonEmail"),
    phone: value(row, "Phone"),
    city: value(row, "PersonCity"),
    state: value(row, "PersonRegion"),
    sport: value(row, "PersonSport"),
    position: value(row, "FootballPrimary"),
    gender: value(row, "Gender"),
    term: value(row, "ApplicationApplicationTerm"),
    sector,
    athleteStatus: value(row, "ApplicationAthleticDecision", "AthleteDecision"),
    applicationStatus: value(row, "ApplicationStatus"),
    workflowBin,
    stage: "",
    decisionCode: value(row, "ApplicationDecisionCode"),
    withdrawn: value(row, "WDRN") || "Not Withdrawn",
    purchasedList: purchased ? "In a purchased list." : "Not in a purchased list.",
    riskRating: value(row, "PersonRecruit-Rating") || "No Risk Rating",
    loiStatus,
    offered: value(row, "Offered") || "No",
    readyToOffer: /loi review|ready to offer/i.test(workflowBin) ? "Ready to Offer" : "Not Ready to Offer",
    signed: signed ? "Signed or Deposited" : "Not Signed",
    studentType: value(row, "ApplicationStudentType"),
    prospectStatus: "Applicant",
    recordUrl: slateReaderUrl(applicationGuid),
    profileUrl: slateProfileUrl(personGuid),
    gpa: normalizedGpa(value(row, "OfficialAMUGPA", "GPASelfReported")),
    catholic: isCatholic(row),
    athleticScholarship: money(row.AthleticScholarship),
    athleticDiscretionaryFund: money(row.AthleticDiscretionaryFund),
    faithFootball: faithFootballAmount(row),
    impactAwards: money(row.ImpactAwards),
    academicScholarship: money(row.AcademicScholarship),
    admissionsAwards: money(row.AdmissionsAwards),
    totalAwards: money(row.TotalAwards),
  };
  record.stage = stageName(record);
  return record;
}

export function normalizeProspect(row: SlateRow, index: number): AthleticsRecord {
  const purchased = value(row, "InPurchasedList");
  const hasPurchasedField = Object.prototype.hasOwnProperty.call(row, "InPurchasedList");
  return {
    kind: "prospect",
    id: value(row, "ID") || `prospect-${index}`,
    firstName: value(row, "FirstName"),
    lastName: value(row, "LastName"),
    email: value(row, "Email"),
    phone: value(row, "Phone"),
    city: value(row, "AddressbyRankOverallCity"),
    state: value(row, "State"),
    sport: value(row, "PersonSport-Primary"),
    position: value(row, "Position"),
    gender: value(row, "Gender"),
    term: value(row, "EntryTerm", "PersonEntryTerminquiry"),
    sector: "",
    athleteStatus: value(row, "AthleteorNon-Athlete"),
    applicationStatus: "",
    workflowBin: "",
    stage: "Prospect / Inquiry",
    decisionCode: "",
    withdrawn: "Not Withdrawn",
    purchasedList: hasPurchasedField
      ? purchased ? "In a purchased list." : "Not in a purchased list."
      : "",
    riskRating: "No Risk Rating",
    loiStatus: "",
    offered: "No",
    readyToOffer: "Not Ready to Offer",
    signed: "Not Signed",
    studentType: value(row, "StudentType"),
    prospectStatus: value(row, "Status"),
    recordUrl: value(row, "RecordURL"),
    profileUrl: slateProfileUrl(value(row, "ID")),
    gpa: normalizedGpa(value(row, "PersonGPA")),
    catholic: isCatholic(row),
    athleticScholarship: 0,
    athleticDiscretionaryFund: 0,
    faithFootball: 0,
    impactAwards: 0,
    academicScholarship: 0,
    admissionsAwards: 0,
    totalAwards: 0,
  };
}

export function eligibleSigned(record: AthleticsRecord): boolean {
  return (
    record.kind === "application" &&
    record.signed === "Signed or Deposited" &&
    Boolean(record.sector) &&
    !/non-varsity|non-naia|student coach|manager/i.test(record.sector)
  );
}

export function stageColor(record: AthleticsRecord): string {
  return STAGE_COLORS[stageName(record)];
}

export const STAGE_COLORS = {
  "Withdrawn": "#f9dddd",
  "Signed / Deposited": "#d8eddd",
  "LOI Review": "#dceef7",
  "Offered": "#e7f1df",
  "Accepted": "#fff0cc",
  "Applied": "#eee2f1",
} as const;

export type StageName = keyof typeof STAGE_COLORS;

export function stageName(record: AthleticsRecord): StageName {
  if (/withdrawn/i.test(record.withdrawn) && record.withdrawn !== "Not Withdrawn") return "Withdrawn";
  if (record.signed === "Signed or Deposited") return "Signed / Deposited";
  if (/loi review/i.test(record.workflowBin)) return "LOI Review";
  if (/yes/i.test(record.offered)) return "Offered";
  if (["ACCTL", "CA"].includes(record.decisionCode.toUpperCase())) return "Accepted";
  return "Applied";
}

export function recordMatches(record: AthleticsRecord, filters: FilterState): boolean {
  return (Object.entries(filters) as [FilterKey, string[]][]).every(([key, selected]) => {
    if (!selected.length) return true;
    return selected.includes(record[key]);
  });
}

export function filterOptions(records: AthleticsRecord[]): Record<FilterKey, string[]> {
  const keys: FilterKey[] = [
    "sport", "gender", "term", "sector", "stage", "athleteStatus", "withdrawn", "position",
    "riskRating", "applicationStatus", "workflowBin", "purchasedList", "readyToOffer", "signed",
  ];
  const stageOrder = ["Applied", "Accepted", "Offered", "LOI Review", "Signed / Deposited", "Withdrawn", "Prospect / Inquiry"];
  return Object.fromEntries(keys.map((key) => {
    const values = [...new Set(
      records
        .map((record) => record[key])
        .filter((item) => Boolean(item) && !(key === "stage" && item === "Prospect / Inquiry")),
    )];
    values.sort((left, right) => key === "stage"
      ? stageOrder.indexOf(left) - stageOrder.indexOf(right)
      : left.localeCompare(right));
    return [key, values];
  })) as Record<FilterKey, string[]>;
}
