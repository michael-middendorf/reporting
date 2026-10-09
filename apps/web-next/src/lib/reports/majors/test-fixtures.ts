/** Synthetic PowerCampus rows for the DST-3015 Majors and Minors tests. No real people. */
import type { MajorsSources, SourceRow } from "./shape";

function codeRow(key: string, longDesc: string | null, extra: SourceRow = {}): SourceRow {
  return {
    CODE_VALUE_KEY: key,
    CODE_VALUE: key,
    SHORT_DESC: key,
    MEDIUM_DESC: longDesc ? `${longDesc} (M)` : null,
    LONG_DESC: longDesc,
    STATUS: "A",
    ...extra,
  };
}

let seq = 0;
function pcid(n: number): string {
  return `P${String(n).padStart(9, "0")}`;
}

/** An ACADEMIC row with every published column present (null unless set). */
export function acad(person: number, fields: SourceRow): SourceRow {
  seq += 1;
  return {
    PEOPLE_CODE: "P",
    PEOPLE_ID: String(person).padStart(9, "0"),
    PEOPLE_CODE_ID: pcid(person),
    ACADEMIC_YEAR: "2026",
    ACADEMIC_TERM: "FALL",
    ACADEMIC_SESSION: "01",
    PROGRAM: "UNDERG",
    DEGREE: null,
    CURRICULUM: null,
    CLASS_LEVEL: null,
    ENROLL_SEPARATION: null,
    PRIMARY_FLAG: "N",
    APPLICATION_FLAG: "N",
    APP_DECISION: null,
    COLLEGE_ATTEND: null,
    STATUS: null,
    APP_STATUS: null,
    ORG_CODE_ID: null,
    TRANSCRIPT_SEQ: String(seq),
    ...fields,
  };
}

const ORG = "O000000113";

/** Incoming applicant row for Fall `year` (STATUS null keeps it out of the Current pool). */
function app(person: number, year: string, fields: SourceRow): SourceRow {
  return acad(person, {
    ACADEMIC_YEAR: year,
    APPLICATION_FLAG: "Y",
    ORG_CODE_ID: ORG,
    ...fields,
  });
}

