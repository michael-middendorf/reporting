import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CensusRawStudent } from "../census/lists-core";
import type { Resident } from "../housing/types";
import {
  ALWAYS_MISSING,
  attendancePercent,
  bestMatches,
  buildJoinIndex,
  censusCandidate,
  gradeKpis,
  normalizePulse,
  pickCensusRow,
  pickCurrentResident,
  sessionBucket,
  buildStudentProfile,
  emailVariants,
  isYesFlag,
  lambdaProfileStatus,
  profileJoinKeys,
  type ProfileSources,
} from "./student-profile";

const KEY = "abcdefghijklmnopqrstuvwxyz012345";

function lambda(student: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    asOf: { courses: "2026-09-24T12:00:00Z", attendance: null, attendanceSummary: null, notes: null, alerts: null },
    student: { studentKey: KEY, firstName: "Test", lastName: "Student", risk: 4, riskTrend: 1, lastLogin: null, ...student },
    courses: [
      { course: "THEO 101", grade: 95, missing: 0, timesAbsent: 1, percentageAttendance: 90 },
      { course: "MATH 150", grade: 72.5, missing: 3, timesAbsent: 4, percentageAttendance: 70 },
      { course: "HIST 201", grade: null, missing: null, timesAbsent: null },
    ],
    sessions: [
      { classDate: "2026-09-22", course: "MATH 150", status: "Absent" },
      { classDate: "2026-09-20", course: "THEO 101", status: "Present" },
    ],
    // pulseFromSessions() output from the Lambda, not a banded pulse.
    pulse: { present: 3, absent: 1, late: 0, other: 0, sessionCount: 4, latestClassDate: "2026-09-22" },
    notes: [{ datetime: "2026-09-10", author: "Prof", course: "MATH 150", text: "Check in", tags: null, alert: null, term: null }],
    alerts: [],
    ...extra,
  };
}

function census(overrides: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "",
    first: "Test",
    last: "Student",
    incomingReturning: "Returning",
    state: "FL",
    religion: "",
    cathGroup: "",
    ethnicity: "",
    gender: "",
    program: "BA",
    collegeAttend: "",
    curriculum: "",
    curriculumName: "Theology",
    classLevel: "Sophomore",
    fullPart: "Full Time",
    city: "",
    credits: 15,
    gpa: "3.41",
    earnedCredits: "30",
    residency: "On Campus",
    sport: "",
    athlete: "",
    athleticType: "",
    rosterStatus: "",
    honors: "Y",
    fsp: "N",
    household: "St. Kateri",
    institute: "",
    marines: "",
    appDecision: "",
    session: "",
    degree: "",
    email: "",
    citizenship: "",
    visa: "",
    ...overrides,
  };
}

function sources(partial: Partial<ProfileSources>): ProfileSources {
  return { roster: null, housing: null, census: null, ...partial };
}

describe("student profile join keys", () => {
  it("normalizes PCID with or without P and builds AMU email variants", () => {
    assert.equal(profileJoinKeys({ studentSisId: "123456" }).pcid, "P000123456");
    assert.equal(profileJoinKeys({ studentSisId: "p000123456" }).pcid, "P000123456");
    assert.equal(profileJoinKeys({ studentSisId: "ABC-9" }).pcid, null);
    assert.deepEqual(emailVariants("Jane.Doe@My.AveMaria.edu"), [
      "jane.doe@avemaria.edu",
      "jane.doe@my.avemaria.edu",
    ]);
    assert.deepEqual(emailVariants("x@gmail.com"), ["x@gmail.com"]);
    assert.deepEqual(emailVariants(""), []);
  });

  it("treats blank, N, and No as not set", () => {
    assert.equal(isYesFlag("Y"), true);
    assert.equal(isYesFlag("St. Kateri"), true);
    assert.equal(isYesFlag("N"), false);
    assert.equal(isYesFlag(" no "), false);
    assert.equal(isYesFlag(""), false);
    assert.equal(isYesFlag(null), false);
  });
});

