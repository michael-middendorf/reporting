import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPORT_IDS,
  STRICT_REPORTS,
  canAccessReport,
  canLogin,
  isAdmin,
  isStrictReport,
  needsMfaAtSignIn,
  reportsForEmail,
  sessionDecisionAtComplete,
} from "./access";
import {
  canAccessSport,
  coachSportKeys,
  isCoachingLeadership,
} from "./reports/athletics-coaching/access";
import { canAccessAthleticsGiving } from "./reports/athletics-giving/access";
import { SPORTS } from "./reports/athletics-coaching/sports";

const ROBERT = "Robert.Musselman@avemaria.edu";
const ZENA = "zena.weist@avemaria.edu";
const ANNIE = "annie.esposito@avemaria.edu";

describe("chapel-only grant", () => {
  it("lets Robert sign in and open only chapel reports", () => {
    assert.equal(canLogin(ROBERT), true);
    assert.equal(canAccessReport(ROBERT, "chapel"), true);
    assert.equal(canAccessReport(ROBERT, "advancement"), false);
    assert.equal(canAccessReport(ROBERT, "annunciation"), false);
    assert.equal(canAccessReport(ROBERT, "enrollment"), false);
    assert.deepEqual(reportsForEmail(ROBERT), ["chapel"]);
  });

  it("keeps existing Advancement users on chapel pages", () => {
    assert.equal(canAccessReport(ZENA, "advancement"), true);
    assert.equal(canAccessReport(ZENA, "chapel"), true);
    assert.equal(canAccessReport(ZENA, "annunciation"), true);
    assert.equal(reportsForEmail(ZENA).includes("chapel"), true);
    assert.equal(reportsForEmail(ZENA).includes("advancement"), true);
  });

  it("does not grant chapel to unrelated report users", () => {
    assert.equal(canLogin(ANNIE), true);
    assert.equal(canAccessReport(ANNIE, "points"), true);
    assert.equal(canAccessReport(ANNIE, "chapel"), false);
    assert.equal(canAccessReport(ANNIE, "advancement"), false);
    assert.equal(canAccessReport(ANNIE, "athletics"), false);
    assert.equal(canAccessReport(ANNIE, "athletics-coaching"), false);
  });
});

describe("portfolio grants", () => {
  it("lets Annie sign in to portfolios without granting Advancement", () => {
    assert.equal(canLogin(ANNIE), true);
    assert.equal(canAccessReport(ANNIE, "portfolios"), true);
    assert.equal(canAccessReport(ANNIE, "advancement"), false);
    assert.equal(canAccessReport(ANNIE, "points"), true);
    assert.deepEqual(reportsForEmail(ANNIE), ["points", "portfolios"]);
  });

  it("lets every MA officer open Points and Portfolios only", () => {
    const officers = [
      "alanna.f.mccann@avemaria.edu",
      "sean.e.kelly@avemaria.edu",
      "joseph.c.blaso@avemaria.edu",
      "elena.j.barnes@avemaria.edu",
      "caleb.m.metzen@avemaria.edu",
      "betsy.scaletty@avemaria.edu",
      "natalia.p.abrams@avemaria.edu",
    ];
    for (const email of officers) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "points"), true, email);
      assert.equal(canAccessReport(email, "portfolios"), true, email);
      assert.equal(canAccessReport(email, "advancement"), false, email);
      assert.deepEqual(reportsForEmail(email), ["points", "portfolios"], email);
    }
  });

  it("lets Jim and Julie open portfolios as MGOs, not Becca", () => {
    assert.equal(canAccessReport("jim.thomas@avemaria.edu", "portfolios"), true);
    assert.equal(canAccessReport("julie.musselman@avemaria.edu", "portfolios"), true);
    assert.equal(canAccessReport("becca.kennedy@avemaria.edu", "portfolios"), false);
  });

  it("does not grant portfolios to Zena", () => {
    assert.equal(canAccessReport(ZENA, "portfolios"), false);
  });

  it("lets admins see portfolios among every report", () => {
    const admin = "michael.t.middendorf@avemaria.edu";
    assert.equal(canAccessReport(admin, "portfolios"), true);
    assert.deepEqual(reportsForEmail(admin), [...REPORT_IDS]);
  });
});

describe("institute-only grant", () => {
  const GABRIEL = "Gabriel.F.Mellino@avemaria.edu";

  it("lets Gabriel sign in and open only The Institute", () => {
    assert.equal(canLogin(GABRIEL), true);
    assert.equal(canAccessReport(GABRIEL, "institute"), true);
    assert.equal(canAccessReport(GABRIEL, "enrollment"), false);
    assert.equal(canAccessReport(GABRIEL, "census"), false);
    assert.equal(canAccessReport(GABRIEL, "housing"), false);
    assert.equal(canAccessReport(GABRIEL, "advancement"), false);
    assert.equal(canAccessReport(GABRIEL, "chapel"), false);
    assert.equal(canAccessReport(GABRIEL, "points"), false);
    assert.equal(canAccessReport(GABRIEL, "portfolios"), false);
    assert.equal(canAccessReport(GABRIEL, "annunciation"), false);
    assert.equal(canAccessReport(GABRIEL, "aspiredu"), false);
    assert.equal(canAccessReport(GABRIEL, "athletics"), false);
    assert.equal(canAccessReport(GABRIEL, "athletics-coaching"), false);
    assert.deepEqual(reportsForEmail(GABRIEL), ["institute"]);
  });
});

