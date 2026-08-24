export type SlateRow = Record<string, unknown>;

export type AthleticsRecord = {
  kind: "application" | "prospect";
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  sport: string;
  position: string;
  gender: string;
  term: string;
  sector: string;
  athleteStatus: string;
  applicationStatus: string;
  workflowBin: string;
  stage: string;
  decisionCode: string;
  withdrawn: string;
  purchasedList: string;
  riskRating: string;
  loiStatus: string;
  offered: string;
  readyToOffer: string;
  signed: string;
  studentType: string;
  prospectStatus: string;
  recordUrl: string;
  profileUrl: string;
  gpa: number | null;
  catholic: boolean;
  athleticScholarship: number;
  athleticDiscretionaryFund: number;
  faithFootball: number;
  impactAwards: number;
  academicScholarship: number;
  admissionsAwards: number;
  totalAwards: number;
};

export const FILTER_KEYS = [
  "sport",
  "gender",
  "term",
  "sector",
  "stage",
  "athleteStatus",
  "withdrawn",
  "position",
  "riskRating",
  "applicationStatus",
  "workflowBin",
  "purchasedList",
  "readyToOffer",
  "signed",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];
export type FilterState = Record<FilterKey, string[]>;

export type AthleticsPayload = {
  success: boolean;
  generatedAt: string | null;
  applications: AthleticsRecord[];
  prospects: AthleticsRecord[];
  errors?: Record<string, string>;
};
