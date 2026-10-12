import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legacyHousingDest } from "./legacy-route";

describe("legacy housing links", () => {
  it("leaves a bare /housing visit on the chooser", () => {
    assert.equal(legacyHousingDest(""), null);
    assert.equal(legacyHousingDest("?"), null);
  });

  it("sends the old Stats sheet to Capacity Quest", () => {
    assert.equal(legacyHousingDest("?view=overview"), "/housing/capacity-quest");
    assert.equal(legacyHousingDest("view=overview"), "/housing/capacity-quest");
  });

  it("keeps room, move-in, and verification links on Residence Life", () => {
    assert.equal(
      legacyHousingDest("?view=floor&hall=SEBAST&mode=list&floor=2&room=210"),
      "/housing/residence-life?view=floor&hall=SEBAST&mode=list&floor=2&room=210",
    );
    assert.equal(legacyHousingDest("?view=movein"), "/housing/residence-life?view=movein");
    assert.equal(legacyHousingDest("?view=verify"), "/housing/residence-life?view=verify");
    assert.equal(
      legacyHousingDest("?hall=JPII&asof=2026-10-12"),
      "/housing/residence-life?hall=JPII&asof=2026-10-12",
    );
  });
});
