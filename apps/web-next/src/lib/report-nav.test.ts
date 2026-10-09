import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADVANCEMENT_NAV,
  ASPIREDU_NAV,
  ATHLETICS_NAV,
  BUSINESS_OFFICE_NAV,
  ENROLLMENT_NAV,
  POINTS_NAV,
  isDepartmentHub,
  navForReports,
  reportCrumbs,
  reportNavActive,
  type ReportNavItem,
  withCurrentLabel,
} from "./report-nav";

function item(nav: ReportNavItem[], href: string): ReportNavItem {
  const found = nav.find((n) => n.href === href);
  assert.ok(found, href);
  return found;
}

describe("reportNavActive", () => {
  it("marks Advancement nested reports and Annunciation", () => {
    const overview = item(ADVANCEMENT_NAV, "/advancement/overview");
    const mgo = item(ADVANCEMENT_NAV, "/advancement/mgo-top-prospects");
    const pipeline = item(ADVANCEMENT_NAV, "/advancement/pipeline");
    const ac = item(ADVANCEMENT_NAV, "/annunciation");
    const fall = item(ADVANCEMENT_NAV, "/advancement/appeals?campaign=fall-2026");
    const yearEnd = item(ADVANCEMENT_NAV, "/advancement/year-end-appeal");
    const points = item(ADVANCEMENT_NAV, "/advancement/points");
    const glass = item(ADVANCEMENT_NAV, "/advancement/stained-glass-windows");
    const athGiving = item(ADVANCEMENT_NAV, "/athletics/master/giving");
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/advancement/overview"), true);
    assert.equal(reportNavActive(mgo, ADVANCEMENT_NAV, "/advancement/mgo-top-prospects"), true);
    assert.equal(reportNavActive(ac, ADVANCEMENT_NAV, "/annunciation"), true);
    assert.equal(reportNavActive(fall, ADVANCEMENT_NAV, "/advancement/appeals"), true);
    assert.equal(reportNavActive(yearEnd, ADVANCEMENT_NAV, "/advancement/year-end-appeal"), true);
    assert.equal(reportNavActive(fall, ADVANCEMENT_NAV, "/advancement/year-end-appeal"), false);
    assert.equal(reportNavActive(yearEnd, ADVANCEMENT_NAV, "/advancement/appeals"), false);
    assert.equal(reportNavActive(points, ADVANCEMENT_NAV, "/advancement/points"), true);
    assert.equal(reportNavActive(points, ADVANCEMENT_NAV, "/advancement/points/methodology"), true);
    assert.equal(reportNavActive(glass, ADVANCEMENT_NAV, "/advancement/stained-glass-windows"), true);
    assert.equal(reportNavActive(pipeline, ADVANCEMENT_NAV, "/advancement/pipeline"), true);
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/advancement/pipeline"), false);
    assert.equal(pipeline.report, "advancement");
    assert.equal(overview.report, "advancement");
    assert.equal(fall.report, "advancement");
    assert.equal(yearEnd.report, "advancement");
    assert.equal(yearEnd.label, "Year-End Appeal");
    assert.equal(points.report, "points");
    assert.equal(glass.report, "chapel");
    assert.equal(athGiving.report, "advancement");
    assert.equal(athGiving.label, "Athletics Giving");
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/advancement"), false);
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/annunciation"), false);
  });

  it("hides MA Points tabs unless the user has the points report", () => {
    const advancementOnly = navForReports(ADVANCEMENT_NAV, ["advancement", "chapel", "annunciation"]);
    assert.equal(advancementOnly.some((n) => n.href === "/advancement/points"), false);
    const pointsOnly = navForReports(ADVANCEMENT_NAV, ["points"]);
    assert.deepEqual(
      pointsOnly.map((n) => n.href),
      ["/advancement/points"],
    );
  });

  it("hides Portfolios unless the user has the portfolios report", () => {
    const advancementOnly = navForReports(ADVANCEMENT_NAV, ["advancement", "chapel", "annunciation"]);
    assert.equal(advancementOnly.some((n) => n.href === "/advancement/portfolios"), false);
    const pointsOnly = navForReports(ADVANCEMENT_NAV, ["points"]);
    assert.equal(pointsOnly.some((n) => n.href === "/advancement/portfolios"), false);
    const portfoliosOnly = navForReports(ADVANCEMENT_NAV, ["portfolios"]);
    assert.deepEqual(
      portfoliosOnly.map((n) => n.href),
      ["/advancement/portfolios"],
    );
  });

  it("shows MGO Analysis only to users with the mgo-analysis report", () => {
    const mga = item(ADVANCEMENT_NAV, "/advancement/mgo-analysis");
    assert.equal(mga.report, "mgo-analysis");
    assert.equal(mga.label, "MGO Analysis");
    assert.equal(reportNavActive(mga, ADVANCEMENT_NAV, "/advancement/mgo-analysis"), true);
    const mgo = item(ADVANCEMENT_NAV, "/advancement/mgo-top-prospects");
    assert.equal(reportNavActive(mgo, ADVANCEMENT_NAV, "/advancement/mgo-analysis"), false);
    const advancementOnly = navForReports(ADVANCEMENT_NAV, ["advancement", "chapel", "annunciation"]);
    assert.equal(advancementOnly.some((n) => n.href === "/advancement/mgo-analysis"), false);
    const leslie = navForReports(ADVANCEMENT_NAV, ["advancement", "chapel", "points", "portfolios", "annunciation", "mgo-analysis"]);
    assert.equal(leslie.some((n) => n.href === "/advancement/mgo-analysis"), true);
    assert.deepEqual(reportCrumbs("/advancement/mgo-analysis"), [
      { href: "/", label: "Reports" },
      { href: "/advancement", label: "Advancement" },
      { href: "/advancement/mgo-analysis", label: "MGO Analysis" },
    ]);
  });

  it("keeps Enrollment Overview exact so nested pages stay distinct", () => {
    const overview = item(ENROLLMENT_NAV, "/enrollment");
    const admissions = item(ENROLLMENT_NAV, "/enrollment/admissions");
    assert.equal(reportNavActive(overview, ENROLLMENT_NAV, "/enrollment"), true);
    assert.equal(reportNavActive(overview, ENROLLMENT_NAV, "/enrollment/admissions"), false);
    assert.equal(reportNavActive(admissions, ENROLLMENT_NAV, "/enrollment/admissions"), true);
    assert.equal(reportNavActive(overview, ENROLLMENT_NAV, "/enrollment/activity"), false);
  });

  it("does not let parent Points tabs steal child routes", () => {
    const dash = item(POINTS_NAV, "/advancement/points");
    const method = item(POINTS_NAV, "/advancement/points/methodology");
    assert.equal(reportNavActive(dash, POINTS_NAV, "/advancement/points"), true);
    assert.equal(reportNavActive(dash, POINTS_NAV, "/advancement/points/methodology"), false);
    assert.equal(reportNavActive(method, POINTS_NAV, "/advancement/points/methodology"), true);
  });

  it("gives Academic Affairs no tab strip (one Students page)", () => {
    assert.deepEqual(ASPIREDU_NAV, []);
  });
});

