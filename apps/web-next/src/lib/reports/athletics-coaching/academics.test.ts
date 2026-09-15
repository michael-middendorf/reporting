import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessReport } from "../../access";
import {
  aspireduSessionCookie,
  aspireduSessionSetCookieHeaders,
  canUseFerpaTotp,
} from "../../aspiredu-auth";
import { canAccessSport } from "./access";
import {
  academicsMfaUnlocked,
  attendancePulse,
  buildAcademicsSummary,
  coachingLambdaPayload,
  coachingMfaUrl,
  daysBelow,
  firstSeenBelowAB,
  gpaPointsFromPercent,
  isAB,
  isCoachingActionUnavailable,
  letterFromPercent,
  matchedRosterRows,
  mergeOfficeHoursLedger,
  normalizePcid,
  officeHoursDurationLabel,
  officeHoursHistoryFromSnapshots,
  officeHoursLedgerKey,
  officeHoursLedgerObjectKey,
  officeHoursNeedsHistory,
  rosterJoinKeys,
  safeCoachingNext,
  type OfficeHoursGradeSnapshot,
  type OfficeHoursHistoryCourse,
  type OfficeHoursLedger,
  type OfficeHoursRow,
} from "./academics";
import { SPORTS } from "./sports";

const COACH = "coach.a@avemaria.edu";
const OTHER = "annie.esposito@avemaria.edu";
const ERIC = "Eric.Vanheusen@avemaria.edu";
const NOW = new Date("2026-09-03T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("athletics coaching academics access", () => {
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  it("gives a mapped coach athletics-coaching, FERPA TOTP, and no campus AspireDU", () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      assert.equal(canAccessReport(COACH, "athletics-coaching"), true);
      assert.equal(canAccessReport(COACH, "aspiredu"), false);
      assert.equal(canUseFerpaTotp(COACH), true);
      assert.equal(canAccessSport(COACH, "football"), true);
      assert.equal(canAccessSport(COACH, "mens-soccer"), false);
    } finally {
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });

  it("gives leadership every sport, FERPA TOTP, and no campus AspireDU", () => {
    assert.equal(canAccessReport(ERIC, "athletics-coaching"), true);
    assert.equal(canAccessReport(ERIC, "aspiredu"), false);
    assert.equal(canUseFerpaTotp(ERIC), true);
    for (const sport of SPORTS) {
      assert.equal(canAccessSport(ERIC, sport.key), true, sport.key);
    }
  });

  it("does not widen FERPA TOTP to unrelated report users", () => {
    assert.equal(canAccessReport(OTHER, "athletics-coaching"), false);
    assert.equal(canUseFerpaTotp(OTHER), false);
  });
});

describe("FERPA MFA cookie path", () => {
  it("sets Path=/ so /athletics/coaching APIs receive amu_aspiredu_mfa", () => {
    const cookie = aspireduSessionCookie("session-token");
    assert.match(cookie, /amu_aspiredu_mfa=session-token/);
    assert.match(cookie, /Path=\//);
    assert.equal(/Path=\/aspiredu/.test(cookie), false);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    const headers = aspireduSessionSetCookieHeaders("session-token");
    assert.equal(headers.some((value) => /Path=\/aspiredu/.test(value) && /Max-Age=0/.test(value)), true);
  });
});

describe("academics MFA unlock", () => {
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  it("unlocks Academic Affairs without a FERPA cookie, and coaches only with hub MFA or leftover TOTP", () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      assert.equal(
        academicsMfaUnlocked({ email: "michael.t.middendorf@avemaria.edu", hubMfa: false, ferpa: false }),
        true,
      );
      assert.equal(academicsMfaUnlocked({ email: COACH, hubMfa: false, ferpa: false }), false);
      assert.equal(academicsMfaUnlocked({ email: COACH, hubMfa: true, ferpa: false }), true);
      assert.equal(academicsMfaUnlocked({ email: COACH, hubMfa: false, ferpa: true }), true);
      assert.equal(academicsMfaUnlocked({ email: ERIC, hubMfa: false, ferpa: false }), false);
      assert.equal(academicsMfaUnlocked({ email: OTHER, hubMfa: true, ferpa: true }), true);
    } finally {
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });
});

describe("coaching MFA urls", () => {
  it("keeps mfaUrl under /athletics/coaching and rejects open redirects", () => {
    assert.equal(
      coachingMfaUrl("football"),
      "/athletics/coaching/mfa?next=%2Fathletics%2Fcoaching%2Ffootball%2Facademics",
    );
    assert.equal(safeCoachingNext("/athletics/coaching/football"), "/athletics/coaching/football");
    assert.equal(
      safeCoachingNext("/athletics/coaching/football/academics"),
      "/athletics/coaching/football/academics",
    );
    assert.equal(safeCoachingNext("https://evil.example/"), "/athletics/coaching");
    assert.equal(safeCoachingNext("//evil.example"), "/athletics/coaching");
    assert.equal(safeCoachingNext("/aspiredu/mfa"), "/athletics/coaching");
  });
});