describe("buildStudentProfile", () => {
  it("joins roster, housing, and census by PCID when the SIS id has no P", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "123456", email: "someone.else@avemaria.edu" }),
      sources: sources({
        roster: {
          rows: [
            { pcid: "P000123456", email: "wrong@avemaria.edu", currentsport: "Ultimate Frisbee", classyear: "2029" },
            { pcid: "P000123456", _2ndsport: "Track", currentsport: "Ultimate Frisbee" },
            { pcid: "P000999999", currentsport: "Football" },
          ],
          asOf: "2026-09-23T00:00:00Z",
        },
        housing: {
          residents: [
            { pcid: "P000123456", building: "JPII", room: "204" } as Resident,
            { pcid: "P000999999", building: "TERESA", room: "101" } as Resident,
          ],
          asOf: "2026-09-22",
        },
        census: { students: [census({ pcid: "P000123456" })], asOf: "2026-09-01T00:00:00.000Z" },
      }),
    });
    assert.ok(profile);
    assert.equal(profile.identity.pcid, "P000123456");
    assert.equal(profile.identity.name, "Test Student");
    assert.deepEqual(profile.associations.athletics?.sports, ["Ultimate Frisbee", "Track"]);
    assert.equal(profile.associations.athletics?.secondSport, "Track");
    assert.equal(profile.associations.athletics?.asOf, "2026-09-23T00:00:00Z");
    assert.equal(profile.associations.housing?.hall, "St. John Paul II Hall");
    assert.equal(profile.associations.housing?.room, "204");
    assert.equal(profile.associations.housing?.residency, "On Campus");
    assert.equal(profile.associations.census?.household, "St. Kateri");
    assert.equal(profile.associations.census?.cumulativeGpa, 3.41);
    assert.equal(profile.associations.census?.earnedCredits, 30);
    assert.deepEqual(profile.associationStatus, { athletics: "matched", housing: "matched", census: "matched" });
    assert.deepEqual(profile.gaps, ALWAYS_MISSING);
  });

  it("falls back to email (case and my.avemaria.edu variant) when there is no PCID", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: null, email: "Test.Student@AveMaria.edu" }),
      sources: sources({
        roster: { rows: [{ email: "test.student@my.avemaria.edu", currentsport: "Soccer" }], asOf: null },
        housing: { residents: [{ pcid: "P000000001", email: "TEST.STUDENT@avemaria.edu", building: "XAVIER" } as Resident], asOf: null },
        census: { students: [census({ pcid: "P000000001", email: "test.student@avemaria.edu" })], asOf: null },
      }),
    });
    assert.ok(profile);
    assert.deepEqual(profile.associations.athletics?.sports, ["Soccer"]);
    assert.equal(profile.associations.housing?.hall, "Francis Xavier Hall");
    assert.equal(profile.identity.pcid, "P000000001");
  });

  it("prefers a PCID match over an email match in the same source", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "P000123456", email: "shared@avemaria.edu" }),
      sources: sources({
        housing: {
          residents: [
            { pcid: "P000555555", email: "shared@avemaria.edu", building: "TERESA" } as Resident,
            { pcid: "P000123456", building: "STJOSE" } as Resident,
          ],
          asOf: null,
        },
      }),
    });
    assert.equal(profile?.associations.housing?.buildingCode, "STJOSE");
  });

  it("shows commuters with no hall or room", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "P000123456" }),
      sources: sources({
        housing: { residents: [{ pcid: "P000123456", building: "Commuter", room: "X" } as Resident], asOf: null },
      }),
    });
    assert.equal(profile?.associations.housing?.hall, null);
    assert.equal(profile?.associations.housing?.room, null);
    assert.equal(profile?.associations.housing?.residency, "Commuter");
  });

  it("marks missing sources unavailable and unmatched sources not_found", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "P000123456" }),
      sources: sources({ roster: { rows: [{ pcid: "P000999999" }], asOf: null } }),
    });
    assert.ok(profile);
    assert.equal(profile.associations.athletics, null);
    assert.equal(profile.associations.housing, null);
    assert.equal(profile.associations.census, null);
    assert.deepEqual(profile.associationStatus, { athletics: "not_found", housing: "unavailable", census: "unavailable" });
    assert.equal(profile.gaps.length, ALWAYS_MISSING.length + 1);
    assert.match(profile.gaps.at(-1) || "", /Cumulative GPA/);
  });

  it("computes KPIs and flags only graded classes below A/B", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "P000123456" }),
      sources: sources({}),
    });
    assert.ok(profile);
    const flags = profile.courses.map((c) => [c.course, c.letter, c.belowAB]);
    assert.deepEqual(flags, [
      ["THEO 101", "A", false],
      ["MATH 150", "C-", true],
      ["HIST 201", "None", false],
    ]);
    // (4.0 + 1.7) / 2
    assert.equal(profile.kpis.gpaEstimate, 2.85);
    assert.equal(profile.kpis.avgGrade, 83.8);
    assert.equal(profile.kpis.gradedCourses, 2);
    assert.equal(profile.kpis.belowAbCount, 1);
    assert.equal(profile.kpis.totalAbsences, 5);
    assert.equal(profile.kpis.totalMissing, 3);
    assert.equal(profile.kpis.risk, 4);
    // Latest session is Absent, so the band is inactive; last attended is the newest Present.
    assert.equal(profile.pulse?.band, "inactive");
    assert.equal(profile.pulse?.source, "session");
    assert.equal(profile.pulse?.lastAttended, "2026-09-20");
    assert.equal(profile.pulse?.present, 3);
    assert.equal(profile.sessions.length, 2);
    assert.equal(profile.notes.length, 1);
    assert.equal(profile.asOf.courses, "2026-09-24T12:00:00Z");
  });

  it("derives a band from the Lambda pulse counts", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const lambdaPulse = { present: 5, absent: 0, late: 0, other: 1, sessionCount: 6, latestClassDate: "2026-09-24" };
    const sessions = [{ classDate: "2026-09-24", course: "THEO 101", status: "Present" }];
    const pulse = normalizePulse(lambdaPulse, sessions, now);
    assert.equal(pulse?.band, "attending");
    assert.equal(pulse?.lastAttended, "2026-09-24");
    assert.equal(pulse?.sessionCount, 6);
    // Counts only (no session list): band from counts, latestClassDate as the fallback date.
    assert.equal(normalizePulse({ present: 1, absent: 4, late: 0, other: 0, sessionCount: 5 }, [], now)?.band, "inactive");
    assert.equal(normalizePulse({ present: 0, absent: 0, late: 0, other: 0, sessionCount: 0 }, [], now), null);
    // A pre-banded pulse is still accepted.
    assert.equal(normalizePulse({ band: "watch", present: 1 }, [], now)?.band, "watch");
    assert.equal(normalizePulse(null), null);
  });

  it("buckets session statuses like the Lambda", () => {
    assert.equal(sessionBucket("Present"), "present");
    assert.equal(sessionBucket("P"), "present");
    assert.equal(sessionBucket("Excused Absent"), "absent");
    assert.equal(sessionBucket("Tardy"), "late");
    assert.equal(sessionBucket("Not recorded"), null);
  });

  it("prefers a resident row with a building, then the latest eRez start", () => {
    const rows = [
      { pcid: "P1", building: "Commuter", move_in_erez: "2026-09-01" },
      { pcid: "P1", building: "CIARA", move_in_erez: "2026-08-01" },
      { pcid: "P1", building: "JPII", move_in_erez: "2026-08-15" },
    ] as Resident[];
    assert.equal(pickCurrentResident(rows)?.building, "JPII");
    assert.equal(pickCurrentResident([]), undefined);
  });

  it("returns null KPIs when nothing is graded", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({}, { courses: [], pulse: null }),
      sources: sources({}),
    });
    assert.equal(profile?.kpis.gpaEstimate, null);
    assert.equal(profile?.kpis.avgGrade, null);
    assert.equal(profile?.kpis.totalAbsences, null);
    assert.equal(profile?.pulse, null);
  });

  it("reads status from the Lambda payload", () => {
    assert.equal(lambdaProfileStatus({ ok: true, status: "awaiting_first_delivery", student: null }), "awaiting_first_delivery");
    assert.equal(lambdaProfileStatus({ ok: true, status: "not_found", student: null }), "not_found");
    assert.equal(lambdaProfileStatus({ ok: true, student: null }), "not_found");
    assert.equal(lambdaProfileStatus(lambda({})), "ok");
    assert.equal(buildStudentProfile({ studentKey: KEY, lambdaResult: { ok: true, student: null }, sources: sources({}) }), null);
  });
});

