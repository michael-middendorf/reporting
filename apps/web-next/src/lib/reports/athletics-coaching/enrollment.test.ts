import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eligibleSigned } from "../athletics/normalize";
import type { AthleticsRecord } from "../athletics/types";
import {
  applicationMatchesSport,
  buildEnrollmentSummary,
  enrollmentAccess,
  normalizeRosterRow,
  rosterMatchesSport,
  ROSTER_UNAVAILABLE_REASON,
} from "./enrollment";

const COACH = "coach.a@avemaria.edu";
const OTHER = "annie.esposito@avemaria.edu";
const ERIC = "Eric.Vanheusen@avemaria.edu";

function application(partial: Partial<AthleticsRecord>): AthleticsRecord {
  return {
    kind: "application",
    id: partial.id || "app-1",
    firstName: "Pat",
    lastName: "Player",
    email: "pat@example.com",
    phone: "",
    city: "",
    state: "",
    sport: "Football",
    position: "",
    gender: "",
    term: "Fall 2027",
    sector: "Varsity",
    athleteStatus: "",
    applicationStatus: "",
    workflowBin: "",
    stage: "Applied",
    decisionCode: "",
    withdrawn: "Not Withdrawn",
    purchasedList: "",
    riskRating: "",
    loiStatus: "",
    offered: "No",
    readyToOffer: "Not Ready to Offer",
    signed: "Not Signed",
    studentType: "",
    prospectStatus: "Applicant",
    recordUrl: "",
    profileUrl: "",
    gpa: null,
    catholic: false,
    athleticScholarship: 0,
    athleticDiscretionaryFund: 0,
    faithFootball: 0,
    impactAwards: 0,
    academicScholarship: 0,
    admissionsAwards: 0,
    totalAwards: 0,
    ...partial,
  };
}

describe("athletics coaching enrollment sport filter", () => {
  it("maps currentsport and _2ndsport through resolveSportKey", () => {
    const football = normalizeRosterRow({
      email: "a@avemaria.edu",
      pcid: "1",
      personreferenceid: "p1",
      firstname: "A",
      lastname: "One",
      currentsport: "Football",
      _2ndsport: "Tennis",
      amustatus: "Current Student",
      incomingreturning: "Returning",
    });
    assert.equal(football.sportKey, "football");
    assert.equal(football.secondSportKey, "tennis");
    assert.equal(rosterMatchesSport(football, "football"), true);
    assert.equal(rosterMatchesSport(football, "tennis"), true);
    assert.equal(rosterMatchesSport(football, "mens-soccer"), false);

    const soccer = normalizeRosterRow({
      Email: "b@avemaria.edu",
      CurrentSport: "Soccer-Men",
      ClassYear: "Junior",
    });
    assert.equal(soccer.sportKey, "mens-soccer");
    assert.equal(rosterMatchesSport(soccer, "mens-soccer"), true);
    assert.equal(rosterMatchesSport(soccer, "football"), false);
  });

  it("counts only the requested sport and includes second-sport athletes", () => {
    const summary = buildEnrollmentSummary({
      sport: "football",
      rosterRows: [
        { personreferenceid: "1", firstname: "A", currentsport: "Football", classyear: "Senior" },
        { personreferenceid: "2", firstname: "B", currentsport: "Soccer-Men" },
        { personreferenceid: "3", firstname: "C", currentsport: "Tennis", _2ndsport: "Football", classyear: "Sophomore" },
        { personreferenceid: "1", firstname: "A-dup", currentsport: "Football" },
      ],
      applicationRows: [
        application({ id: "f1", sport: "Football", signed: "Signed or Deposited" }),
        application({ id: "f2", sport: "Football" }),
        application({ id: "s1", sport: "Soccer-Men", signed: "Signed or Deposited" }),
      ],
    });
    assert.equal(summary.roster.available, true);
    assert.equal(summary.roster.count, 2);
    assert.deepEqual(summary.roster.classYearMix, [
      { label: "Senior", count: 1 },
      { label: "Sophomore", count: 1 },
    ]);
    assert.equal(summary.applications.count, 2);
    assert.equal(summary.signed.count, 1);
    assert.equal(applicationMatchesSport(application({ sport: "Football" }), "football"), true);
    assert.equal(applicationMatchesSport(application({ sport: "Soccer-Men" }), "football"), false);
    assert.equal(eligibleSigned(application({ sport: "Football", signed: "Signed or Deposited" })), true);
  });

  it("does not invent a roster headcount when the roster file is missing", () => {
    const summary = buildEnrollmentSummary({
      sport: "football",
      rosterRows: null,
      applicationRows: [application({ id: "f1", sport: "Football", signed: "Signed or Deposited" })],
    });
    assert.equal(summary.roster.available, false);
    assert.equal(summary.roster.count, null);
    assert.equal(summary.roster.reason, ROSTER_UNAVAILABLE_REASON);
    assert.deepEqual(summary.roster.classYearMix, []);
    assert.equal(summary.signed.available, true);
    assert.equal(summary.signed.count, 1);
    assert.equal(summary.applications.count, 1);
  });
});

describe("athletics coaching enrollment access deny", () => {
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;

  it("rejects anonymous, unrelated, and cross-sport requests", () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({ [COACH]: ["football"] });
    try {
      const anon = enrollmentAccess(null, "football");
      assert.equal(anon.ok, false);
      if (!anon.ok) assert.equal(anon.status, 401);

      const unrelated = enrollmentAccess(OTHER, "football");
      assert.equal(unrelated.ok, false);
      if (!unrelated.ok) assert.equal(unrelated.status, 403);

      const wrongSport = enrollmentAccess(COACH, "mens-soccer");
      assert.equal(wrongSport.ok, false);
      if (!wrongSport.ok) assert.equal(wrongSport.status, 403);

      const unknown = enrollmentAccess(COACH, "marching-band");
      assert.equal(unknown.ok, false);
      if (!unknown.ok) assert.equal(unknown.status, 400);

      const missing = enrollmentAccess(COACH, "");
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.status, 400);

      const ok = enrollmentAccess(COACH, "football");
      assert.equal(ok.ok, true);
      if (ok.ok) assert.equal(ok.sport, "football");

      const leadership = enrollmentAccess(ERIC, "womens-volleyball");
      assert.equal(leadership.ok, true);
    } finally {
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });
});