describe("reportCrumbs", () => {
  it("builds Reports / folder / dashboard trails", () => {
    assert.deepEqual(reportCrumbs("/"), [{ href: "/", label: "Reports" }]);
    assert.deepEqual(reportCrumbs("/advancement"), [
      { href: "/", label: "Reports" },
      { href: "/advancement", label: "Advancement" },
    ]);
    assert.deepEqual(reportCrumbs("/advancement/points"), [
      { href: "/", label: "Reports" },
      { href: "/advancement", label: "Advancement" },
      { href: "/advancement/points", label: "MA Points" },
    ]);
    assert.deepEqual(reportCrumbs("/advancement/points/methodology"), [
      { href: "/", label: "Reports" },
      { href: "/advancement", label: "Advancement" },
      { href: "/advancement/points", label: "MA Points" },
      { href: "/advancement/points/methodology", label: "Methodology" },
    ]);
    assert.deepEqual(reportCrumbs("/annunciation"), [
      { href: "/", label: "Reports" },
      { href: "/advancement", label: "Advancement" },
      { href: "/annunciation", label: "Annunciation Circle" },
    ]);
  });

  it("covers Enrollment, Academic Affairs, and single-report folders", () => {
    assert.deepEqual(reportCrumbs("/enrollment"), [
      { href: "/", label: "Reports" },
      { href: "/enrollment", label: "Enrollment" },
    ]);
    assert.deepEqual(reportCrumbs("/enrollment/admissions"), [
      { href: "/", label: "Reports" },
      { href: "/enrollment", label: "Enrollment" },
      { href: "/enrollment/admissions", label: "Admissions" },
    ]);
    assert.deepEqual(reportCrumbs("/aspiredu"), [
      { href: "/", label: "Reports" },
      { href: "/aspiredu", label: "Academic Affairs" },
    ]);
    // DST-3015: its own folder, so the crumb never links majors-only users to /aspiredu.
    assert.deepEqual(reportCrumbs("/majors"), [
      { href: "/", label: "Reports" },
      { href: "/majors", label: "Majors and Minors" },
    ]);
    // A profile crumb goes straight back to /aspiredu (the page swaps in the name).
    assert.deepEqual(reportCrumbs("/aspiredu/students/Uz27vGaesOsAbCdEfGhIjKlICN4U").slice(0, 2), [
      { href: "/", label: "Reports" },
      { href: "/aspiredu", label: "Academic Affairs" },
    ]);
    assert.equal(reportCrumbs("/aspiredu/students/Uz27vGaesOsAbCdEfGhIjKlICN4U").length, 3);
    assert.deepEqual(reportCrumbs("/aspiredu/mfa"), [
      { href: "/", label: "Reports" },
      { href: "/aspiredu", label: "Academic Affairs" },
      { href: "/aspiredu/mfa", label: "Authenticator" },
    ]);
    assert.deepEqual(reportCrumbs("/auth/mfa"), [
      { href: "/", label: "Reports" },
      { href: "/auth/mfa", label: "Authenticator" },
    ]);
    assert.deepEqual(reportCrumbs("/settings/security"), [
      { href: "/", label: "Reports" },
      { href: "/settings/security", label: "Security" },
    ]);
    assert.deepEqual(reportCrumbs("/housing"), [
      { href: "/", label: "Reports" },
      { href: "/housing", label: "Housing" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master/overview"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
      { href: "/athletics/master/overview", label: "Overview" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master/overview/ultimate-frisbee"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
      { href: "/athletics/master/overview", label: "Overview" },
      { href: "/athletics/master/overview/ultimate-frisbee", label: "Ultimate Frisbee" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master/recruiting"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
      { href: "/athletics/master/recruiting", label: "Recruiting" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master/recruiting/sectors"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
      { href: "/athletics/master/recruiting", label: "Recruiting" },
      { href: "/athletics/master/recruiting/sectors", label: "Sector Boards" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master/rosters"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
      { href: "/athletics/master/rosters", label: "Rosters" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master/eligibility"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
      { href: "/athletics/master/eligibility", label: "Eligibility" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/master/giving"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/master", label: "Master" },
      { href: "/athletics/master/giving", label: "Giving" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/coaching"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/coaching", label: "Coaching" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/coaching/overview"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/coaching", label: "Coaching" },
      { href: "/athletics/coaching/overview", label: "Overview" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/coaching/mens-soccer"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/coaching", label: "Coaching" },
      { href: "/athletics/coaching/mens-soccer", label: "Men's Soccer" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/coaching/ultimate-frisbee/academics"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/coaching", label: "Coaching" },
      { href: "/athletics/coaching/ultimate-frisbee", label: "Ultimate Frisbee" },
      { href: "/athletics/coaching/ultimate-frisbee/academics", label: "Academics" },
    ]);
    assert.deepEqual(reportCrumbs("/athletics/coaching/mfa"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/coaching", label: "Coaching" },
      { href: "/athletics/coaching/mfa", label: "Authenticator" },
    ]);
  });
});

describe("isDepartmentHub", () => {
  it("hides tabs on Advancement hub but not on a report inside it", () => {
    assert.equal(isDepartmentHub("/advancement"), true);
    assert.equal(isDepartmentHub("/advancement/fall-appeal"), false);
    assert.equal(isDepartmentHub("/advancement/year-end-appeal"), false);
    assert.equal(isDepartmentHub("/annunciation"), false);
  });

  it("keeps tabs when the folder URL is itself a report (Enrollment)", () => {
    assert.equal(isDepartmentHub("/enrollment"), false);
    assert.equal(isDepartmentHub("/enrollment/admissions"), false);
  });

  it("hides tabs on Academic Affairs, which has no nav", () => {
    // Only AccessGate reads this; with an empty nav it just means "no tab strip".
    assert.equal(isDepartmentHub("/aspiredu"), true);
    assert.equal(isDepartmentHub("/aspiredu/students/Uz27vGaesOsAbCdEfGhIjKlICN4U"), false);
  });

  it("hides tabs on the Athletics department hub", () => {
    assert.equal(isDepartmentHub("/athletics"), true);
    assert.equal(isDepartmentHub("/athletics/master"), false);
    assert.equal(isDepartmentHub("/athletics/master/recruiting"), false);
    assert.equal(isDepartmentHub("/athletics/coaching"), false);
    assert.equal(isDepartmentHub("/athletics/coaching/overview"), false);
  });
});

describe("withCurrentLabel", () => {
  it("replaces only the last crumb label and leaves other pages alone", () => {
    const crumbs = reportCrumbs("/aspiredu/students/Uz27vGaesOsAbCdEfGhIjKlICN4U");
    const named = withCurrentLabel(crumbs, "Test Student");
    assert.equal(named.length, crumbs.length);
    assert.equal(named.at(-1)?.label, "Test Student");
    assert.equal(named.at(-1)?.href, crumbs.at(-1)?.href);
    assert.deepEqual(named.slice(0, -1), crumbs.slice(0, -1));
    assert.equal(withCurrentLabel(crumbs, undefined), crumbs);
    assert.equal(withCurrentLabel(crumbs, ""), crumbs);
  });
});

describe("Business Office nav (DST-2983)", () => {
  it("shows the Athletics tab only with the business-office report", () => {
    assert.deepEqual(
      navForReports(BUSINESS_OFFICE_NAV, ["business-office"]).map((n) => n.href),
      ["/business-office/athletics"],
    );
    assert.deepEqual(navForReports(BUSINESS_OFFICE_NAV, ["athletics-coaching"]), []);
  });

  it("labels team pages with the sport name", () => {
    assert.deepEqual(
      reportCrumbs("/business-office/athletics/mens-basketball").map((c) => c.label),
      ["Reports", "Business Office", "Athletics", "Men's Basketball"],
    );
    assert.equal(isDepartmentHub("/business-office"), true);
  });
});