describe("attendancePercent", () => {
  it("keeps AspireDU's percentage when delivered", () => {
    assert.deepEqual(attendancePercent({ percentageAttendance: 87.5, timesPresent: 1, timesAbsent: 9 }), {
      percentageAttendance: 87.5,
      attendanceDerived: false,
    });
  });

  it("derives it from session counts when the summary is missing", () => {
    assert.deepEqual(attendancePercent({ percentageAttendance: null, timesPresent: 7, timesAbsent: 2 }), {
      percentageAttendance: 78,
      attendanceDerived: true,
    });
    // Late counts as attended.
    assert.equal(attendancePercent({ timesPresent: 6, timesLate: 2, timesAbsent: 2 }).percentageAttendance, 80);
    assert.equal(attendancePercent({ timesPresent: 0, timesAbsent: 3 }).percentageAttendance, 0);
  });

  it("stays null without counts or with zero sessions", () => {
    assert.equal(attendancePercent({ timesPresent: 3, timesAbsent: null }).percentageAttendance, null);
    assert.equal(attendancePercent({ timesPresent: 0, timesAbsent: 0 }).percentageAttendance, null);
    assert.equal(attendancePercent({}).percentageAttendance, null);
  });

  it("fills the Attended column on a built profile", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "P000123456" }, {
        courses: [{ course: "MATH 150", grade: 90, timesPresent: 3, timesAbsent: 1, percentageAttendance: null }],
      }),
      sources: sources({}),
    });
    assert.equal(profile?.courses[0]?.percentageAttendance, 75);
    assert.equal(profile?.courses[0]?.attendanceDerived, true);
  });
});

