import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scopePortfoliosForEmail } from "./scope";
import type { PortfolioSolicitor, PortfoliosSnapshot } from "./shape";

function solicitor(
  id: string,
  team: "mgo" | "ma",
  email: string,
  donorName: string,
): PortfolioSolicitor {
  return {
    id,
    name: id,
    email,
    team,
    groupName: `Portfolio - ${id}`,
    groupId: 1,
    donorCount: 1,
    stages: [
      {
        key: "cultivation",
        label: "Cultivation",
        donorCount: 1,
        donors: [
          {
            contactId: 100,
            donorName,
            contactUrl: "https://example.test/contact/100",
            stage: "Cultivation",
            relationship: ["Prospect"],
            lastGiftDate: "2025-01-01",
            lastActivityDate: "2025-06-01",
            lastActivityBy: id,
          },
        ],
      },
    ],
  };
}

function snapshot(solicitors: PortfolioSolicitor[]): PortfoliosSnapshot {
  return {
    generated_at: "2026-09-14T12:00:00Z",
    source: "virtuous",
    definition: "test",
    solicitors,
  };
}

const MGO_A = solicitor("Officer A", "mgo", "officer.a@avemaria.edu", "Donor Alpha");
const MGO_B = solicitor("Officer B", "mgo", "officer.b@avemaria.edu", "Donor Bravo");
const MA_A = solicitor("Associate A", "ma", "associate.a@avemaria.edu", "Donor Charlie");
const MA_B = solicitor("Associate B", "ma", "associate.b@avemaria.edu", "Donor Delta");
const FULL = snapshot([MGO_A, MGO_B, MA_A, MA_B]);

function names(result: PortfoliosSnapshot): string[] {
  return result.solicitors.map((s) => s.name);
}

function donorNames(result: PortfoliosSnapshot): string[] {
  return result.solicitors.flatMap((s) => s.stages.flatMap((st) => st.donors.map((d) => d.donorName || "")));
}

describe("scopePortfoliosForEmail", () => {
  it("does not let an MGO see another MGO", () => {
    const scoped = scopePortfoliosForEmail("officer.a@avemaria.edu", FULL);
    assert.deepEqual(names(scoped), ["Officer A"]);
    assert.deepEqual(donorNames(scoped), ["Donor Alpha"]);
    assert.equal(scoped.viewer?.canSelectMgo, false);
    assert.equal(scoped.viewer?.canSelectMa, false);
  });

  it("does not let an MA see an MGO", () => {
    const scoped = scopePortfoliosForEmail("associate.a@avemaria.edu", FULL);
    assert.deepEqual(names(scoped), ["Associate A"]);
    assert.equal(donorNames(scoped).includes("Donor Alpha"), false);
  });

  it("does not let Annie see MGO books", () => {
    const scoped = scopePortfoliosForEmail("annie.esposito@avemaria.edu", FULL);
    assert.deepEqual(names(scoped), ["Associate A", "Associate B"]);
    assert.equal(scoped.viewer?.canSelectMa, true);
    assert.equal(scoped.viewer?.canSelectMgo, false);
    assert.equal(donorNames(scoped).includes("Donor Alpha"), false);
  });

  it("does not let Jim see MA books", () => {
    const scoped = scopePortfoliosForEmail("jim.thomas@avemaria.edu", FULL);
    assert.deepEqual(names(scoped), ["Officer A", "Officer B"]);
    assert.equal(scoped.viewer?.canSelectMgo, true);
    assert.equal(scoped.viewer?.canSelectMa, false);
    assert.equal(donorNames(scoped).includes("Donor Charlie"), false);
  });

  it("lets Leslie see both teams", () => {
    const scoped = scopePortfoliosForEmail("leslie.sonnen@avemaria.edu", FULL);
    assert.deepEqual(names(scoped), ["Officer A", "Officer B", "Associate A", "Associate B"]);
    assert.equal(scoped.viewer?.canSelectMgo, true);
    assert.equal(scoped.viewer?.canSelectMa, true);
  });

  it("lets an admin see both teams", () => {
    const scoped = scopePortfoliosForEmail("michael.t.middendorf@avemaria.edu", FULL);
    assert.equal(scoped.solicitors.length, 4);
    assert.equal(scoped.viewer?.canSelectMgo, true);
    assert.equal(scoped.viewer?.canSelectMa, true);
  });

  it("returns empty solicitors for an unknown email", () => {
    const scoped = scopePortfoliosForEmail("unknown.user@avemaria.edu", FULL);
    assert.deepEqual(scoped.solicitors, []);
    assert.equal(scoped.viewer?.defaultSolicitorId, null);
  });
});