describe("roster join keys", () => {
  it("normalizes PCID to P+9", () => {
    assert.equal(normalizePcid("P000000001"), "P000000001");
    assert.equal(normalizePcid("000000002"), "P000000002");
    assert.equal(normalizePcid("3"), "P000000003");
    assert.equal(normalizePcid("not-a-pcid"), null);
  });

  it("sends only emails and PCIDs to Lambda", () => {
    const rows = matchedRosterRows(
      [
        {
          email: "athlete.one@avemaria.edu",
          pcid: "P000000001",
          firstname: "One",
          lastname: "Alpha",
          currentsport: "Football",
        },
        {
          Email: "athlete.two@avemaria.edu",
          PCID: "2",
          FirstName: "Two",
          LastName: "Bravo",
          CurrentSport: "Soccer-Men",
          _2ndsport: "Football",
        },
      ],
      "football",
    );
    const payload = coachingLambdaPayload("Coach.A@avemaria.edu", "football", rows);
    assert.equal(payload.action, "coaching");
    assert.equal(payload.callerEmail, "coach.a@avemaria.edu");
    assert.equal(payload.sport, "football");
    assert.deepEqual(payload.emails, ["athlete.one@avemaria.edu", "athlete.two@avemaria.edu"]);
    assert.deepEqual(payload.pcids, ["P000000001", "P000000002"]);
    assert.equal(JSON.stringify(payload).includes("Alpha"), false);
    assert.equal(JSON.stringify(payload).includes("Bravo"), false);
  });
});

