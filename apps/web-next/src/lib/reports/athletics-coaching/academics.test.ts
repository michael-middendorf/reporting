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
  attendancePulse,
  buildAcademicsSummary,
  coachingLambdaPayload,
  coachingMfaUrl,
  isCoachingActionUnavailable,
  matchedRosterRows,
  normalizePcid,
  rosterJoinKeys,
  safeCoachingNext,
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

describe("coaching MFA urls", () => {
  it("keeps mfaUrl under /athletics/coaching and rejects open redirects", () => {
    assert.equal(coachingMfaUrl("football"), "/athletics/coaching/mfa?next=%2Fathletics%2Fcoaching%2Ffootball");
    assert.equal(safeCoachingNext("/athletics/coaching/football"), "/athletics/coaching/football");
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
      { band: "attending", source: "session", lastAttended: stale },
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

describe("coaching Lambda unavailable", () => {
  it("treats 501 and unknown action as a 503-able miss, not a 500", () => {
    assert.equal(isCoachingActionUnavailable({ status: 501, error: "unknown action" }), true);
    assert.equal(isCoachingActionUnavailable({ statusCode: 501 }), true);
    assert.equal(isCoachingActionUnavailable(new Error("Processor error: unsupported action")), true);
    assert.equal(isCoachingActionUnavailable(new Error('Processor error: {"errorMessage":"unknown action"}')), true);
    assert.equal(isCoachingActionUnavailable({ ok: true, students: [] }), false);
  });
});
