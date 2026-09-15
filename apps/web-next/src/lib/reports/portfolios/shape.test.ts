import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyRelationships,
  classifyStage,
  formatMdDate,
  relationshipLabel,
  sortDonors,
  UNTAGGED_STAGE,
} from "./shape";

describe("portfolio tag classification", () => {
  it("maps a single MGO stage tag by id", () => {
    const stage = classifyStage("mgo", [{ tagId: 75, tagName: "Cultivation" }]);
    assert.equal(stage.key, "cultivation");
    assert.equal(stage.label, "Cultivation");
  });

  it("maps MA Engagement by live name, not Engage", () => {
    const stage = classifyStage("ma", [{ id: 82, name: "Engagement" }]);
    assert.equal(stage.key, "engagement");
    assert.equal(stage.label, "Engagement");
  });

  it("keeps the first canonical stage when two stage tags are present", () => {
    const stage = classifyStage("mgo", [
      { tagId: 76, tagName: "Solicitation" },
      { tagId: 74, tagName: "Identification" },
    ]);
    assert.equal(stage.key, "identification");
  });

  it("maps MGO Cultivation from a prefixed FullContact tag name", () => {
    const stage = classifyStage("mgo", [{ name: "MGO: Cultivation" }]);
    assert.equal(stage.key, "cultivation");
    assert.equal(stage.label, "Cultivation");
  });

  it("maps MA Engagement from a prefixed FullContact tag name", () => {
    const stage = classifyStage("ma", [{ name: "MA: Engagement" }]);
    assert.equal(stage.key, "engagement");
    assert.equal(stage.label, "Engagement");
  });

  it("keeps identification first when dual stages are prefixed names", () => {
    const stage = classifyStage("mgo", [
      { name: "MGO: Solicitation" },
      { name: "MGO: Identification" },
    ]);
    assert.equal(stage.key, "identification");
  });

  it("treats a contact with no pipeline tag as untagged", () => {
    const stage = classifyStage("ma", [{ tagName: "Current" }]);
    assert.equal(stage.key, UNTAGGED_STAGE.key);
  });

  it("ignores leftover MA Engaged (tag 46)", () => {
    const stage = classifyStage("ma", [
      { tagId: 46, tagName: "MA Engaged" },
      { tagName: "First Time" },
    ]);
    assert.equal(stage.key, "untagged");
  });

  it("collects relationship tags in canonical order", () => {
    const rel = classifyRelationships("mgo", [
      { tagName: "Prospect" },
      { tagName: "Estate Donor" },
      { tagName: "Current" },
    ]);
    assert.deepEqual(rel, ["Current", "Prospect", "Estate Donor"]);
  });

  it("strips MGO: prefixes before matching relationship labels", () => {
    const rel = classifyRelationships("mgo", [
      { name: "MGO: Current" },
      { name: "MGO: Personal Relationship" },
    ]);
    assert.deepEqual(rel, ["Current", "Personal Relationship"]);
  });

  it("does not treat an MGO-only stage id as an MA stage", () => {
    const stage = classifyStage("ma", [{ tagId: 74, tagName: "Identification" }]);
    assert.equal(stage.key, "untagged");
  });
});

describe("portfolio donor sort", () => {
  it("puts missing last-activity first, then oldest date, then name", () => {
    const sorted = sortDonors([
      { donorName: "Donor Zulu", lastActivityDate: "2026-01-02" },
      { donorName: "Donor Alpha", lastActivityDate: null },
      { donorName: "Donor Beta", lastActivityDate: "2026-01-01" },
      { donorName: "Donor Gamma", lastActivityDate: null },
    ]);
    assert.deepEqual(
      sorted.map((d) => d.donorName),
      ["Donor Alpha", "Donor Gamma", "Donor Beta", "Donor Zulu"],
    );
  });
});

describe("portfolio display helpers", () => {
  it("formats ISO dates and joins relationships", () => {
    assert.equal(formatMdDate("2026-09-14"), "Sep 14, 2026");
    assert.equal(formatMdDate(null), "-");
    assert.equal(relationshipLabel(["Current", "Prospect"]), "Current, Prospect");
    assert.equal(relationshipLabel([]), "-");
  });
});