describe("music board moved to hub", () => {
  const TRENTON = "Trenton.Oneil@avemaria.edu";

  it("does not let Trenton sign in to reporting", () => {
    assert.equal(canLogin(TRENTON), false);
    assert.deepEqual(reportsForEmail(TRENTON), []);
  });
});

describe("athletics-only grant", () => {
  const ERIC = "Eric.Vanheusen@avemaria.edu";
  const COACH = "Jamon.Copeland@avemaria.edu";

  it("lets Eric sign in and open Athletics Master, coaching, housing, and census", () => {
    assert.equal(canLogin(ERIC), true);
    assert.equal(canAccessReport(ERIC, "athletics"), true);
    assert.equal(canAccessReport(ERIC, "athletics-coaching"), true);
    assert.equal(canAccessReport(ERIC, "housing"), true);
    assert.equal(canAccessReport(ERIC, "census"), true);
    assert.equal(canAccessReport(ERIC, "enrollment"), false);
    assert.equal(canAccessReport(ERIC, "institute"), false);
    assert.equal(canAccessReport(ERIC, "advancement"), false);
    assert.equal(canAccessReport(ERIC, "chapel"), false);
    assert.equal(canAccessReport(ERIC, "points"), false);
    assert.equal(canAccessReport(ERIC, "portfolios"), false);
    assert.equal(canAccessReport(ERIC, "annunciation"), false);
    assert.equal(canAccessReport(ERIC, "aspiredu"), false);
    assert.deepEqual(reportsForEmail(ERIC), ["census", "athletics", "athletics-coaching", "housing", "business-office"]);
  });

  it("lets Feger and Weisbrod open every Athletics department report", () => {
    for (const email of ["Elizabeth.Feger@avemaria.edu", "John.Weisbrod@avemaria.edu"]) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "athletics"), true, email);
      assert.equal(canAccessReport(email, "athletics-coaching"), true, email);
      assert.equal(canAccessAthleticsGiving(email), true, email);
      assert.equal(canAccessReport(email, "enrollment"), false, email);
      assert.deepEqual(reportsForEmail(email), ["athletics", "athletics-coaching", "business-office"], email);
    }
  });

  it("lets a mapped head coach sign in to their sport dashboard only, not Master", () => {
    assert.equal(canLogin(COACH), true);
    assert.equal(canAccessReport(COACH, "athletics"), false);
    assert.equal(canAccessReport(COACH, "athletics-coaching"), true);
    assert.equal(isCoachingLeadership(COACH), false);
    assert.deepEqual(coachSportKeys(COACH), ["mens-basketball"]);
    assert.equal(canAccessSport(COACH, "mens-basketball"), true);
    assert.equal(canAccessSport(COACH, "womens-basketball"), false);
    assert.equal(canAccessSport(COACH, "football"), false);
    assert.equal(canAccessReport(COACH, "enrollment"), false);
    assert.equal(canAccessReport(COACH, "census"), false);
    assert.deepEqual(reportsForEmail(COACH), ["athletics-coaching"]);
  });
});

describe("athletics giving access", () => {
  const ERIC = "Eric.Vanheusen@avemaria.edu";
  const COACH = "Jamon.Copeland@avemaria.edu";
  const JIM = "jim.thomas@avemaria.edu";

  it("is for Athletics Master, coaching leadership, and Advancement, not head coaches", () => {
    assert.equal(canAccessAthleticsGiving(ERIC), true);
    assert.equal(canAccessAthleticsGiving("elizabeth.feger@avemaria.edu"), true);
    assert.equal(canAccessAthleticsGiving("john.weisbrod@avemaria.edu"), true);
    assert.equal(canAccessAthleticsGiving("joshua.lewis@avemaria.edu"), true);
    assert.equal(canAccessAthleticsGiving(JIM), true);
    assert.equal(canAccessAthleticsGiving(COACH), false);
  });
});

