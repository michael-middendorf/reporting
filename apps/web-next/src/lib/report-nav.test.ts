import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADVANCEMENT_NAV,
  ASPIREDU_NAV,
  ATHLETICS_NAV,
  ENROLLMENT_NAV,
  POINTS_NAV,
  isDepartmentHub,
  navForReports,
  reportCrumbs,
  reportNavActive,
  type ReportNavItem,
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
    const ac = item(ADVANCEMENT_NAV, "/annunciation");
    const fall = item(ADVANCEMENT_NAV, "/advancement/fall-appeal");
    const points = item(ADVANCEMENT_NAV, "/advancement/points");
    const method = item(ADVANCEMENT_NAV, "/advancement/points/methodology");
    const glass = item(ADVANCEMENT_NAV, "/advancement/stained-glass-windows");
    const athGiving = item(ADVANCEMENT_NAV, "/athletics/giving");
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/advancement/overview"), true);
    assert.equal(reportNavActive(mgo, ADVANCEMENT_NAV, "/advancement/mgo-top-prospects"), true);
    assert.equal(reportNavActive(ac, ADVANCEMENT_NAV, "/annunciation"), true);
    assert.equal(reportNavActive(fall, ADVANCEMENT_NAV, "/advancement/fall-appeal"), true);
    assert.equal(reportNavActive(points, ADVANCEMENT_NAV, "/advancement/points"), true);
    assert.equal(reportNavActive(points, ADVANCEMENT_NAV, "/advancement/points/methodology"), false);
    assert.equal(reportNavActive(method, ADVANCEMENT_NAV, "/advancement/points/methodology"), true);
    assert.equal(reportNavActive(glass, ADVANCEMENT_NAV, "/advancement/stained-glass-windows"), true);
    assert.equal(overview.report, "advancement");
    assert.equal(fall.report, "advancement");
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
      ["/advancement/points", "/advancement/points/methodology"],
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

  it("keeps Enrollment Overview exact so nested pages stay distinct", () => {
    const overview = item(ENROLLMENT_NAV, "/enrollment");
    const admissions = item(ENROLLMENT_NAV, "/enrollment/admissions");
    assert.equal(reportNavActive(overview, ENROLLMENT_NAV, "/enrollment"), true);
    assert.equal(reportNavActive(overview, ENROLLMENT_NAV, "/enrollment/admissions"), false);
    assert.equal(reportNavActive(admissions, ENROLLMENT_NAV, "/enrollment/admissions"), true);
    assert.equal(reportNavActive(overview, ENROLLMENT_NAV, "/enrollment/activity"), false);
  });

  it("does not let parent Points/AspireDU tabs steal child routes", () => {
    const dash = item(POINTS_NAV, "/advancement/points");
    const method = item(POINTS_NAV, "/advancement/points/methodology");
    const summary = item(ASPIREDU_NAV, "/aspiredu");
    const students = item(ASPIREDU_NAV, "/aspiredu/students");
    const fall = item(ASPIREDU_NAV, "/aspiredu/provisional/fall");
    const athletics = item(ASPIREDU_NAV, "/aspiredu/provisional/athletics");
    const springEot = item(ASPIREDU_NAV, "/aspiredu/eot/spring");
    assert.equal(reportNavActive(dash, POINTS_NAV, "/advancement/points"), true);
    assert.equal(reportNavActive(dash, POINTS_NAV, "/advancement/points/methodology"), false);
    assert.equal(reportNavActive(method, POINTS_NAV, "/advancement/points/methodology"), true);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu"), true);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu/students"), false);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu/provisional/athletics"), false);
    assert.equal(reportNavActive(students, ASPIREDU_NAV, "/aspiredu/students"), true);
    assert.equal(reportNavActive(fall, ASPIREDU_NAV, "/aspiredu/provisional/fall"), true);
    assert.equal(reportNavActive(athletics, ASPIREDU_NAV, "/aspiredu/provisional/athletics"), true);
    assert.equal(fall.label, "Fall Athletic Provisional");
    assert.equal(athletics.label, "Athletics Provisional");
    assert.equal(reportNavActive(springEot, ASPIREDU_NAV, "/aspiredu/eot/spring"), true);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu/eot/spring"), false);
    assert.equal(springEot.label, "Spring EOT Grade Report");
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
      { href: "/advancement/points/methodology", label: "Points Methodology" },
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
    assert.deepEqual(reportCrumbs("/aspiredu/students"), [
      { href: "/", label: "Reports" },
      { href: "/aspiredu", label: "Academic Affairs" },
      { href: "/aspiredu/students", label: "Student follow-up" },
    ]);
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
    assert.deepEqual(reportCrumbs("/athletics/giving"), [
      { href: "/", label: "Reports" },
      { href: "/athletics", label: "Athletics" },
      { href: "/athletics/giving", label: "Giving" },
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
    assert.equal(isDepartmentHub("/annunciation"), false);
  });

  it("keeps tabs when the folder URL is itself a report (Enrollment)", () => {
    assert.equal(isDepartmentHub("/enrollment"), false);
    assert.equal(isDepartmentHub("/enrollment/admissions"), false);
    assert.equal(isDepartmentHub("/aspiredu"), false);
  });

  it("hides tabs on the Athletics department hub", () => {
    assert.equal(isDepartmentHub("/athletics"), true);
    assert.equal(isDepartmentHub("/athletics/master"), false);
    assert.equal(isDepartmentHub("/athletics/master/recruiting"), false);
    assert.equal(isDepartmentHub("/athletics/coaching"), false);
    assert.equal(isDepartmentHub("/athletics/coaching/overview"), false);
  });
});