export function incomingRows(): SourceRow[] {
  return [
    // Fall 2027 (report year)
    app(1, "2027", { CURRICULUM: "MECH", DEGREE: "BSCIEN", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ACCP", APP_STATUS: "DEP" }),
    app(2, "2027", { CURRICULUM: "MECH", DEGREE: "BARTS", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ACCP" }),
    app(3, "2027", { CURRICULUM: "THEO", DEGREE: "BARTS", COLLEGE_ATTEND: "TRAN", APP_DECISION: "ACCP", APP_STATUS: "DEP" }),
    app(4, "2027", { CURRICULUM: "THEO", DEGREE: "BARTS", COLLEGE_ATTEND: "SECB", APP_DECISION: "COND", APP_STATUS: "DEP" }),
    // Withdrawn deposit: an accept, never an active deposit.
    app(5, "2027", { CURRICULUM: "THEO", DEGREE: "BARTS", COLLEGE_ATTEND: "FTCA", APP_DECISION: "WDEP", APP_STATUS: "DEP" }),
    // Another admissions office: excluded by ORG_CODE_ID.
    app(6, "2027", { CURRICULUM: "BIOL", DEGREE: "BSCIEN", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ACCP", APP_STATUS: "DEP", ORG_CODE_ID: "O000000200" }),
    // NONDEG excluded by the report query.
    app(7, "2027", { CURRICULUM: "BIOL", DEGREE: "NONDEG", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ACCP" }),
    // Denied.
    app(8, "2027", { CURRICULUM: "BIOL", DEGREE: "BSCIEN", COLLEGE_ATTEND: "FTCA", APP_DECISION: "DENY" }),
    // Applied BIOL, but the primary row for the same term says MECH: counted as MECH.
    app(9, "2027", { CURRICULUM: "BIOL", DEGREE: "BSCIEN", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ACCP", APP_STATUS: "DEP" }),
    acad(9, { ACADEMIC_YEAR: "2027", CURRICULUM: "MECH", DEGREE: "BSCIEN", PRIMARY_FLAG: "Y" }),
    // Two primary rows (plus one whose curriculum is not in CODE_CURRICULUM): the view
    // emits one row per known primary curriculum, each keeping the application's
    // DEGREE (BARTS), COLLEGE_ATTEND (TRAN), APP_STATUS and APP_DECISION.
    app(16, "2027", { CURRICULUM: "THEO", DEGREE: "BARTS", COLLEGE_ATTEND: "TRAN", APP_DECISION: "ACCP", APP_STATUS: "DEP" }),
    acad(16, { ACADEMIC_YEAR: "2027", CURRICULUM: "BIOL", DEGREE: "NONDEG", PRIMARY_FLAG: "Y" }),
    acad(16, { ACADEMIC_YEAR: "2027", CURRICULUM: "MUSIC", DEGREE: "BARTS", PRIMARY_FLAG: "Y" }),
    acad(16, { ACADEMIC_YEAR: "2027", CURRICULUM: "ZZZZ", DEGREE: "BARTS", PRIMARY_FLAG: "Y" }),
    // Readmit: not FTCA/TRAN/SECB.
    app(10, "2027", { CURRICULUM: "THEO", DEGREE: "BARTS", COLLEGE_ATTEND: "RADM", APP_DECISION: "ACCP", APP_STATUS: "DEP" }),
    // Padded values still match.
    app(12, "2027", { CURRICULUM: "THEO  ", DEGREE: " BARTS", COLLEGE_ATTEND: "FTCA ", APP_DECISION: "ACCP ", APP_STATUS: "DEP ", ORG_CODE_ID: "O000000113 " }),
    // Decision code not in CODE_APPDECISION (inner join drops it).
    app(13, "2027", { CURRICULUM: "THEO", DEGREE: "BARTS", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ZZZZ", APP_STATUS: "DEP" }),
    // Spring application: not FALL.
    app(14, "2027", { ACADEMIC_TERM: "SPRING", CURRICULUM: "THEO", DEGREE: "BARTS", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ACCP" }),
    // Fall 2026 (prior year final)
    app(11, "2026", { CURRICULUM: "MECH", DEGREE: "BSCIEN", COLLEGE_ATTEND: "FTCA", APP_DECISION: "ACCP", APP_STATUS: "DEP" }),
    app(15, "2026", { CURRICULUM: "BIOL", DEGREE: "BSCIEN", COLLEGE_ATTEND: "TRAN", APP_DECISION: "ACCP" }),
  ];
}

const enrolled = (person: number, fields: SourceRow) =>
  acad(person, { STATUS: "A", ENROLL_SEPARATION: "ENRL", ...fields });

export function currentRows(): SourceRow[] {
  return [
    enrolled(101, { CURRICULUM: "MECH", DEGREE: "BSCIEN", PRIMARY_FLAG: "Y", CLASS_LEVEL: "SOPH" }),
    enrolled(102, { CURRICULUM: "THEO", DEGREE: "BARTS", PRIMARY_FLAG: "Y", CLASS_LEVEL: "FRES" }),
    // Minor on a second row.
    enrolled(102, { CURRICULUM: "MUSIC", DEGREE: "MINOR", CLASS_LEVEL: "FRES" }),
    // Undeclared.
    enrolled(103, { CURRICULUM: "UNDECI", DEGREE: "BARTS", PRIMARY_FLAG: "Y", CLASS_LEVEL: "FRES" }),
    // Accepted and deposited incoming student (not yet registered).
    acad(104, { STATUS: "A", CURRICULUM: "THEO", DEGREE: "BARTS", APPLICATION_FLAG: "Y", APP_DECISION: "ACCP", APP_STATUS: "DEP", CLASS_LEVEL: "FRES" }),
    // Accepted but not deposited: excluded.
    acad(114, { STATUS: "A", CURRICULUM: "THEO", DEGREE: "BARTS", APPLICATION_FLAG: "Y", APP_DECISION: "ACCP", CLASS_LEVEL: "FRES" }),
    // Primary row (k=1) beats the application row (k=2) for the same curriculum.
    enrolled(105, { CURRICULUM: "THEO", DEGREE: "BARTS", PRIMARY_FLAG: "Y", CLASS_LEVEL: "JR" }),
    acad(105, { STATUS: "A", CURRICULUM: "THEO", DEGREE: "BARTS", APPLICATION_FLAG: "Y", APP_DECISION: "ACCP", APP_STATUS: "DEP", CLASS_LEVEL: "JR" }),
    // Separated: a WITH row this term removes every row for the person.
    enrolled(106, { CURRICULUM: "BIOL", DEGREE: "BSCIEN", PRIMARY_FLAG: "Y", CLASS_LEVEL: "SR" }),
    acad(106, { PROGRAM: "GRAD", STATUS: "A", ENROLL_SEPARATION: "WITH", CURRICULUM: "BIOL", DEGREE: "BSCIEN" }),
    // RANK tie: two k=null rows for the same person and curriculum both survive.
    enrolled(107, { CURRICULUM: "BIOL", DEGREE: "BSCIEN", CLASS_LEVEL: "SR" }),
    enrolled(107, { CURRICULUM: "BIOL", DEGREE: "BSCIEN", CLASS_LEVEL: "SR" }),
    // NULL sorts first: the k=null row wins over the k=1 row.
    enrolled(108, { CURRICULUM: "BIOL", DEGREE: "BSCIEN", CLASS_LEVEL: "JR" }),
    enrolled(108, { CURRICULUM: "BIOL", DEGREE: "BSCIEN", PRIMARY_FLAG: "Y", CLASS_LEVEL: "JR" }),
    // Inactive.
    enrolled(109, { STATUS: "I", CURRICULUM: "BIOL", DEGREE: "BSCIEN", PRIMARY_FLAG: "Y", CLASS_LEVEL: "SR" }),
    // DEGREE_TYPE null still counts as a major; no CLASS_LEVEL means not in Total.
    enrolled(110, { CURRICULUM: "BIOL", DEGREE: "CERT", PRIMARY_FLAG: "Y" }),
    // DEGREE_TYPE 'O' (non-degree) is not a major.
    enrolled(111, { CURRICULUM: "THEO", DEGREE: "NONDEG", PRIMARY_FLAG: "Y", CLASS_LEVEL: "SR" }),
    // Degree not in CODE_DEGREE.
    enrolled(112, { CURRICULUM: "THEO", DEGREE: "XYZ", PRIMARY_FLAG: "Y", CLASS_LEVEL: "SR" }),
    // Graduate program.
    enrolled(113, { PROGRAM: "GRAD", CURRICULUM: "THEO", DEGREE: "BARTS", PRIMARY_FLAG: "Y", CLASS_LEVEL: "SR" }),
    // Earlier terms for the term list and trends.
    enrolled(101, { ACADEMIC_TERM: "SPRING", CURRICULUM: "MECH", DEGREE: "BSCIEN", PRIMARY_FLAG: "Y", CLASS_LEVEL: "FRES" }),
    enrolled(101, { ACADEMIC_YEAR: "2025", CURRICULUM: "MECH", DEGREE: "BSCIEN", PRIMARY_FLAG: "Y", CLASS_LEVEL: "FRES" }),
    enrolled(120, { ACADEMIC_YEAR: "2021", CURRICULUM: "THEO", DEGREE: "BARTS", PRIMARY_FLAG: "Y", CLASS_LEVEL: "SR" }),
    // A future term in the data (registration open): not the default when the calendar says so.
    enrolled(102, { ACADEMIC_YEAR: "2027", ACADEMIC_TERM: "SPRING", CURRICULUM: "THEO", DEGREE: "BARTS", PRIMARY_FLAG: "Y", CLASS_LEVEL: "FRES" }),
  ];
}

export function codeTables(): Omit<MajorsSources, "academic" | "academicCalendar"> {
  return {
    codeCurriculum: [
      codeRow("MECH", "Mechanical Engineering"),
      codeRow("THEO", "Theology"),
      codeRow("BIOL", "Biology"),
      codeRow("UNDECI", "Undeclared"),
      codeRow("MUSIC", "Music"),
    ],
    codeDegree: [
      codeRow("BSCIEN", "Bachelor of Science", { DEGREE_TYPE: "B" }),
      codeRow("BARTS", "Bachelor of Arts", { DEGREE_TYPE: "B" }),
      codeRow("MINOR", "Minor", { DEGREE_TYPE: "N" }),
      codeRow("NONDEG", "Non-Degree", { DEGREE_TYPE: "O" }),
      codeRow("CERT", "Certificate", { DEGREE_TYPE: null }),
    ],
    codeAppDecision: [
      codeRow("ACCP", "Accepted", { ACCEPTED_DECISION: "Y" }),
      codeRow("COND", "Conditional Accept", { ACCEPTED_DECISION: "Y" }),
      codeRow("DENY", "Denied", { ACCEPTED_DECISION: "N" }),
      codeRow("WDEP", "Withdrawn Deposit", { ACCEPTED_DECISION: "N" }),
    ],
    codeEnrollment: [
      codeRow("ENRL", "Enrolled", { REQUIRE_SEPDATE: "N" }),
      codeRow("GRAD", "Graduated", { REQUIRE_SEPDATE: "N" }),
      codeRow("WITH", "Withdrawn", { REQUIRE_SEPDATE: "Y" }),
    ],
    codeClassLevel: [
      codeRow("FRES", "Freshman"),
      codeRow("SOPH", "Sophomore"),
      codeRow("JR", "Junior"),
      codeRow("SR", "Senior"),
    ],
    codeCollegeAttend: [
      codeRow("FTCA", "First Time College Attend"),
      codeRow("TRAN", "Transfer"),
      codeRow("SECB", "Second Bachelor"),
    ],
  };
}

export function calendarRows(): SourceRow[] {
  const cal = (year: string, term: string, start: string) => ({
    ACADEMIC_YEAR: year,
    ACADEMIC_TERM: term,
    ACADEMIC_SESSION: "01",
    START_DATE: `${start}T00:00:00`,
    END_DATE: null,
  });
  return [
    cal("2021", "FALL", "2021-08-23"),
    cal("2025", "FALL", "2025-08-25"),
    cal("2026", "SPRING", "2026-01-12"),
    cal("2026", "FALL", "2026-08-24"),
    cal("2027", "SPRING", "2027-01-11"),
    cal("2027", "FALL", "2027-08-23"),
  ];
}

export function fixtureSources(): MajorsSources {
  return {
    academic: [...incomingRows(), ...currentRows()],
    ...codeTables(),
    academicCalendar: calendarRows(),
    pulledAt: "2026-10-09T06:10:00Z",
  };
}

export const FIXTURE_NOW = new Date("2026-10-09T14:00:00Z");