describe("academics join and pulse", () => {
  const rosterRows = [
    {
      personreferenceid: "r1",
      email: "athlete.one@avemaria.edu",
      pcid: "P000000001",
      firstname: "One",
      lastname: "Alpha",
      currentsport: "Football",
    },
    {
      personreferenceid: "r2",
      email: "athlete.two@avemaria.edu",
      pcid: "P000000002",
      firstname: "Two",
      lastname: "Bravo",
      currentsport: "Tennis",
      _2ndsport: "Football",
    },
    {
      personreferenceid: "r3",
      email: "athlete.three@avemaria.edu",
      pcid: "P000000003",
      firstname: "Three",
      lastname: "Unmatched",
      currentsport: "Football",
    },
    {
      personreferenceid: "r4",
      email: "athlete.soccer@avemaria.edu",
      pcid: "P000000004",
      firstname: "Four",
      lastname: "Soccer",
      currentsport: "Soccer-Men",
    },
  ];

  it("joins email first, then P######### , badges unmatched, and omits AspireDU-only rows", () => {
    const summary = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      now: NOW,
      lambdaResult: {
        asOf: "2026-09-03T11:00:00Z",
        students: [
          {
            email: "athlete.one@avemaria.edu",
            studentSisId: "P000000099",
            riskBand: "4",
            lastAttended: daysAgo(20),
            attendance: { latest: "present", present: 8, absent: 0, late: 0 },
            courses: [{ course: "BIO 101", courseGrade: 91, missingAssignments: 0, courseLastAccess: daysAgo(1) }],
          },
          {
            email: "other.mailbox@avemaria.edu",
            studentSisId: "P000000002",
            risk: 2,
            latestAttendance: daysAgo(3),
            courses: [{ course: "ENG 201", grade: 88, missing: 1, lastAccess: daysAgo(2) }],
          },
          {
            email: "ghost.only@avemaria.edu",
            studentSisId: "P000000888",
            riskBand: "9",
            lastAttended: daysAgo(1),
          },
        ],
      },
    });
    assert.equal(summary.rosterAvailable, true);
    assert.equal(summary.rosterCount, 3);
    assert.equal(summary.matchedCount, 2);
    assert.equal(summary.matchRate, 2 / 3);
    assert.equal(summary.asOf, "2026-09-03T11:00:00Z");
    assert.deepEqual(
      summary.athletes.map((athlete) => athlete.name),
      ["One Alpha", "Two Bravo", "Three Unmatched"],
    );
    assert.equal(summary.athletes[0].matched, true);
    assert.equal(summary.athletes[0].risk, "4");
    assert.equal(summary.athletes[0].pulse?.source, "session");
    assert.equal(summary.athletes[0].pulse?.band, "attending");
    assert.equal(summary.athletes[1].matched, true);
    assert.equal(summary.athletes[1].pcid, "P000000002");
    assert.equal(summary.athletes[2].matched, false);
    assert.equal(summary.athletes[2].risk, null);
    assert.equal(summary.athletes.some((athlete) => athlete.email === "ghost.only@avemaria.edu"), false);
    const keys = rosterJoinKeys(matchedRosterRows(rosterRows, "football"));
    assert.equal(keys.emails.includes("ghost.only@avemaria.edu"), false);
  });

  it("puts a dual-sport athlete on both team lists", () => {
    const football = matchedRosterRows(rosterRows, "football").map((row) => row.email);
    const tennis = matchedRosterRows(rosterRows, "tennis").map((row) => row.email);
    assert.equal(football.includes("athlete.two@avemaria.edu"), true);
    assert.equal(tennis.includes("athlete.two@avemaria.edu"), true);
    assert.equal(football.includes("athlete.soccer@avemaria.edu"), false);
  });

  it("does not invent athletes when the roster feed is missing", () => {
    const summary = buildAcademicsSummary({
      sport: "football",
      rosterRows: null,
      lambdaResult: { students: [{ email: "athlete.one@avemaria.edu", riskBand: "1" }] },
    });
    assert.equal(summary.rosterAvailable, false);
    assert.deepEqual(summary.athletes, []);
    assert.equal(summary.matchRate, null);
  });

  it("lets session present/absent/late win over last-attended bands", () => {
    const stale = daysAgo(20);
    assert.deepEqual(
      attendancePulse({ latestSession: "present", lastAttended: stale, now: NOW }),
      {
        band: "attending",
        source: "session",
        lastAttended: stale,
        present: null,
        absent: null,
        late: null,
        sessionCount: null,
      },
    );
    assert.equal(attendancePulse({ latestSession: "late", lastAttended: daysAgo(1), now: NOW })?.band, "watch");
    assert.equal(attendancePulse({ latestSession: "absent", lastAttended: daysAgo(1), now: NOW })?.band, "inactive");
    assert.equal(
      attendancePulse({ present: 6, absent: 0, late: 0, lastAttended: stale, now: NOW })?.source,
      "session",
    );
    assert.equal(attendancePulse({ present: 0, absent: 4, late: 0, now: NOW })?.band, "inactive");
    const pulse = attendancePulse({ present: 1, absent: 0, late: 3, now: NOW });
    assert.equal(pulse?.band, "watch");
    assert.equal(JSON.stringify(pulse).toLowerCase().includes("percent"), false);
    assert.equal(JSON.stringify(pulse).includes("%"), false);
  });

  it("falls back to last-attended date bands and never labels a percentage", () => {
    assert.equal(attendancePulse({ lastAttended: daysAgo(0), now: NOW })?.band, "attending");
    assert.equal(attendancePulse({ lastAttended: daysAgo(7), now: NOW })?.band, "attending");
    assert.equal(attendancePulse({ lastAttended: daysAgo(8), now: NOW })?.band, "watch");
    assert.equal(attendancePulse({ lastAttended: daysAgo(14), now: NOW })?.band, "watch");
    assert.equal(attendancePulse({ lastAttended: daysAgo(15), now: NOW })?.band, "inactive");
    const pulse = attendancePulse({ lastAttended: daysAgo(10), now: NOW });
    assert.equal(pulse?.source, "last-attended");
    assert.equal(JSON.stringify(pulse).toLowerCase().includes("attendance %"), false);
  });
});

describe("letter grades and GPA points", () => {
  it("maps percent cutoffs, treats null as None, and marks A/B letters", () => {
    assert.equal(letterFromPercent(null), "None");
    assert.equal(letterFromPercent(97), "A+");
    assert.equal(letterFromPercent(93), "A");
    assert.equal(letterFromPercent(90), "A-");
    assert.equal(letterFromPercent(87), "B+");
    assert.equal(letterFromPercent(83), "B");
    assert.equal(letterFromPercent(80), "B-");
    assert.equal(letterFromPercent(79.9), "C+");
    assert.equal(letterFromPercent(59), "F");
    assert.equal(gpaPointsFromPercent(97), 4.0);
    assert.equal(gpaPointsFromPercent(93), 4.0);
    assert.equal(gpaPointsFromPercent(90), 3.7);
    assert.equal(gpaPointsFromPercent(83), 3.0);
    assert.equal(gpaPointsFromPercent(74), 2.0);
    assert.equal(gpaPointsFromPercent(59), 0);
    assert.equal(isAB("A-"), true);
    assert.equal(isAB("B"), true);
    assert.equal(isAB("C+"), false);
    assert.equal(isAB("None"), false);
  });
});

