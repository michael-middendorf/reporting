/** Shared Excel list columns for census export and the live raw-data sheets. */
import {
  censusRawAthleteFlag,
  normPcid,
  type CensusRawStudent,
  type LoaWithStatus,
  type UnretainedStudent,
} from "./lists-core";
import { displayCensusResidency } from "./residency";
import { catholicOf, type FtcaRawRow } from "./retention";

export type ListCell = string | number | null | undefined;

export function displayListCell(value: ListCell): string | number {
  if (value == null || value === "") return "—";
  return value;
}

export function displayListRow(row: ListCell[]): (string | number)[] {
  return row.map(displayListCell);
}

export const CENSUS_RAW_HEADERS = [
  "PCID",
  "First_Name",
  "Last_Name",
  "Incoming/Returning",
  "State",
  "Religion",
  "Cath/Chris/Other",
  "Ethnicity",
  "Gender",
  "Program",
  "Session",
  "College_Attend",
  "Curriculum",
  "Curriculum Name",
  "Class_Level",
  "Full_Part",
  "City",
  "Credits",
  "Cumulative GPA",
  "Resident / Commuter",
  "Athletic Assoc. (Athlet.)",
  "Athlete/Non-Athlete",
  "Athletic Type",
  "Roster Status",
  "Honors",
  "FSP",
  "Household",
  "Institute",
  "Mary's Marines",
  "Application Decision",
  "Degree",
  "AMU Alumni",
  "Email",
  "Citizenship",
  "Visa",
  "DOB",
  "HS GPA",
  "ACT",
  "SAT",
  "CLT",
] as const;

export const CENSUS_RAW_WIDTHS = [
  14, 16, 18, 16, 8, 16, 14, 12, 10, 12, 14, 14, 12, 22, 12, 10, 16, 10, 12, 16, 16, 22, 16, 16, 22, 10, 16, 12, 12, 14,
  16, 12, 10, 32, 12, 12, 10, 8, 8, 8,
];

function amuAlumniCell(s: CensusRawStudent, alumniIds: Set<string>): string {
  if ((s.program || "").trim().toUpperCase() !== "GRAD") return "";
  return alumniIds.has(normPcid(s.pcid)) ? "Yes" : "No";
}

export function censusRawRow(s: CensusRawStudent, alumniIds: Set<string> = new Set()): ListCell[] {
  return [
    s.pcid,
    s.first,
    s.last,
    s.incomingReturning,
    s.state,
    s.religion,
    s.cathGroup,
    s.ethnicity,
    s.gender,
    s.program,
    s.session || "",
    s.collegeAttend,
    s.curriculum,
    s.curriculumName,
    s.classLevel,
    s.fullPart,
    s.city,
    s.credits,
    s.gpa,
    displayCensusResidency(s.residency),
    s.sport,
    censusRawAthleteFlag(s),
    s.athleticType || "",
    s.rosterStatus || "",
    s.honors,
    s.fsp,
    s.household,
    s.institute,
    s.marines,
    s.appDecision,
    s.degree,
    amuAlumniCell(s, alumniIds),
    s.email,
    s.citizenship,
    s.visa,
    s.dob || "",
    s.hsGpa ?? "",
    s.act ?? "",
    s.sat ?? "",
    s.clt ?? "",
  ];
}

export const UNRETAINED_HEADERS = [
  "PCID",
  "First",
  "Last",
  "Retention",
  "Final GPA",
  "FSP",
  "Household",
  "Mary's Marines",
  "Honors",
  "Institute",
  "Sport",
  "Religion",
  "Catholic/Non-Catholic",
  "State",
  "Gender",
  "Class",
  "College_Attend",
  "Incoming/Returning",
  "Program",
  "FA25 Credits",
  "Cumulative Earned Credits",
  "HS GPA",
  "ACT",
  "SAT",
  "CLT",
  "Declared application major",
  "Interview Faith",
  "Interview Courage",
  "Interview Desire",
  "Interview HS Involvement",
  "Interview College/Career",
  "Interview Plans at AMU",
  "Interview Total",
  "AC Comments",
  "Miles from campus",
  "Sector",
  "Athletic Aid",
  "Unfunded aid",
  "School type (Ave Type)",
  "High School Name",
  "Reason for leaving",
  "Withdrawal improvement",
  "Withdrawal comments",
] as const;

export const UNRETAINED_WIDTHS = [
  14, 16, 18, 14, 12, 10, 12, 16, 10, 16, 18, 16, 20, 8, 10, 12, 14, 16, 12, 12, 16, 10, 8, 8, 8, 22, 10, 10, 10, 12, 12,
  12, 10, 16, 12, 16, 14, 16, 16, 22, 18, 22, 28,
];