describe("census on the profile", () => {
  it("sends grouped census values (not the raw row) with blanks hidden", () => {
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "P000123456" }),
      sources: sources({
        census: {
          students: [census({ pcid: "P000123456", program: "UNDERG", dob: "2006-01-02", acComments: "Strong fit", act: "28" })],
          asOf: "2026-09-20T00:00:00Z",
        },
      }),
    });
    const block = profile?.associations.census;
    assert.ok(block);
    assert.equal("record" in block, false, "the raw census row stays on the server");
    assert.equal(block.household, "St. Kateri");
    const names = block.groups.map((g) => g.group);
    assert.deepEqual(names.slice(0, 2), ["Enrollment", "Residency"]);
    assert.ok(!names.includes("Census record"), "identity columns are export only");
    const demographics = block.groups.find((g) => g.group === "Demographics");
    assert.ok(demographics);
    assert.equal(demographics.open, false);
    // gender, ethnicity, religion... are blank in the fixture and must not render.
    assert.deepEqual(
      demographics.fields.map((f) => f.label),
      ["State", "Date of birth"],
    );
    const interview = block.groups.find((g) => g.group === "Interview");
    assert.deepEqual(interview?.fields, [{ label: "AC comments", value: "Strong fit" }]);
    const admissions = block.groups.find((g) => g.group === "Admissions");
    assert.deepEqual(admissions?.fields, [{ label: "ACT", value: "28" }]);
    for (const group of block.groups) {
      for (const f of group.fields) assert.notEqual(f.value.trim(), "", `${group.group}/${f.label}`);
    }
  });

  it("prefers the primary UNDERG row when a PCID has two census rows", () => {
    const grad = census({ pcid: "P000123456", program: "GRAD", degree: "MARTS", curriculumName: "MA Theology" });
    const dual = census({ pcid: "P000123456", program: "UNDERG", collegeAttend: "DUAL", curriculumName: "Dual" });
    const ug = census({ pcid: "P000123456", program: "UNDERG", collegeAttend: "RETURN", curriculumName: "Theology" });
    assert.equal(pickCensusRow([grad, dual, ug]), ug);
    assert.equal(pickCensusRow([grad, dual]), dual);
    assert.equal(pickCensusRow([grad]), grad);
    assert.equal(pickCensusRow([]), undefined);
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "123456" }),
      sources: sources({ census: { students: [grad, ug], asOf: null } }),
    });
    assert.equal(profile?.associations.census?.program, "Theology");
  });
});

