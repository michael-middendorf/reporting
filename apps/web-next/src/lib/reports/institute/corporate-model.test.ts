import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeKpiCards,
  DEFAULT_ANNUAL_TARGETS,
  exportCompaniesToCsv,
  exportOpportunitiesToCsv,
  formatCurrency,
  getPacingStatus,
  COMPANIES_DATA,
  OPPORTUNITIES_DATA,
  HISTORICAL_FUNDING,
} from "./corporate-model";

describe("corporate-model unit tests", () => {
  test("computes KPI cards for week, month, and YTD", () => {
    const weekCards = computeKpiCards("week", 1); // 2026-05-17
    assert.equal(weekCards.length, 7);

    const fundingCard = weekCards.find((c) => c.id === "kpi-funding");
    assert.ok(fundingCard);
    assert.equal(fundingCard.unit, "currency");
    assert.equal(fundingCard.actualValue, 11000); // from row 2026-05-17
    assert.ok(fundingCard.targetValue > 0);

    const monthCards = computeKpiCards("month", 1);
    assert.equal(monthCards.length, 7);
    const monthFunding = monthCards.find((c) => c.id === "kpi-funding");
    assert.ok(monthFunding);
    assert.equal(monthFunding.actualValue, 12000); // 1000 + 11000

    const ytdCards = computeKpiCards("ytd", 1);
    assert.equal(ytdCards.length, 7);
    const ytdFunding = ytdCards.find((c) => c.id === "kpi-funding");
    assert.ok(ytdFunding);
    assert.equal(ytdFunding.actualValue, 12000);
  });

  test("getPacingStatus assigns on-target and behind properly", () => {
    assert.equal(getPacingStatus(100, 50), "on-target");
    assert.equal(getPacingStatus(50, 50), "on-target");
    assert.equal(getPacingStatus(49, 50), "behind");
    assert.equal(getPacingStatus(0, 0), "on-target");
  });

  test("recalculates targets when annual targets are customized", () => {
    const customTargets = {
      ...DEFAULT_ANNUAL_TARGETS,
      funding: 520000, // $10,000 per week
      sponsors: 104, // 2 per week
    };
    const cards = computeKpiCards("week", 0, customTargets);
    const fundingCard = cards.find((c) => c.id === "kpi-funding");
    assert.ok(fundingCard);
    assert.equal(fundingCard.targetValue, 10000);

    const sponsorsCard = cards.find((c) => c.id === "kpi-sponsors");
    assert.ok(sponsorsCard);
    assert.equal(sponsorsCard.targetValue, 2);
  });

  test("formatCurrency formats USD correctly", () => {
    assert.equal(formatCurrency(250000), "$250,000");
    assert.equal(formatCurrency(0), "$0");
  });

  test("exportCompaniesToCsv produces valid CSV content", () => {
    const csv = exportCompaniesToCsv(COMPANIES_DATA);
    assert.ok(csv.includes("Company,Industry,Pipeline Stage"));
    assert.ok(csv.includes("Arthrex Inc."));
    assert.ok(csv.includes("Naples, FL"));
  });

  test("exportOpportunitiesToCsv produces valid CSV content", () => {
    const csv = exportOpportunitiesToCsv(OPPORTUNITIES_DATA);
    assert.ok(csv.includes("Opportunity ID,Type,Company"));
    assert.ok(csv.includes("opp-01"));
    assert.ok(csv.includes("Arthrex Inc."));
  });

  test("historical datasets contain non-empty data", () => {
    assert.equal(HISTORICAL_FUNDING.length, 17);
    assert.equal(COMPANIES_DATA.length, 14);
    assert.equal(OPPORTUNITIES_DATA.length, 8);
  });
});