export function unretainedRow(s: UnretainedStudent): ListCell[] {
  const incoming = (s.incomingReturning || "").trim().toLowerCase().startsWith("incoming");
  return [
    s.pcid,
    s.first,
    s.last,
    s.retention,
    s.gpa,
    s.fsp,
    s.household,
    s.marines,
    s.honors,
    s.institute || "",
    s.sport,
    s.religion || "",
    incoming ? catholicOf({ cathGroup: s.cathGroup, religion: s.religion }) : "",
    s.state,
    s.gender,
    s.classLevel,
    s.collegeAttend,
    s.incomingReturning,
    s.program || "",
    s.credits ?? "",
    s.earnedCredits ?? "",
    s.hsGpa ?? "",
    s.act ?? "",
    s.sat ?? "",
    s.clt ?? "",
    s.applicationMajor || s.curriculumName || "",
    s.interviewFaith ?? "",
    s.interviewCourage ?? "",
    s.interviewDesire ?? "",
    s.interviewHsInvolvement ?? "",
    s.interviewCollegeCareer ?? "",
    s.interviewPlans ?? "",
    s.interviewTotal ?? "",
    s.acComments || "",
    s.milesFromCampus ?? "",
    s.sector || "",
    s.athleticAid ?? "",
    s.unfundedAid ?? "",
    s.schoolType || "",
    s.highSchoolName || "",
    s.reasonForLeaving || "",
    s.withdrawalImprovement || "",
    s.withdrawalComments || "",
  ];
}

export const LOA_HEADERS = [
  "PCID",
  "First",
  "Last",
  "Term",
  "FA26 status",
  "Sport",
  "Class",
  "Incoming/Returning",
  "College Attend",
  "Curriculum",
  "GPA",
  "Final GPA",
  "Household",
  "FSP",
  "State",
  "Gender",
] as const;

export const LOA_LIVE_EXTRA_HEADERS = ["FA26 class", "FA26 sport", "FA26 curriculum", "FA26 residency"] as const;

export const LOA_WIDTHS = [14, 14, 18, 14, 16, 16, 14, 16, 12, 18, 10, 10, 16, 8, 8, 10];

export function loaRow(s: LoaWithStatus): ListCell[] {
  return [
    s.pcid,
    s.first,
    s.last,
    s.term,
    s.status,
    s.sport,
    s.classLevel,
    s.incomingReturning,
    s.collegeAttend,
    s.curriculum,
    s.gpa,
    s.finalGpa,
    s.household,
    s.fsp,
    s.state,
    s.gender,
  ];
}

export function loaLiveRow(s: LoaWithStatus): ListCell[] {
  return [...loaRow(s), s.fa26Class || "", s.fa26Sport || "", s.fa26Curriculum || "", s.fa26Residency || ""];
}

export const FTCA_RAW_HEADERS = [
  "First",
  "Last",
  "Retained F25?",
  "PCID",
  "FTCA",
  "Religious Affiliation",
  "Catholic, Christian, Other",
  "Catholic Non-Catholic",
  "Application Decision",
  "Fall 25 Athletic Association",
  "Fall 25 Curriculum",
  "Fall 25 FULL PART TIME",
  "Fall 25 Credits",
  "Fall 25 GPA",
  "Fall 25 Res Comm",
  "Fall 26 Athletic Association",
  "Fall 26 Curriculum",
  "Fall 26 Class",
  "Fall 26 FULL PART TIME",
  "Fall 26 Credits",
  "Fall 26 GPA",
  "Fall 26 Res Comm",
  "DOB",
  "Gender",
  "Ethnicity",
  "HS GPA",
  "City",
  "State",
  "Institute",
  "Interview Faith",
  "Interview Courage",
  "Interview Desire",
  "Interview HS Involvement",
  "Interview College/Career",
  "Interview Plans at AMU",
  "Interview Total",
  "PCID",
] as const;

export const FTCA_RAW_WIDTHS = [
  14, 16, 14, 14, 10, 18, 18, 16, 16, 22, 16, 14, 12, 12, 14, 22, 16, 12, 14, 12, 12, 14, 14, 10, 12, 10, 14, 8, 14, 14, 8,
  8, 8, 10, 10, 10, 8,
];

export function ftcaRawRow(r: FtcaRawRow): ListCell[] {
  return [
    r.first,
    r.last,
    r.retained,
    r.pcid,
    r.ftca,
    r.religion,
    r.cathGroup,
    r.catholicNonCatholic,
    r.appDecision,
    r.fa25Sport,
    r.fa25Curriculum,
    r.fa25FullPart,
    r.fa25Credits,
    r.fa25Gpa,
    r.fa25Residency,
    r.fa26Sport,
    r.fa26Curriculum,
    r.fa26Class,
    r.fa26FullPart,
    r.fa26Credits,
    r.fa26Gpa,
    r.fa26Residency,
    r.dob,
    r.gender,
    r.ethnicity,
    r.hsGpa,
    r.city,
    r.state,
    r.institute,
    r.interviewFaith ?? "",
    r.interviewCourage ?? "",
    r.interviewDesire ?? "",
    r.interviewHsInvolvement ?? "",
    r.interviewCollegeCareer ?? "",
    r.interviewPlans ?? "",
    r.interviewTotal ?? "",
    r.pcid,
  ];
}