describe("athletics coaching access", () => {
  const ERIC = "Eric.Vanheusen@avemaria.edu";
  const COACH = "coach.a@avemaria.edu";
  const OTHER = "annie.esposito@avemaria.edu";
  const prevCoaches = process.env.ATHLETICS_COACHING_COACHES;
  const prevLead = process.env.ATHLETICS_COACHING_LEADERSHIP_EMAILS;

  it("gives leadership every sport and keeps recruiting plus coaching", () => {
    assert.equal(isCoachingLeadership(ERIC), true);
    assert.equal(coachSportKeys(ERIC), "all");
    assert.equal(canAccessSport(ERIC, "football"), true);
    assert.equal(canAccessSport(ERIC, "mens-soccer"), true);
    assert.equal(canAccessSport(ERIC, "mens-golf"), true);
    assert.equal(canAccessReport(ERIC, "athletics"), true);
    assert.equal(canAccessReport(ERIC, "aspiredu"), false);
    assert.equal(needsMfaAtSignIn(ERIC), true);
  });

  it("lets a mapped coach open only listed sports", () => {
    process.env.ATHLETICS_COACHING_COACHES = JSON.stringify({
      [COACH]: ["football"],
    });
    try {
      assert.equal(canLogin(COACH), true);
      assert.equal(canAccessReport(COACH, "athletics-coaching"), true);
      assert.equal(canAccessReport(COACH, "athletics"), false);
      assert.equal(canAccessReport(COACH, "aspiredu"), false);
      assert.equal(isCoachingLeadership(COACH), false);
      assert.deepEqual(coachSportKeys(COACH), ["football"]);
      assert.equal(canAccessSport(COACH, "football"), true);
      assert.equal(canAccessSport(COACH, "mens-soccer"), false);
      assert.equal(canAccessSport(COACH, "womens-soccer"), false);
      assert.equal(needsMfaAtSignIn(COACH), true);
    } finally {
      if (prevCoaches === undefined) delete process.env.ATHLETICS_COACHING_COACHES;
      else process.env.ATHLETICS_COACHING_COACHES = prevCoaches;
    }
  });

  it("does not grant coaching to an unrelated report user", () => {
    assert.equal(canAccessReport(OTHER, "athletics-coaching"), false);
    assert.equal(canAccessSport(OTHER, "football"), false);
    assert.equal(reportsForEmail(OTHER).includes("athletics-coaching"), false);
  });

  it("adds leadership from ATHLETICS_COACHING_LEADERSHIP_EMAILS", () => {
    const extra = "pat.ad@avemaria.edu";
    process.env.ATHLETICS_COACHING_LEADERSHIP_EMAILS = extra;
    try {
      assert.equal(isCoachingLeadership(extra), true);
      assert.equal(canAccessReport(extra, "athletics-coaching"), true);
      assert.equal(canAccessSport(extra, "womens-volleyball"), true);
      assert.equal(canAccessReport(extra, "aspiredu"), false);
    } finally {
      if (prevLead === undefined) delete process.env.ATHLETICS_COACHING_LEADERSHIP_EMAILS;
      else process.env.ATHLETICS_COACHING_LEADERSHIP_EMAILS = prevLead;
    }
  });

  it("gives Weisbrod, Feger, and Lewis coaching leadership over every sport", () => {
    const leaders = [
      "John.Weisbrod@avemaria.edu",
      "Elizabeth.Feger@avemaria.edu",
      "Joshua.Lewis@avemaria.edu",
    ];
    for (const email of leaders) {
      assert.equal(canLogin(email), true, email);
      assert.equal(isCoachingLeadership(email), true, email);
      assert.equal(coachSportKeys(email), "all", email);
      assert.equal(canAccessReport(email, "athletics-coaching"), true, email);
      assert.equal(canAccessReport(email, "aspiredu"), false, email);
      for (const sport of SPORTS) {
        assert.equal(canAccessSport(email, sport.key), true, `${email} ${sport.key}`);
      }
    }
  });

  it("maps each head coach to only their sport dashboards", () => {
    const coaches: [string, string[]][] = [
      ["robert.cooper@avemaria.edu", ["mens-baseball"]],
      ["jamon.copeland@avemaria.edu", ["mens-basketball"]],
      ["jelani.akil@avemaria.edu", ["womens-basketball"]],
      ["john.schmidt@avemaria.edu", ["womens-volleyball"]],
      ["camryn.e.olive@avemaria.edu", ["dance-team"]],
      ["alan.webb@avemaria.edu", ["xc-track"]],
      ["joseph.patterson@avemaria.edu", ["football"]],
      ["katelyn.j.sherman@avemaria.edu", ["womens-lacrosse"]],
      ["ryan.dolnick@avemaria.edu", ["rugby"]],
      ["dariel.collazo@avemaria.edu", ["mens-soccer"]],
      ["tyler.rosser@avemaria.edu", ["womens-soccer"]],
      ["trinity.e.medina@avemaria.edu", ["womens-softball"]],
      ["joshua.harriott@avemaria.edu", ["swim-team"]],
      ["steve.smith@avemaria.edu", ["tennis"]],
    ];
    for (const [email, sports] of coaches) {
      assert.equal(canLogin(email), true, email);
      assert.equal(isCoachingLeadership(email), false, email);
      assert.equal(canAccessReport(email, "athletics-coaching"), true, email);
      assert.equal(canAccessReport(email, "athletics"), false, email);
      assert.deepEqual(coachSportKeys(email), sports, email);
      assert.deepEqual(reportsForEmail(email), ["athletics-coaching"], email);
      assert.equal(canAccessAthleticsGiving(email), false, email);
      for (const sport of SPORTS) {
        assert.equal(canAccessSport(email, sport.key), sports.includes(sport.key), `${email} ${sport.key}`);
      }
    }
  });

  it("does not change Michael Middendorf hub-admin access", () => {
    const email = "michael.t.middendorf@avemaria.edu";
    assert.equal(isAdmin(email), true);
    assert.equal(isCoachingLeadership(email), true);
    assert.equal(coachSportKeys(email), "all");
    assert.deepEqual(reportsForEmail(email), [...REPORT_IDS]);
  });
});

describe("housing grant for existing enrollment viewer", () => {
  const DAN = "Dan.Donaldson@avemaria.edu";

  it("lets Dan sign in and open Enrollment plus Housing only", () => {
    assert.equal(canLogin(DAN), true);
    assert.equal(canAccessReport(DAN, "enrollment"), true);
    assert.equal(canAccessReport(DAN, "housing"), true);
    assert.equal(canAccessReport(DAN, "census"), false);
    assert.equal(canAccessReport(DAN, "athletics"), false);
    assert.equal(canAccessReport(DAN, "athletics-coaching"), false);
    assert.equal(canAccessReport(DAN, "institute"), false);
    assert.equal(canAccessReport(DAN, "advancement"), false);
    assert.equal(canAccessReport(DAN, "chapel"), false);
    assert.equal(canAccessReport(DAN, "points"), false);
    assert.equal(canAccessReport(DAN, "portfolios"), false);
    assert.equal(canAccessReport(DAN, "annunciation"), false);
    assert.equal(canAccessReport(DAN, "aspiredu"), false);
    // DST-3015 added Majors and Minors.
    assert.deepEqual(reportsForEmail(DAN), ["enrollment", "housing", "majors"]);
  });
});

