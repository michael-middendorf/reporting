import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CensusRawStudent } from "../census/lists-core";
import type { Resident } from "../housing/types";
import {
  ALWAYS_MISSING,
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
    sessions: [{ classDate: "2026-09-20", course: "THEO 101", status: "Present" }],
    pulse: { band: "watch", source: "session", lastAttended: null, present: 3, absent: 1, late: 0, sessionCount: 4 },
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
    assert.equal(profile.pulse?.band, "watch");
    assert.equal(profile.sessions.length, 1);
    assert.equal(profile.notes.length, 1);
    assert.equal(profile.asOf.courses, "2026-09-24T12:00:00Z");
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
