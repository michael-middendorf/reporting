import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lifetimeThroughLabel, overlayPursuitOfWisdomYoutube } from "./pursuit-of-wisdom-youtube";

describe("pursuit of wisdom youtube studio overlay", () => {
  it("replaces a publisher available:false payload with Studio trailer views", () => {
    const overlaid = overlayPursuitOfWisdomYoutube({
      generatedAt: "2026-09-23T12:00:00.000Z",
      website: { sessions: 12 },
      youtube: { available: false },
      notes: [
        "Course consumption is based on consented first-party events and logged-in course progress.",
        "YouTube public basics require a restricted YouTube Data API key. Owner-only Analytics API metrics are unavailable by design.",
      ],
    });

    assert.equal(overlaid.youtube.available, true);
    assert.equal(overlaid.website.sessions, 12);
    const summedViews = overlaid.youtube.videos.reduce((sum, video) => sum + video.views, 0);
    assert.equal(summedViews, 308194);
    assert.equal(overlaid.youtube.totalViews, summedViews);
    assert.equal(overlaid.youtube.totalWatchHours, 1513);
    assert.equal(overlaid.youtube.asOf, "2026-09-22");
    assert.equal(lifetimeThroughLabel(overlaid.youtube.asOf), "Lifetime through September 22, 2026, from YouTube Studio.");
    assert.equal("subscribers" in overlaid.youtube, false);

    const sheen = overlaid.youtube.videos.find((video) => video.title.includes("Fulton Sheen"));
    assert.ok(sheen);
    assert.equal(sheen.views, 36);
    assert.equal(sheen.watchHours, null);
    assert.equal(
      overlaid.notes.some((note) => /unavailable/i.test(String(note))),
      false,
    );
  });
});