describe("DST-1385 ResLife professional staff housing access", () => {
  const staff = [
    "Lauren.Lahr@avemaria.edu",
    "Jeffrey.Stankovsky@avemaria.edu",
    "DanielW.Lendman@avemaria.edu",
    "Brady.Fehringer@avemaria.edu",
    "Patrick.M.Baalman@avemaria.edu",
    "Colleen.Carney@avemaria.edu",
    "Nate.Byers@avemaria.edu",
    "Claudia.Gerbic@avemaria.edu",
  ];

  it("lets Level 1 and RAM staff sign in to Housing only", () => {
    for (const email of staff) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "housing"), true, email);
      assert.equal(isAdmin(email), false, email);
      assert.equal(canAccessReport(email, "enrollment"), false, email);
      assert.equal(canAccessReport(email, "census"), false, email);
      assert.equal(canAccessReport(email, "athletics"), false, email);
      assert.equal(canAccessReport(email, "athletics-coaching"), false, email);
      assert.equal(canAccessReport(email, "institute"), false, email);
      assert.equal(canAccessReport(email, "advancement"), false, email);
      assert.equal(canAccessReport(email, "chapel"), false, email);
      assert.equal(canAccessReport(email, "points"), false, email);
      assert.equal(canAccessReport(email, "annunciation"), false, email);
      assert.equal(canAccessReport(email, "aspiredu"), false, email);
      assert.deepEqual(reportsForEmail(email), ["housing"], email);
    }
  });

  it("does not grant housing to RAs or students", () => {
    assert.equal(canLogin("resident.assistant@avemaria.edu"), false);
    assert.equal(canAccessReport("student@my.avemaria.edu", "housing"), false);
  });
});

describe("census grant for Gallagher, Nutt, and Davy", () => {
  const people = [
    "susan.gallagher@avemaria.edu",
    "roger.nutt@avemaria.edu",
    "daniel.davy@avemaria.edu",
  ];

  it("lets Susan, Roger, and Daniel open census and does not make them admins", () => {
    for (const email of people) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "census"), true, email);
      assert.equal(isAdmin(email), false, email);
    }
  });
});

describe("census grant for Fier and Logan", () => {
  const people = ["Luke.Fier@avemaria.edu", "Steve.Logan@avemaria.edu"];

  it("lets Luke and Steve sign in and open census and Business Office only", () => {
    for (const email of people) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "census"), true, email);
      assert.equal(isAdmin(email), false, email);
      assert.equal(canAccessReport(email, "enrollment"), false, email);
      assert.equal(canAccessReport(email, "athletics"), false, email);
      assert.equal(canAccessReport(email, "housing"), false, email);
      assert.equal(canAccessReport(email, "institute"), false, email);
      assert.equal(canAccessReport(email, "advancement"), false, email);
      assert.equal(canAccessReport(email, "chapel"), false, email);
      assert.equal(canAccessReport(email, "points"), false, email);
      assert.equal(canAccessReport(email, "annunciation"), false, email);
      assert.equal(canAccessReport(email, "aspiredu"), false, email);
      // DST-3015: Steve is also on the Majors and Minors list; Luke is not.
      const expected = /^steve.logan@/i.test(email) ? ["census", "business-office", "majors"] : ["census", "business-office"];
      assert.deepEqual(reportsForEmail(email), expected, email);
    }
  });
});