describe("FERPA guard on email matches", () => {
  it("rejects an email match when both PCIDs exist and disagree", () => {
    const other = census({ pcid: "P000999999", email: "test.student@avemaria.edu", household: "Wrong Person" });
    const profile = buildStudentProfile({
      studentKey: KEY,
      lambdaResult: lambda({ studentSisId: "P000123456", email: "test.student@my.avemaria.edu" }),
      sources: sources({ census: { students: [other], asOf: null } }),
    });
    assert.equal(profile?.associations.census, null);
    assert.equal(profile?.associationStatus.census, "not_found");
  });

  it("still matches by email when either side has no PCID", () => {
    const noPcid = census({ pcid: "", email: "test.student@avemaria.edu" });
    const keys = profileJoinKeys({ studentSisId: "P000123456", email: "test.student@avemaria.edu" });
    assert.deepEqual(bestMatches(keys, [noPcid], censusCandidate), [noPcid]);
    const withPcid = census({ pcid: "P000999999", email: "test.student@avemaria.edu" });
    const keysNoPcid = profileJoinKeys({ studentSisId: null, email: "test.student@avemaria.edu" });
    assert.deepEqual(bestMatches(keysNoPcid, [withPcid], censusCandidate), [withPcid]);
    // Same PCID written differently is not a conflict.
    const samePerson = census({ pcid: "123456", email: "test.student@avemaria.edu" });
    const keysSis = profileJoinKeys({ studentSisId: "ZZZ", email: "test.student@avemaria.edu" });
    assert.deepEqual(bestMatches(keysSis, [samePerson], censusCandidate), [samePerson]);
  });

  it("applies the same guard in the bulk index", () => {
    const rows = [
      census({ pcid: "P000999999", email: "test.student@avemaria.edu" }),
      census({ pcid: "", email: "test.student@avemaria.edu" }),
    ];
    const keys = profileJoinKeys({ studentSisId: "P000123456", email: "test.student@avemaria.edu" });
    assert.deepEqual(buildJoinIndex(rows, censusCandidate).lookup(keys), [rows[1]]);
    assert.deepEqual(buildJoinIndex(rows, censusCandidate).lookup(keys), bestMatches(keys, rows, censusCandidate));
  });
});

describe("buildJoinIndex", () => {
  it("returns exactly what bestMatches returns, in the same order", () => {
    const rows = [
      census({ pcid: "P000000001", email: "a@avemaria.edu" }),
      census({ pcid: "123456", email: "b@avemaria.edu" }),
      census({ pcid: "P000123456", email: "c@my.avemaria.edu" }),
      census({ pcid: "", email: "c@avemaria.edu" }),
      census({ pcid: "X-77", email: "" }),
    ];
    const index = buildJoinIndex(rows, censusCandidate);
    const cases = [
      { studentSisId: "123456", email: "zzz@avemaria.edu" },
      { studentSisId: null, email: "c@avemaria.edu" },
      { studentSisId: "x-77", email: null },
      { studentSisId: "999", email: "a@my.avemaria.edu" },
      { studentSisId: null, email: null },
    ];
    for (const student of cases) {
      const keys = profileJoinKeys(student);
      assert.deepEqual(index.lookup(keys), bestMatches(keys, rows, censusCandidate), JSON.stringify(student));
    }
    // PCID beats email even when an earlier row matches by email.
    assert.deepEqual(index.lookup(profileJoinKeys({ studentSisId: "123456", email: "a@avemaria.edu" })), [rows[1], rows[2]]);
  });
});

describe("gradeKpis", () => {
  it("matches the profile KPI math and ignores ungraded classes", () => {
    assert.deepEqual(gradeKpis([95, 72.5, null]), { gpaEstimate: 2.85, avgGrade: 83.8, gradedCourses: 2, belowAbCount: 1 });
    assert.deepEqual(gradeKpis([null]), { gpaEstimate: null, avgGrade: null, gradedCourses: 0, belowAbCount: 0 });
  });
});