describe("live coaching snapshot KPIs", () => {
  const rosterRows = [
    {
      personreferenceid: "r1",
      email: "athlete.one@avemaria.edu",
      pcid: "P000000001",
      firstname: "One",
      lastname: "Alpha",
      currentsport: "Football",
    },
    {
      personreferenceid: "r2",
      email: "athlete.two@avemaria.edu",
      pcid: "P000000002",
      firstname: "Two",
      lastname: "Bravo",
      currentsport: "Football",
    },
    {
      personreferenceid: "r3",
      email: "athlete.three@avemaria.edu",
      pcid: "P000000003",
      firstname: "Three",
      lastname: "Unmatched",
      currentsport: "Football",
    },
  ];

  it("maps overallRisk and pulse, and computes team GPA and office hours", () => {
    const lastClass = daysAgo(2);
    const summary = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      now: NOW,
      lambdaResult: {
        asOf: "2026-09-03T11:00:00Z",
        students: [
          {
            email: "athlete.one@avemaria.edu",
            studentSisId: "P000000001",
            overallRisk: 4,
            pulse: {
              present: 8,
              absent: 2,
              late: 0,
              other: 0,
              sessionCount: 10,
              latestClassDate: lastClass,
            },
            courses: [
              {
                course: "BIO 101",
                courseGrade: 93,
                missingAssignments: 0,
                courseLastAccess: daysAgo(1),
                timesPresent: 8,
                timesAbsent: 2,
                percentageAttendance: 80,
              },
              {
                course: "THE 105",
                courseGrade: 73,
                missingAssignments: 3,
                timesPresent: 6,
                timesAbsent: 1,
              },
              {
                course: "LAT 101",
                courseGrade: null,
                missingAssignments: 0,
              },
            ],
          },
          {
            email: "athlete.two@avemaria.edu",
            studentSisId: "P000000002",
            overallRisk: 1,
            pulse: { present: 9, absent: 0, late: 0, sessionCount: 9, latestClassDate: daysAgo(1) },
            courses: [
              {
                course: "ENG 201",
                courseGrade: 83,
                missingAssignments: 0,
                timesPresent: 9,
                timesAbsent: 0,
              },
            ],
          },
        ],
      },
    });

    assert.equal(summary.athletes[0].risk, "4");
    assert.equal(summary.athletes[0].pulse?.absent, 2);
    assert.equal(summary.athletes[0].pulse?.present, 8);
    assert.equal(summary.athletes[0].pulse?.sessionCount, 10);
    assert.equal(summary.athletes[0].lastAttended, lastClass);
    assert.equal(summary.athletes[0].courses[0].timesAbsent, 2);

    // One: (A 4.0 + C 2.0) / 2 = 3.0. Two: B 3.0. Team = 3.00.
    assert.equal(summary.teamGpa, 3);
    // One mean percent (93+73)/2 = 83. Two 83. Team = 83.0.
    assert.equal(summary.teamAvgPercent, 83);

    const officeCourses = summary.officeHours.map((row) => `${row.name}|${row.course}|${row.letter}`);
    assert.equal(officeCourses.includes("One Alpha|THE 105|C"), true);
    assert.equal(officeCourses.includes("One Alpha|LAT 101|None"), false);
    assert.equal(officeCourses.some((row) => row.includes("BIO 101")), false);
    assert.equal(officeCourses.some((row) => row.includes("ENG 201")), false);
    assert.equal(summary.officeHours.length, 1);

    assert.equal(summary.peopleMissingClass, 1);
    assert.equal(summary.classesWithAbsences, 2);
    assert.equal(summary.totalAbsenceSessions, 2);
    assert.equal(summary.missingClass[0].name, "One Alpha");
    assert.equal(summary.missingClass[0].sessionAbsences, 2);
  });

  it("counts people missing class from course absences when pulse.absent is missing", () => {
    const summary = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      now: NOW,
      lambdaResult: {
        students: [
          {
            email: "athlete.one@avemaria.edu",
            studentSisId: "P000000001",
            riskBand: "2",
            attendance: { present: 5, late: 0, latest: "present" },
            courses: [{ course: "HIS 201", courseGrade: 88, timesAbsent: 3, timesPresent: 5 }],
          },
          {
            email: "athlete.two@avemaria.edu",
            studentSisId: "P000000002",
            riskBand: "1",
            attendance: { present: 6, absent: 0, late: 0, latest: "present" },
            courses: [{ course: "ENG 201", courseGrade: 90, timesAbsent: 0, timesPresent: 6 }],
          },
        ],
      },
    });
    assert.equal(summary.peopleMissingClass, 1);
    assert.equal(summary.classesWithAbsences, 1);
    assert.equal(summary.missingClass[0].sessionAbsences, 3);
    assert.equal(summary.missingClass[0].coursesWithAbsences[0].course, "HIS 201");
    assert.equal(summary.missingClass[0].coursesWithAbsences[0].timesAbsent, 3);
    assert.equal(summary.officeHours.length, 0);
  });

  it("keeps pulse absences in missing class when courses have no timesAbsent", () => {
    const summary = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      now: NOW,
      lambdaResult: {
        students: [
          {
            email: "athlete.one@avemaria.edu",
            studentSisId: "P000000001",
            pulse: { present: 8, absent: 2, late: 0, sessionCount: 10, latestClassDate: daysAgo(2) },
            courses: [{ course: "BIO 101", courseGrade: 93 }],
          },
        ],
      },
    });
    assert.equal(summary.peopleMissingClass, 1);
    assert.equal(summary.classesWithAbsences, 0);
    assert.equal(summary.missingClass[0].sessionAbsences, 2);
    assert.equal(summary.missingClass[0].coursesWithAbsences.length, 0);
    assert.equal(summary.athletes[0].courses[0].timesAbsent, null);
  });

  it("treats latestAbsenceDate without timesAbsent as one course absence", () => {
    const summary = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      now: NOW,
      lambdaResult: {
        students: [
          {
            email: "athlete.one@avemaria.edu",
            studentSisId: "P000000001",
            pulse: { present: 8, absent: 1, late: 0, sessionCount: 9, latestClassDate: daysAgo(2) },
            courses: [
              { course: "BIO 101", courseGrade: 93, latestAbsenceDate: daysAgo(2) },
              { course: "ENG 201", courseGrade: 88, timesAbsent: 0, latestAbsenceDate: daysAgo(5) },
            ],
          },
        ],
      },
    });
    assert.equal(summary.athletes[0].courses[0].timesAbsent, 1);
    assert.equal(summary.athletes[0].courses[1].timesAbsent, 0);
    assert.equal(summary.peopleMissingClass, 0);
    assert.equal(summary.classesWithAbsences, 1);
    assert.equal(summary.missingClass.length, 0);
    assert.equal(summary.totalAbsenceSessions, 1);
  });

  it("omits athletes with a single session absence from missing class", () => {
    const summary = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      now: NOW,
      lambdaResult: {
        students: [
          {
            email: "athlete.one@avemaria.edu",
            studentSisId: "P000000001",
            pulse: { present: 8, absent: 1, late: 0, sessionCount: 9, latestClassDate: daysAgo(2) },
            courses: [{ course: "BIO 101", courseGrade: 93, timesAbsent: 1, timesPresent: 8 }],
          },
          {
            email: "athlete.two@avemaria.edu",
            studentSisId: "P000000002",
            pulse: { present: 7, absent: 2, late: 0, sessionCount: 9, latestClassDate: daysAgo(1) },
            courses: [{ course: "ENG 201", courseGrade: 88, timesAbsent: 2, timesPresent: 7 }],
          },
        ],
      },
    });
    assert.equal(summary.peopleMissingClass, 1);
    assert.equal(summary.missingClass.length, 1);
    assert.equal(summary.missingClass[0].name, "Two Bravo");
    assert.equal(summary.missingClass[0].sessionAbsences, 2);
    assert.equal(summary.totalAbsenceSessions, 3);
  });
});