describe("aspiredu grant for Daniel Davy", () => {
  const DANIEL = "Daniel.Davy@avemaria.edu";
  const DAN = "Dan.Donaldson@avemaria.edu";

  it("lets Daniel sign in and open Academic Affairs plus census", () => {
    assert.equal(canLogin(DANIEL), true);
    assert.equal(canAccessReport(DANIEL, "aspiredu"), true);
    assert.equal(canAccessReport(DANIEL, "enrollment"), false);
    assert.equal(canAccessReport(DANIEL, "census"), true);
    assert.equal(canAccessReport(DANIEL, "athletics"), false);
    assert.equal(canAccessReport(DANIEL, "housing"), false);
    assert.equal(canAccessReport(DANIEL, "institute"), false);
    assert.equal(canAccessReport(DANIEL, "advancement"), false);
    assert.equal(canAccessReport(DANIEL, "chapel"), false);
    assert.equal(canAccessReport(DANIEL, "points"), false);
    assert.equal(canAccessReport(DANIEL, "annunciation"), false);
    assert.equal(reportsForEmail(DANIEL).includes("aspiredu"), true);
    assert.deepEqual(reportsForEmail(DANIEL), ["census", "aspiredu", "majors"]);
  });

  it("does not grant aspiredu to a known non-grantee", () => {
    assert.equal(canAccessReport(DAN, "aspiredu"), false);
  });

  it("lets Michaelene open Academic Affairs and Advancement, not admin folders", () => {
    const email = "michaelene.hayward@avemaria.edu";
    assert.equal(canLogin(email), true);
    assert.equal(isAdmin(email), false);
    assert.equal(canAccessReport(email, "aspiredu"), true);
    assert.equal(canAccessReport(email, "advancement"), true);
    assert.equal(canAccessReport(email, "chapel"), true);
    assert.equal(canAccessReport(email, "enrollment"), false);
    assert.equal(canAccessReport(email, "census"), false);
    assert.equal(canAccessReport(email, "athletics"), false);
    assert.equal(canAccessReport(email, "athletics-coaching"), false);
    assert.equal(canAccessReport(email, "housing"), false);
    assert.equal(canAccessReport(email, "institute"), false);
    assert.equal(canAccessReport(email, "points"), false);
    assert.equal(canAccessReport(email, "portfolios"), false);
    assert.equal(canAccessReport(email, "annunciation"), false);
    assert.equal(needsMfaAtSignIn(email), true);
    assert.deepEqual(reportsForEmail(email), ["advancement", "chapel", "aspiredu", "ty-letters"]);
  });

  it("requires MFA at sign-in for Academic Affairs and coaching users", () => {
    assert.equal(needsMfaAtSignIn(DANIEL), true);
    assert.equal(needsMfaAtSignIn("michael.t.middendorf@avemaria.edu"), true);
    assert.equal(needsMfaAtSignIn("eric.vanheusen@avemaria.edu"), true);
    assert.equal(needsMfaAtSignIn("john.weisbrod@avemaria.edu"), true);
    assert.equal(needsMfaAtSignIn("elizabeth.feger@avemaria.edu"), true);
    assert.equal(needsMfaAtSignIn("joshua.lewis@avemaria.edu"), true);
    assert.equal(needsMfaAtSignIn(DAN), false);
    assert.equal(needsMfaAtSignIn("annie.esposito@avemaria.edu"), false);
    assert.equal(sessionDecisionAtComplete(DANIEL, false), "mfa_pending");
    assert.equal(sessionDecisionAtComplete(DANIEL, true), "mfa_pending");
    assert.equal(sessionDecisionAtComplete("eric.vanheusen@avemaria.edu", false), "mfa_pending");
    assert.equal(sessionDecisionAtComplete(DAN, false), "session");
    assert.equal(sessionDecisionAtComplete(DAN, true), "session");
  });
});

describe("Academic Affairs grant for Julie Musselman (DST-2907)", () => {
  const JULIE = "Julie.Musselman@avemaria.edu";

  it("adds Academic Affairs while preserving Julie's exact existing report set", () => {
    assert.equal(canLogin(JULIE), true);
    assert.equal(isAdmin(JULIE), false);
    assert.equal(canAccessReport(JULIE, "aspiredu"), true);
    assert.equal(canAccessReport(JULIE, "athletics-coaching"), false);
    assert.deepEqual(reportsForEmail(JULIE), [
      "advancement",
      "chapel",
      "portfolios",
      "annunciation",
      "aspiredu",
      "ty-letters",
      "gala",
    ]);
  });

  it("requires MFA on a new link even when Julie already has a session", () => {
    assert.equal(needsMfaAtSignIn(JULIE), true);
    assert.equal(sessionDecisionAtComplete(JULIE, false), "mfa_pending");
    assert.equal(sessionDecisionAtComplete(JULIE, true), "mfa_pending");
  });
});

describe("aspiredu grant for Maria Gomez", () => {
  const MARIA = "Maria.T.Gomez@avemaria.edu";

  it("lets Maria sign in and open Academic Affairs, not census", () => {
    assert.equal(canLogin(MARIA), true);
    assert.equal(canAccessReport(MARIA, "aspiredu"), true);
    assert.equal(canAccessReport(MARIA, "census"), false);
    assert.equal(canAccessReport(MARIA, "enrollment"), false);
    assert.equal(canAccessReport(MARIA, "athletics"), false);
    assert.equal(canAccessReport(MARIA, "housing"), false);
    assert.equal(canAccessReport(MARIA, "institute"), false);
    assert.equal(canAccessReport(MARIA, "advancement"), false);
    assert.equal(canAccessReport(MARIA, "chapel"), false);
    assert.equal(canAccessReport(MARIA, "points"), false);
    assert.equal(canAccessReport(MARIA, "annunciation"), false);
    assert.equal(reportsForEmail(MARIA).includes("aspiredu"), true);
    assert.deepEqual(reportsForEmail(MARIA), ["aspiredu"]);
  });
});

describe("aspiredu grant for Alexandra Baalman", () => {
  const ALEXANDRA = "Alexandra.R.Baalman@avemaria.edu";

  it("lets Alexandra sign in and open Academic Affairs, not census", () => {
    assert.equal(canLogin(ALEXANDRA), true);
    assert.equal(canAccessReport(ALEXANDRA, "aspiredu"), true);
    assert.equal(canAccessReport(ALEXANDRA, "census"), false);
    assert.equal(canAccessReport(ALEXANDRA, "enrollment"), false);
    assert.equal(canAccessReport(ALEXANDRA, "athletics"), false);
    assert.equal(canAccessReport(ALEXANDRA, "housing"), false);
    assert.equal(canAccessReport(ALEXANDRA, "institute"), false);
    assert.equal(canAccessReport(ALEXANDRA, "advancement"), false);
    assert.equal(canAccessReport(ALEXANDRA, "chapel"), false);
    assert.equal(canAccessReport(ALEXANDRA, "points"), false);
    assert.equal(canAccessReport(ALEXANDRA, "annunciation"), false);
    assert.equal(reportsForEmail(ALEXANDRA).includes("aspiredu"), true);
    assert.deepEqual(reportsForEmail(ALEXANDRA), ["aspiredu"]);
  });
});

