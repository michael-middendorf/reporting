import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichCourseEngagement,
  computeFormatComparisons,
  computeTopicTractions,
  overlayPursuitOfWisdomCatalog,
  POW_CATALOG,
  DISTRIBUTION_RECOMMENDATIONS,
} from "./pursuit-of-wisdom-catalog";

test("POW catalog covers all 20 known courses", () => {
  assert.equal(POW_CATALOG.length, 20);
  for (const course of POW_CATALOG) {
    assert.ok(course.segments > 0);
    assert.ok(course.avgDurationMinutes > 0);
    assert.ok(course.topic);
  }
});

test("enrichCourseEngagement attaches segment metrics and academic topics", () => {
  const raw = {
    title: "The Genius of J.R.R. Tolkien",
    starts: 1183,
    completions: 140,
    watchHours: 0,
    videosWatched: 0,
  };
  const enriched = enrichCourseEngagement(raw);
  assert.equal(enriched.segments, 8);
  assert.equal(enriched.avgDurationMinutes, 20);
  assert.equal(enriched.topic, "Literature");
  assert.equal(enriched.format, "Medium (7-8 lessons)");
  assert.equal(Math.round(enriched.completionRate * 100), 12);
});

test("computeFormatComparisons correctly aggregates short, medium, and long formats", () => {
  const sample = [
    enrichCourseEngagement({ title: "Introduction to Sacramental Theology", starts: 1000, completions: 200 }),
    enrichCourseEngagement({ title: "The Genius of J.R.R. Tolkien", starts: 1000, completions: 100 }),
    enrichCourseEngagement({ title: "An Introduction to Computer Science", starts: 500, completions: 50 }),
  ];

  const comparisons = computeFormatComparisons(sample);
  assert.equal(comparisons.length, 3);

  const short = comparisons.find((c) => c.format === "Short (4-5 lessons)");
  assert.ok(short);
  assert.equal(short.totalStarts, 1000);
  assert.equal(short.totalCompletions, 200);
  assert.equal(short.completionRate, 0.2);

  const medium = comparisons.find((c) => c.format === "Medium (7-8 lessons)");
  assert.ok(medium);
  assert.equal(medium.totalStarts, 1000);
  assert.equal(medium.totalCompletions, 100);
  assert.equal(medium.completionRate, 0.1);

  const longFormat = comparisons.find((c) => c.format === "Long (9+ lessons)");
  assert.ok(longFormat);
  assert.equal(longFormat.totalStarts, 500);
  assert.equal(longFormat.totalCompletions, 50);
  assert.equal(longFormat.completionRate, 0.1);
});

test("computeTopicTractions aggregates by academic topic ordered by starts", () => {
  const sample = [
    enrichCourseEngagement({ title: "The Genius of J.R.R. Tolkien", starts: 1183, completions: 140 }),
    enrichCourseEngagement({ title: "Introduction to Sacramental Theology", starts: 1015, completions: 179 }),
    enrichCourseEngagement({ title: "The Philosophy of Motherhood", starts: 951, completions: 214 }),
  ];

  const tractions = computeTopicTractions(sample);
  assert.equal(tractions.length, 3);
  assert.equal(tractions[0].topic, "Literature");
  assert.equal(tractions[0].totalStarts, 1183);
  assert.equal(tractions[1].topic, "Theology & Faith");
  assert.equal(tractions[1].totalStarts, 1015);
  assert.equal(tractions[2].topic, "Philosophy");
  assert.equal(tractions[2].totalStarts, 951);
});

test("overlayPursuitOfWisdomCatalog integrates into dashboard payload", () => {
  const initial = {
    website: { sessions: 10 },
    courses: [
      { title: "The Genius of J.R.R. Tolkien", starts: 1183, completions: 140 },
      { title: "The Philosophy of Motherhood", starts: 951, completions: 214 },
    ],
  };

  const overlayed = overlayPursuitOfWisdomCatalog(initial) as {
    courses: Array<{ segments: number }>;
    formatComparisons: unknown[];
    topicTractions: unknown[];
    distributionRecommendations: unknown[];
  };
  assert.equal(overlayed.courses.length, 2);
  assert.equal(overlayed.courses[0].segments, 8);
  assert.equal(overlayed.courses[1].segments, 5);
  assert.ok(overlayed.formatComparisons.length >= 2);
  assert.ok(overlayed.topicTractions.length >= 2);
  assert.equal(overlayed.distributionRecommendations.length, DISTRIBUTION_RECOMMENDATIONS.length);
});