describe("coaching Lambda unavailable", () => {
  it("treats 501 and unknown action as a 503-able miss, not a 500", () => {
    assert.equal(isCoachingActionUnavailable({ status: 501, error: "unknown action" }), true);
    assert.equal(isCoachingActionUnavailable({ statusCode: 501 }), true);
    assert.equal(isCoachingActionUnavailable(new Error("Processor error: unsupported action")), true);
    assert.equal(isCoachingActionUnavailable(new Error('Processor error: {"errorMessage":"unknown action"}')), true);
    assert.equal(isCoachingActionUnavailable({ ok: true, students: [] }), false);
  });
});

describe("office hours below-A/B ledger", () => {
  function officeRow(course: string, letter: string, grade: number): OfficeHoursRow {
    return {
      name: "One Alpha",
      email: "athlete.one@avemaria.edu",
      pcid: "P000000001",
      course,
      grade,
      letter,
      missing: null,
      firstSeen: null,
      daysBelow: null,
      source: null,
      lowerBound: null,
    };
  }

  function historyCourse(
    grade: number,
    extra?: Partial<OfficeHoursHistoryCourse>,
  ): OfficeHoursHistoryCourse {
    return {
      email: "athlete.one@avemaria.edu",
      studentSisId: "P000000001",
      course: "BIO 101",
      courseGrade: grade,
      ...extra,
    };
  }

  function snap(asOf: string, grade: number, extra?: Partial<OfficeHoursHistoryCourse>): OfficeHoursGradeSnapshot {
    return { asOf, courses: [historyCourse(grade, extra)] };
  }

  const rosterRows = [
    {
      personreferenceid: "r1",
      email: "athlete.one@avemaria.edu",
      pcid: "P000000001",
      firstname: "One",
      lastname: "Alpha",
      currentsport: "Football",
    },
  ];

  it("keys by email when present, otherwise PCID, and writes a per-sport S3 object", () => {
    assert.equal(
      officeHoursLedgerKey("Athlete.One@avemaria.edu", "P000000001", "BIO 101"),
      "athlete.one@avemaria.edu|BIO 101",
    );
    assert.equal(officeHoursLedgerKey("", "P000000001", "BIO 101"), "P000000001|BIO 101");
    assert.equal(
      officeHoursLedgerObjectKey("ultimate-frisbee"),
      "athletics-coaching-academics/office-hours-below-ab/ultimate-frisbee.json",
    );
  });

  it("counts whole days below, never negative", () => {
    assert.equal(daysBelow("2026-09-01T12:00:00Z", "2026-09-01T12:00:00Z"), 0);
    assert.equal(daysBelow("2026-09-01T12:00:00Z", "2026-09-02T11:59:59Z"), 0);
    assert.equal(daysBelow("2026-09-01T12:00:00Z", "2026-09-02T12:00:00Z"), 1);
    assert.equal(daysBelow("2026-09-01T12:00:00Z", "2026-09-13T12:00:00Z"), 12);
    assert.equal(daysBelow("2026-09-13T12:00:00Z", "2026-09-01T12:00:00Z"), 0);
    assert.equal(daysBelow("not-a-date", "2026-09-01T12:00:00Z"), 0);
  });

  it("first snapshot without history: firstSeen is asOf and source is unknown", () => {
    const asOf = "2026-09-01T12:00:00Z";
    const next = mergeOfficeHoursLedger(null, [officeRow("BIO 101", "C", 74)], asOf);
    const key = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "BIO 101");
    assert.equal(next.updatedAt, asOf);
    assert.equal(next.entries[key].firstSeen, asOf);
    assert.equal(next.entries[key].letter, "C");
    assert.equal(next.entries[key].grade, 74);
    assert.equal(next.entries[key].source, "unknown");
    assert.equal(next.entries[key].lowerBound, undefined);
    assert.equal(daysBelow(next.entries[key].firstSeen, asOf), 0);
  });

  it("unknown without backfill restamps firstSeen to asOf", () => {
    const first = "2026-09-01T12:00:00Z";
    const later = "2026-09-13T12:00:00Z";
    const prev = mergeOfficeHoursLedger(null, [officeRow("BIO 101", "C", 74)], first);
    const next = mergeOfficeHoursLedger(prev, [officeRow("BIO 101", "D", 64)], later);
    const key = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "BIO 101");
    assert.equal(next.entries[key].firstSeen, later);
    assert.equal(next.entries[key].source, "unknown");
    assert.equal(next.entries[key].letter, "D");
    assert.equal(next.entries[key].grade, 64);
  });

  it("does not overwrite source=history firstSeen with today", () => {
    const first = "2026-06-01T12:00:00Z";
    const later = "2026-09-13T12:00:00Z";
    const key = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "BIO 101");
    const prev = {
      updatedAt: first,
      entries: {
        [key]: { firstSeen: first, letter: "C", grade: 74, source: "history" as const, lowerBound: true },
      },
    };
    const next = mergeOfficeHoursLedger(prev, [officeRow("BIO 101", "D", 64)], later, {
      [key]: { firstSeen: later, lowerBound: false },
    });
    assert.equal(next.entries[key].firstSeen, first);
    assert.equal(next.entries[key].source, "history");
    assert.equal(next.entries[key].lowerBound, true);
    assert.equal(next.entries[key].letter, "D");
    assert.equal(daysBelow(next.entries[key].firstSeen, later), 104);
  });

  it("overwrites missing source and unknown with backfill", () => {
    const stamped = "2026-09-13T12:00:00Z";
    const history = "2026-06-20T08:00:00Z";
    const key = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "BIO 101");
    const missingSource = {
      updatedAt: stamped,
      entries: { [key]: { firstSeen: stamped, letter: "C", grade: 74 } },
    };
    const fromMissing = mergeOfficeHoursLedger(
      missingSource as unknown as OfficeHoursLedger,
      [officeRow("BIO 101", "C", 74)],
      stamped,
      { [key]: { firstSeen: history, lowerBound: true } },
    );
    assert.equal(fromMissing.entries[key].firstSeen, history);
    assert.equal(fromMissing.entries[key].source, "history");
    assert.equal(fromMissing.entries[key].lowerBound, true);

    const unknown = mergeOfficeHoursLedger(null, [officeRow("BIO 101", "C", 74)], stamped);
    const fromUnknown = mergeOfficeHoursLedger(unknown, [officeRow("BIO 101", "C", 74)], stamped, {
      [key]: { firstSeen: history, lowerBound: false },
    });
    assert.equal(fromUnknown.entries[key].firstSeen, history);
    assert.equal(fromUnknown.entries[key].source, "history");
    assert.equal(fromUnknown.entries[key].lowerBound, undefined);
  });

  it("drops a recovered A/B course from the ledger", () => {
    const asOf = "2026-09-13T12:00:00Z";
    const prev = mergeOfficeHoursLedger(null, [officeRow("BIO 101", "C", 74)], "2026-09-01T12:00:00Z");
    const next = mergeOfficeHoursLedger(prev, [], asOf);
    assert.deepEqual(next.entries, {});
    assert.equal(next.updatedAt, asOf);
  });

  it("gives a newly below-A/B course its own firstSeen", () => {
    const first = "2026-09-01T12:00:00Z";
    const later = "2026-09-13T12:00:00Z";
    const bio = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "BIO 101");
    const theology = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "THE 105");
    const prev = mergeOfficeHoursLedger(null, [officeRow("BIO 101", "C", 74)], first, {
      [bio]: { firstSeen: first, lowerBound: false },
    });
    const next = mergeOfficeHoursLedger(
      prev,
      [officeRow("BIO 101", "C", 74), officeRow("THE 105", "D", 64)],
      later,
    );
    assert.equal(next.entries[bio].firstSeen, first);
    assert.equal(next.entries[bio].source, "history");
    assert.equal(next.entries[theology].firstSeen, later);
    assert.equal(next.entries[theology].source, "unknown");
    assert.equal(daysBelow(next.entries[theology].firstSeen, later), 0);
  });

  it("fills OfficeHoursRow duration from a ledger and leaves it null without one", () => {
    const firstSeen = "2026-09-01T12:00:00Z";
    const asOf = "2026-09-13T12:00:00Z";
    const lambdaFor = (when: string) => ({
      asOf: when,
      students: [
        {
          email: "athlete.one@avemaria.edu",
          studentSisId: "P000000001",
          courses: [{ course: "THE 105", courseGrade: 73 }],
        },
      ],
    });

    const without = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      lambdaResult: lambdaFor(asOf),
      now: NOW,
    });
    assert.equal(without.officeHours.length, 1);
    assert.equal(without.officeHours[0].firstSeen, null);
    assert.equal(without.officeHours[0].daysBelow, null);
    assert.equal(without.officeHours[0].source, null);
    assert.equal(without.officeHours[0].lowerBound, null);

    const emptyLedger = { updatedAt: "", entries: {} };
    const firstPass = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      lambdaResult: lambdaFor(firstSeen),
      now: NOW,
      officeHoursLedger: emptyLedger,
    });
    assert.equal(firstPass.officeHours[0].firstSeen, firstSeen);
    assert.equal(firstPass.officeHours[0].daysBelow, 0);
    assert.equal(firstPass.officeHours[0].source, "unknown");

    const historyLedger = mergeOfficeHoursLedger(emptyLedger, firstPass.officeHours, firstSeen, {
      [officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "THE 105")]: {
        firstSeen,
        lowerBound: false,
      },
    });
    const second = buildAcademicsSummary({
      sport: "football",
      rosterRows,
      lambdaResult: lambdaFor(asOf),
      now: NOW,
      officeHoursLedger: historyLedger,
    });
    assert.equal(second.officeHours[0].firstSeen, firstSeen);
    assert.equal(second.officeHours[0].daysBelow, 12);
    assert.equal(second.officeHours[0].source, "history");
    assert.equal(second.officeHours[0].lowerBound, false);
  });

  it("walks fake snapshots for firstSeen of the current stretch below 80", () => {
    const oldest = "2026-06-01T12:00:00Z";
    const mid = "2026-07-15T12:00:00Z";
    const latest = "2026-09-01T12:00:00Z";
    const target = { email: "athlete.one@avemaria.edu", pcid: "P000000001", course: "BIO 101" };

    const stillBelow = firstSeenBelowAB([snap(oldest, 70), snap(mid, 72), snap(latest, 64)], target);
    assert.equal(stillBelow?.firstSeen, oldest);
    assert.equal(stillBelow?.lowerBound, true);

    const droppedAfterAB = firstSeenBelowAB([snap(oldest, 90), snap(mid, 85), snap(latest, 74)], target);
    assert.equal(droppedAfterAB?.firstSeen, latest);
    assert.equal(droppedAfterAB?.lowerBound, false);

    const recoveredThenDropped = firstSeenBelowAB(
      [snap(oldest, 70), snap(mid, 88), snap(latest, 74)],
      target,
    );
    assert.equal(recoveredThenDropped?.firstSeen, latest);
    assert.equal(recoveredThenDropped?.lowerBound, false);

    assert.equal(firstSeenBelowAB([snap(oldest, 91), snap(latest, 84)], target), null);
  });

  it("matches history by email case or pcid and by course or courseSisId", () => {
    const asOf = "2026-07-01T12:00:00Z";
    const byEmail = firstSeenBelowAB(
      [snap(asOf, 71, { email: "Athlete.One@AveMaria.edu", studentSisId: undefined })],
      { email: "athlete.one@avemaria.edu", pcid: "", course: "BIO 101" },
    );
    assert.equal(byEmail?.firstSeen, asOf);
    assert.equal(byEmail?.lowerBound, true);

    const byPcid = firstSeenBelowAB(
      [snap(asOf, 71, { email: undefined, studentSisId: "P000000001" })],
      { email: "", pcid: "P000000001", course: "BIO 101" },
    );
    assert.equal(byPcid?.firstSeen, asOf);

    const bySis = firstSeenBelowAB(
      [snap(asOf, 71, { course: "Other", courseSisId: "BIO101" })],
      { email: "athlete.one@avemaria.edu", pcid: "P000000001", course: "BIO 101", courseSisId: "BIO101" },
    );
    assert.equal(bySis?.firstSeen, asOf);
  });

  it("builds a backfill map and reports when history is still missing", () => {
    const oldest = "2026-06-01T12:00:00Z";
    const rows = [officeRow("BIO 101", "C", 74), officeRow("THE 105", "D", 64)];
    const backfill = officeHoursHistoryFromSnapshots(rows, [
      snap(oldest, 70),
      { asOf: oldest, courses: [historyCourse(91, { course: "THE 105" })] },
      {
        asOf: "2026-08-01T12:00:00Z",
        courses: [historyCourse(70), historyCourse(64, { course: "THE 105" })],
      },
    ]);
    const bio = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "BIO 101");
    const theology = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "THE 105");
    assert.equal(backfill[bio].firstSeen, oldest);
    assert.equal(backfill[bio].lowerBound, true);
    assert.equal(backfill[theology].firstSeen, "2026-08-01T12:00:00Z");
    assert.equal(backfill[theology].lowerBound, false);

    const unknownLedger = mergeOfficeHoursLedger(null, rows, "2026-09-13T12:00:00Z");
    assert.equal(officeHoursNeedsHistory(rows, unknownLedger), true);
    const historyLedger = mergeOfficeHoursLedger(unknownLedger, rows, "2026-09-13T12:00:00Z", backfill);
    assert.equal(officeHoursNeedsHistory(rows, historyLedger), false);
  });

  it("skips history once historyAttemptedAt is set and merge keeps the flag", () => {
    const asOf = "2026-09-13T12:00:00Z";
    const attempted = "2026-09-13T12:05:00Z";
    const later = "2026-09-14T12:00:00Z";
    const rows = [officeRow("BIO 101", "C", 74)];
    const unknownLedger = mergeOfficeHoursLedger(null, rows, asOf);
    assert.equal(unknownLedger.historyAttemptedAt, undefined);
    assert.equal(officeHoursNeedsHistory(rows, unknownLedger), true);

    const attemptedLedger: OfficeHoursLedger = {
      ...unknownLedger,
      historyAttemptedAt: attempted,
    };
    assert.equal(officeHoursNeedsHistory(rows, attemptedLedger), false);

    const next = mergeOfficeHoursLedger(attemptedLedger, rows, later);
    const key = officeHoursLedgerKey("athlete.one@avemaria.edu", "P000000001", "BIO 101");
    assert.equal(next.historyAttemptedAt, attempted);
    assert.equal(next.entries[key].source, "unknown");
    assert.equal(officeHoursNeedsHistory(rows, next), false);
  });

  it("labels duration unknown, at least N days, or today from history", () => {
    assert.equal(officeHoursDurationLabel(null), "unknown");
    assert.equal(officeHoursDurationLabel(12), "unknown");
    assert.equal(officeHoursDurationLabel(12, { source: "unknown" }), "unknown");
    assert.equal(officeHoursDurationLabel(0, { source: "history", lowerBound: true }), "at least 1 day");
    assert.equal(officeHoursDurationLabel(1, { source: "history", lowerBound: true }), "at least 1 day");
    assert.equal(officeHoursDurationLabel(12, { source: "history", lowerBound: true }), "at least 12 days");
    assert.equal(officeHoursDurationLabel(0, { source: "history" }), "today");
    assert.equal(officeHoursDurationLabel(1, { source: "history" }), "1 day");
    assert.equal(officeHoursDurationLabel(12, { source: "history" }), "12 days");
  });
});
