import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPORT_IDS,
  canAccessReport,
  canLogin,
  isAdmin,
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

  it("lets an MA sign in to portfolios only", () => {
    const alanna = "alanna.f.mccann@avemaria.edu";
    assert.equal(canLogin(alanna), true);
    assert.equal(canAccessReport(alanna, "portfolios"), true);
    assert.equal(canAccessReport(alanna, "advancement"), false);
    assert.deepEqual(reportsForEmail(alanna), ["portfolios"]);
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

  it("lets Eric sign in and open Athletics Master and coaching only", () => {
    assert.equal(canLogin(ERIC), true);
    assert.equal(canAccessReport(ERIC, "athletics"), true);
    assert.equal(canAccessReport(ERIC, "athletics-coaching"), true);
    assert.equal(canAccessReport(ERIC, "enrollment"), false);
    assert.equal(canAccessReport(ERIC, "census"), false);
    assert.equal(canAccessReport(ERIC, "housing"), false);
    assert.equal(canAccessReport(ERIC, "institute"), false);
    assert.equal(canAccessReport(ERIC, "advancement"), false);
    assert.equal(canAccessReport(ERIC, "chapel"), false);
    assert.equal(canAccessReport(ERIC, "points"), false);
    assert.equal(canAccessReport(ERIC, "portfolios"), false);
    assert.equal(canAccessReport(ERIC, "annunciation"), false);
    assert.equal(canAccessReport(ERIC, "aspiredu"), false);
    assert.deepEqual(reportsForEmail(ERIC), ["athletics", "athletics-coaching"]);
  });

  it("lets Feger and Weisbrod open every Athletics department report", () => {
    for (const email of ["Elizabeth.Feger@avemaria.edu", "John.Weisbrod@avemaria.edu"]) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "athletics"), true, email);
      assert.equal(canAccessReport(email, "athletics-coaching"), true, email);
      assert.equal(canAccessAthleticsGiving(email), true, email);
      assert.equal(canAccessReport(email, "enrollment"), false, email);
      assert.deepEqual(reportsForEmail(email), ["athletics", "athletics-coaching"], email);
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
      ["alan.webb@avemaria.edu", ["cross-country", "track-and-field"]],
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
    assert.deepEqual(reportsForEmail(DAN), ["enrollment", "housing"]);
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
    assert.deepEqual(reportsForEmail(DANIEL), ["census", "aspiredu"]);
  });

  it("does not grant aspiredu to a known non-grantee", () => {
    assert.equal(canAccessReport(DAN, "aspiredu"), false);
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
    ]);
  });

  it("gives Jim and Julie portfolios with Advancement, not MA Points", () => {
    for (const email of ["Julie.Musselman@avemaria.edu", "Jim.Thomas@avemaria.edu"]) {
      assert.equal(canAccessReport(email, "points"), false, email);
      assert.equal(canAccessReport(email, "portfolios"), true, email);
      assert.equal(canAccessReport(email, "housing"), false, email);
      assert.equal(canAccessReport(email, "census"), false, email);
      assert.deepEqual(
        reportsForEmail(email),
        ["advancement", "chapel", "portfolios", "annunciation"],
        email,
      );
    }
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
