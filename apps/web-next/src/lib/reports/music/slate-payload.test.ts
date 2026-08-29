import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMusicSlatePayload, MUSIC_SLATE_FIELDS } from "./slate-payload";
import { defaultWorkflow } from "./types";

describe("buildMusicSlatePayload", () => {
  it("maps workflow to the four music fields plus match keys", () => {
    const payload = buildMusicSlatePayload("APP-1", "PER-1", {
      ...defaultWorkflow(),
      auditionReview: "in_review",
      programAcceptance: "accepted",
      musicAward: "$2,000",
      loiSigned: true,
    });
    assert.ok(!("error" in payload));
    assert.deepEqual(payload, {
      app_guid: "APP-1",
      person_guid: "PER-1",
      music_audition_review: "In review",
      music_program_acceptance: "Accepted",
      music_award: "$2,000",
      music_loi_signed: "Yes",
    });
    assert.deepEqual(Object.keys(payload).sort(), [...MUSIC_SLATE_FIELDS].sort());
  });

  it("refuses to send without application and person GUIDs", () => {
    const missingApp = buildMusicSlatePayload("", "PER-1", defaultWorkflow());
    const missingPerson = buildMusicSlatePayload("APP-1", "  ", defaultWorkflow());
    assert.deepEqual(missingApp, { error: "app_guid is required" });
    assert.deepEqual(missingPerson, { error: "person_guid is required" });
  });

  it("never includes enrollment decision or major keys", () => {
    const payload = buildMusicSlatePayload("APP-1", "PER-1", defaultWorkflow());
    assert.ok(!("error" in payload));
    const keys = Object.keys(payload).join(" ");
    assert.equal(/decision|acceptcode|deposit|app_major|LOIA/i.test(keys), false);
  });
});
