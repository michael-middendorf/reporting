import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyJoins,
  enrollmentStatus,
  filterCycle,
  isMusicIntent,
  toApplicant,
} from "./join";
import { defaultWorkflow } from "./types";

describe("isMusicIntent", () => {
  it("keeps Music majors and Music / Sacred Music minors", () => {
    assert.equal(isMusicIntent("Music", ""), true);
    assert.equal(isMusicIntent("MUSIC", ""), true);
    assert.equal(isMusicIntent("", "Music"), true);
    assert.equal(isMusicIntent("", "Sacred Music"), true);
    assert.equal(isMusicIntent("Biology", "History"), false);
    assert.equal(isMusicIntent("Biology", ""), false);
  });
});

describe("enrollmentStatus", () => {
  it("walks withdrawn, deposited, accepted, submitted, created", () => {
    assert.equal(enrollmentStatus({ WithdrawnDate: "2026-08-01" }), "Withdrawn");
    assert.equal(enrollmentStatus({ DepositDate: "2026-07-01" }), "Deposited");
    assert.equal(enrollmentStatus({ AcceptCode: "AT" }), "Accepted");
    assert.equal(enrollmentStatus({ ApplicationSubmittedDate: "2026-06-01" }), "Submitted");
    assert.equal(enrollmentStatus({ CreatedDate: "2026-05-01" }), "Created");
    assert.equal(enrollmentStatus({}), "Unknown");
  });
});

describe("toApplicant + joins", () => {
  it("drops non-music rows and joins AME, audition, overlay", () => {
    const music = toApplicant({
      ApplicationReferenceID: "APP-1",
      PersonReferenceID: "PER-1",
      ApplicationTerm: "Fall 2027",
      ApplicationType: "Undergraduate",
      Major: "Music",
      AcceptCode: "AT",
      AllDecisionCodes: "LOIA-MUSIC",
    });
    const other = toApplicant({
      ApplicationReferenceID: "APP-2",
      Major: "Biology",
    });
    assert.equal(other, null);
    assert.ok(music);
    assert.equal(music.enrollmentStatus, "Accepted");
    assert.equal(music.loiFromSlate, true);

    const joined = applyJoins(
      [music],
      new Map([
        [
          "p:per-1",
          { status: "Registered", event: "2026-09-12T10:00:00", when: "2026-08-01" },
        ],
      ]),
      new Map(),
      {
        "app-1": {
          ...defaultWorkflow(),
          auditionReview: "in_review",
          musicAward: "$2,000",
          loiSigned: true,
        },
      },
      new Map([
        ["per-1", { first: "Ada", last: "Lovelace", email: "ada@example.com" }],
      ]),
    );
    assert.equal(joined[0].ameStatus, "Registered");
    assert.equal(joined[0].ameEvent, "2026-09-12");
    assert.equal(joined[0].first, "Ada");
    assert.equal(joined[0].last, "Lovelace");
    assert.equal(joined[0].auditionRequested, false);
    assert.equal(joined[0].workflow.auditionReview, "in_review");
    assert.equal(joined[0].workflow.musicAward, "$2,000");
    assert.equal(filterCycle(joined, "fa27").length, 1);
    assert.equal(filterCycle(joined, "fa26").length, 0);
  });
});
