import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADVANCEMENT_NAV,
  ASPIREDU_NAV,
  ENROLLMENT_NAV,
  POINTS_NAV,
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
    const glass = item(ADVANCEMENT_NAV, "/advancement/stained-glass-windows");
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/advancement/overview"), true);
    assert.equal(reportNavActive(mgo, ADVANCEMENT_NAV, "/advancement/mgo-top-prospects"), true);
    assert.equal(reportNavActive(ac, ADVANCEMENT_NAV, "/annunciation"), true);
    assert.equal(reportNavActive(glass, ADVANCEMENT_NAV, "/advancement/stained-glass-windows"), true);
    assert.equal(overview.report, "advancement");
    assert.equal(glass.report, "chapel");
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/advancement"), false);
    assert.equal(reportNavActive(overview, ADVANCEMENT_NAV, "/annunciation"), false);
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
    const dash = item(POINTS_NAV, "/points");
    const method = item(POINTS_NAV, "/points/methodology");
    const summary = item(ASPIREDU_NAV, "/aspiredu");
    const students = item(ASPIREDU_NAV, "/aspiredu/students");
    const summer = item(ASPIREDU_NAV, "/aspiredu/provisional/summer-1");
    const athletics = item(ASPIREDU_NAV, "/aspiredu/provisional/athletics");
    const springEot = item(ASPIREDU_NAV, "/aspiredu/eot/spring");
    assert.equal(reportNavActive(dash, POINTS_NAV, "/points"), true);
    assert.equal(reportNavActive(dash, POINTS_NAV, "/points/methodology"), false);
    assert.equal(reportNavActive(method, POINTS_NAV, "/points/methodology"), true);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu"), true);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu/students"), false);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu/provisional/athletics"), false);
    assert.equal(reportNavActive(students, ASPIREDU_NAV, "/aspiredu/students"), true);
    assert.equal(reportNavActive(summer, ASPIREDU_NAV, "/aspiredu/provisional/summer-1"), true);
    assert.equal(reportNavActive(athletics, ASPIREDU_NAV, "/aspiredu/provisional/athletics"), true);
    assert.equal(summer.label, "Summer 1 Athletic Provisional");
    assert.equal(athletics.label, "Athletics Provisional");
    assert.equal(reportNavActive(springEot, ASPIREDU_NAV, "/aspiredu/eot/spring"), true);
    assert.equal(reportNavActive(summary, ASPIREDU_NAV, "/aspiredu/eot/spring"), false);
    assert.equal(springEot.label, "Spring EOT Grade Report");
  });
});