describe("aspiredu grant for Richard Dittus (DST-3059)", () => {
  const RICHARD = "Richard.Dittus@avemaria.edu";

  it("lets Richard sign in and open Academic Affairs, not other reports", () => {
    assert.equal(canLogin(RICHARD), true);
    assert.equal(isAdmin(RICHARD), false);
    assert.equal(canAccessReport(RICHARD, "aspiredu"), true);
    assert.equal(canAccessReport(RICHARD, "census"), false);
    assert.equal(canAccessReport(RICHARD, "enrollment"), false);
    assert.equal(canAccessReport(RICHARD, "athletics"), false);
    assert.equal(canAccessReport(RICHARD, "housing"), false);
    assert.equal(canAccessReport(RICHARD, "institute"), false);
    assert.equal(canAccessReport(RICHARD, "advancement"), false);
    assert.equal(canAccessReport(RICHARD, "chapel"), false);
    assert.equal(canAccessReport(RICHARD, "points"), false);
    assert.equal(canAccessReport(RICHARD, "annunciation"), false);
    assert.deepEqual(reportsForEmail(RICHARD), ["aspiredu"]);
  });
});

describe("aspiredu grant for Jenifer LeCompte (DST-3059)", () => {
  const JENIFER = "Jenifer.LeCompte@avemaria.edu";

  it("lets Jenifer sign in and open Academic Affairs, not other reports", () => {
    assert.equal(canLogin(JENIFER), true);
    assert.equal(isAdmin(JENIFER), false);
    assert.equal(canAccessReport(JENIFER, "aspiredu"), true);
    assert.equal(canAccessReport(JENIFER, "census"), false);
    assert.equal(canAccessReport(JENIFER, "enrollment"), false);
    assert.equal(canAccessReport(JENIFER, "athletics"), false);
    assert.equal(canAccessReport(JENIFER, "housing"), false);
    assert.equal(canAccessReport(JENIFER, "institute"), false);
    assert.equal(canAccessReport(JENIFER, "advancement"), false);
    assert.equal(canAccessReport(JENIFER, "chapel"), false);
    assert.equal(canAccessReport(JENIFER, "points"), false);
    assert.equal(canAccessReport(JENIFER, "annunciation"), false);
    assert.deepEqual(reportsForEmail(JENIFER), ["aspiredu"]);
  });
});

describe("aspiredu grant for Diana Tsai (DST-3059)", () => {
  const DIANA = "Diana.Tsai@avemaria.edu";

  it("lets Diana sign in and open Academic Affairs, not other reports", () => {
    assert.equal(canLogin(DIANA), true);
    assert.equal(isAdmin(DIANA), false);
    assert.equal(canAccessReport(DIANA, "aspiredu"), true);
    assert.equal(canAccessReport(DIANA, "census"), false);
    assert.equal(canAccessReport(DIANA, "enrollment"), false);
    assert.equal(canAccessReport(DIANA, "athletics"), false);
    assert.equal(canAccessReport(DIANA, "housing"), false);
    assert.equal(canAccessReport(DIANA, "institute"), false);
    assert.equal(canAccessReport(DIANA, "advancement"), false);
    assert.equal(canAccessReport(DIANA, "chapel"), false);
    assert.equal(canAccessReport(DIANA, "points"), false);
    assert.equal(canAccessReport(DIANA, "annunciation"), false);
    assert.deepEqual(reportsForEmail(DIANA), ["aspiredu"]);
  });
});

describe("Fall Appeal viewers", () => {
  const people = [
    "cassandra.l.bournos@avemaria.edu",
    "zena.weist@avemaria.edu",
    "sarah.chichester@avemaria.edu",
  ];

  it("lets Cassandra, Zena, and Sarah open Advancement reports including Fall Appeal", () => {
    for (const email of people) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "advancement"), true, email);
      assert.equal(canAccessReport(email, "portfolios"), false, email);
    }
  });
});

describe("full Advancement grants", () => {
  const people = [
    "Leslie.Sonnen@avemaria.edu",
    "Julie.Musselman@avemaria.edu",
    "Jim.Thomas@avemaria.edu",
    "Becca.Kennedy@avemaria.edu",
  ];

  it("lets Leslie, Julie, Jim, and Becca sign in to every Advancement report", () => {
    for (const email of people) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "advancement"), true, email);
      assert.equal(canAccessReport(email, "chapel"), true, email);
      assert.equal(canAccessReport(email, "annunciation"), true, email);
      assert.equal(canAccessReport(email, "enrollment"), false, email);
    }
  });

  it("gives Leslie MA Points and portfolios in addition to Advancement", () => {
    const leslie = "Leslie.Sonnen@avemaria.edu";
    assert.equal(canAccessReport(leslie, "points"), true);
    assert.equal(canAccessReport(leslie, "portfolios"), true);
    assert.deepEqual(reportsForEmail(leslie), [
      "advancement",
      "chapel",
      "points",
      "portfolios",
      "annunciation",
      "mgo-analysis",
      "gala",
    ]);
  });

  it("gives Jim and Julie portfolios with Advancement, not MA Points", () => {
    for (const email of ["Julie.Musselman@avemaria.edu", "Jim.Thomas@avemaria.edu"]) {
      assert.equal(canAccessReport(email, "points"), false, email);
      assert.equal(canAccessReport(email, "portfolios"), true, email);
      assert.equal(canAccessReport(email, "housing"), false, email);
      assert.equal(canAccessReport(email, "census"), false, email);
    }
    assert.deepEqual(reportsForEmail("Julie.Musselman@avemaria.edu"), [
      "advancement",
      "chapel",
      "portfolios",
      "annunciation",
      "aspiredu",
      "ty-letters",
      "gala",
    ]);
    assert.deepEqual(reportsForEmail("Jim.Thomas@avemaria.edu"), [
      "advancement",
      "chapel",
      "portfolios",
      "annunciation",
      "mgo-analysis",
      "ty-letters",
    ]);
  });
});

describe("MGO Analysis grant (DST-2830)", () => {
  it("lets Leslie and Jim open MGO Analysis", () => {
    for (const email of ["Leslie.Sonnen@avemaria.edu", "jim.thomas@avemaria.edu"]) {
      assert.equal(canAccessReport(email, "mgo-analysis"), true, email);
      assert.equal(canLogin(email), true, email);
    }
  });

  it("keeps other Advancement users out", () => {
    for (const email of [
      "julie.musselman@avemaria.edu",
      "becca.kennedy@avemaria.edu",
      "zena.weist@avemaria.edu",
    ]) {
      assert.equal(canAccessReport(email, "advancement"), true, email);
      assert.equal(canAccessReport(email, "mgo-analysis"), false, email);
    }
    assert.equal(canAccessReport("annie.esposito@avemaria.edu", "mgo-analysis"), false);
  });

  it("lets hub admins open MGO Analysis", () => {
    assert.equal(canAccessReport("michael.t.middendorf@avemaria.edu", "mgo-analysis"), true);
    assert.equal(canAccessReport("cole.j.cantu@avemaria.edu", "mgo-analysis"), true);
  });

  it("does not promote Becca to MA Points, portfolios, or other folders", () => {
    const email = "Becca.Kennedy@avemaria.edu";
    assert.equal(canAccessReport(email, "points"), false);
    assert.equal(canAccessReport(email, "portfolios"), false);
    assert.equal(canAccessReport(email, "housing"), false);
    assert.equal(canAccessReport(email, "census"), false);
    assert.deepEqual(reportsForEmail(email), ["advancement", "chapel", "annunciation"]);
  });

  it("does not promote Leslie to housing, census, or other folders", () => {
    const leslie = "Leslie.Sonnen@avemaria.edu";
    assert.equal(canAccessReport(leslie, "housing"), false);
    assert.equal(canAccessReport(leslie, "census"), false);
    assert.equal(canAccessReport(leslie, "enrollment"), false);
    assert.equal(canAccessReport(leslie, "athletics"), false);
    assert.equal(canAccessReport(leslie, "athletics-coaching"), false);
  });
});

describe("marketing (Pursuit of Wisdom) grant for Camille Kaczanowski", () => {
  const CAMILLE = "CamilleC.Kaczanowski@avemaria.edu";

  it("lets Camille sign in and open Marketing (POW) only", () => {
    assert.equal(canLogin(CAMILLE), true);
    assert.equal(isAdmin(CAMILLE), false);
    assert.equal(canAccessReport(CAMILLE, "marketing"), true);
    assert.equal(canAccessReport(CAMILLE, "enrollment"), false);
    assert.equal(canAccessReport(CAMILLE, "census"), false);
    assert.equal(canAccessReport(CAMILLE, "athletics"), false);
    assert.equal(canAccessReport(CAMILLE, "athletics-coaching"), false);
    assert.equal(canAccessReport(CAMILLE, "housing"), false);
    assert.equal(canAccessReport(CAMILLE, "institute"), false);
    assert.equal(canAccessReport(CAMILLE, "advancement"), false);
    assert.equal(canAccessReport(CAMILLE, "chapel"), false);
    assert.equal(canAccessReport(CAMILLE, "points"), false);
    assert.equal(canAccessReport(CAMILLE, "portfolios"), false);
    assert.equal(canAccessReport(CAMILLE, "annunciation"), false);
    assert.equal(canAccessReport(CAMILLE, "aspiredu"), false);
    assert.equal(canAccessReport(CAMILLE, "business-office"), false);
    assert.equal(canAccessReport(CAMILLE, "cybersecurity"), false);
    assert.equal(needsMfaAtSignIn(CAMILLE), false);
    assert.deepEqual(reportsForEmail(CAMILLE), ["marketing"]);
  });
});

describe("majors (DST-3015 Majors and Minors) grant", () => {
  const LISTED = [
    "Roger.Nutt@avemaria.edu",
    "daniel.schreck@avemaria.edu",
    "adam.kinnick@avemaria.edu",
    "seana.mcguire@avemaria.edu",
    "dan.donaldson@avemaria.edu",
    "daniel.davy@avemaria.edu",
    "susan.gallagher@avemaria.edu",
    "steve.logan@avemaria.edu",
  ];

  it("lets Roger Nutt and the rest of the list open majors", () => {
    assert.equal(canAccessReport("roger.nutt@avemaria.edu", "majors"), true);
    for (const email of LISTED) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "majors"), true, email);
      assert.equal(isAdmin(email), false, email);
    }
  });

  it("keeps a non-listed email out", () => {
    for (const email of ["camillec.kaczanowski@avemaria.edu", "luke.fier@avemaria.edu", "someone@avemaria.edu", "roger.nutt@my.avemaria.edu"]) {
      assert.equal(canAccessReport(email, "majors"), false, email);
    }
  });

  it("keeps Joseph Patterson off majors (DST-3015: removed, athletics access unchanged)", () => {
    assert.equal(canAccessReport("joseph.patterson@avemaria.edu", "majors"), false);
  });

  it("gives hub admins majors and is not a strict report", () => {
    assert.equal(canAccessReport("cole.j.cantu@avemaria.edu", "majors"), true);
    assert.equal(isStrictReport("majors"), false);
  });

  it("merges MAJORS_ALLOWED_EMAILS additively", () => {
    const prev = process.env.MAJORS_ALLOWED_EMAILS;
    process.env.MAJORS_ALLOWED_EMAILS = "new.person@avemaria.edu";
    try {
      assert.equal(canAccessReport("new.person@avemaria.edu", "majors"), true);
      assert.equal(canAccessReport("roger.nutt@avemaria.edu", "majors"), true);
    } finally {
      if (prev === undefined) delete process.env.MAJORS_ALLOWED_EMAILS;
      else process.env.MAJORS_ALLOWED_EMAILS = prev;
    }
  });

  it("does not add majors-only people to MFA at sign-in", () => {
    assert.equal(needsMfaAtSignIn("roger.nutt@avemaria.edu"), false);
  });
});

describe("ty-letters (DST-3062 thank-you letter donor cards) strict grant", () => {
  const LISTED = [
    "julie.musselman@avemaria.edu",
    "Michaelene.Hayward@avemaria.edu",
    "mark.middendorf@avemaria.edu",
    "jim.thomas@avemaria.edu",
    "michael.t.middendorf@avemaria.edu",
  ];
  it("lets in exactly the five listed people", () => {
    for (const email of LISTED) assert.equal(canAccessReport(email, "ty-letters"), true, email);
  });
  it("keeps out hub admins Cole and Regina", () => {
    assert.equal(canAccessReport("cole.j.cantu@avemaria.edu", "ty-letters"), false);
    assert.equal(canAccessReport("regina.m.pirolli@avemaria.edu", "ty-letters"), false);
  });
  it("keeps out other Advancement users", () => {
    for (const email of [
      "becca.kennedy@avemaria.edu",
      "leslie.sonnen@avemaria.edu",
      "cassandra.l.bournos@avemaria.edu",
      "Robert.Musselman@avemaria.edu",
    ]) {
      assert.equal(canAccessReport(email, "ty-letters"), false, email);
    }
  });
  it("ignores the env var path", () => {
    const prev = process.env.ADVANCEMENT_ALLOWED_EMAILS;
    process.env.ADVANCEMENT_ALLOWED_EMAILS = "outsider@avemaria.edu";
    try {
      assert.equal(canAccessReport("outsider@avemaria.edu", "ty-letters"), false);
    } finally {
      if (prev === undefined) delete process.env.ADVANCEMENT_ALLOWED_EMAILS;
      else process.env.ADVANCEMENT_ALLOWED_EMAILS = prev;
    }
  });
});

describe("gala (DST-3095 Chancellor's Gala) strict grant", () => {
  const LISTED = [
    "zena.weist@avemaria.edu",
    "Susan.Gallagher@avemaria.edu",
    "mark.middendorf@avemaria.edu",
    "leslie.sonnen@avemaria.edu",
    "stephanie.hayner@avemaria.edu",
    "julie.musselman@avemaria.edu",
    "michael.t.middendorf@avemaria.edu",
    "cole.j.cantu@avemaria.edu",
    "regina.m.pirolli@avemaria.edu",
  ];
  it("lets in exactly the nine listed people", () => {
    for (const email of LISTED) {
      assert.equal(canAccessReport(email, "gala"), true, email);
      assert.equal(reportsForEmail(email).includes("gala"), true, email);
    }
    assert.equal(STRICT_REPORTS.gala?.length, 9);
    assert.equal(isStrictReport("gala"), true);
  });
  it("keeps out other Advancement users and non-AMU-staff addresses", () => {
    for (const email of [
      "becca.kennedy@avemaria.edu",
      "jim.thomas@avemaria.edu",
      "cassandra.l.bournos@avemaria.edu",
      "michaelene.hayward@avemaria.edu",
      "zena.weist@my.avemaria.edu",
      "outsider@avemaria.edu",
    ]) {
      assert.equal(canAccessReport(email, "gala"), false, email);
    }
  });
  it("ignores the env var path", () => {
    const prev = process.env.ADVANCEMENT_ALLOWED_EMAILS;
    process.env.ADVANCEMENT_ALLOWED_EMAILS = "outsider@avemaria.edu";
    try {
      assert.equal(canAccessReport("outsider@avemaria.edu", "gala"), false);
    } finally {
      if (prev === undefined) delete process.env.ADVANCEMENT_ALLOWED_EMAILS;
      else process.env.ADVANCEMENT_ALLOWED_EMAILS = prev;
    }
  });
  it("does not add MFA at sign-in", () => {
    assert.equal(needsMfaAtSignIn("stephanie.hayner@avemaria.edu"), false);
  });
});
