import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANONYMOUS_LABEL, canSeeAnonymousDonorNames, redactAnonymousDonors } from "./anonymous-donors";

const ADVANCEMENT = "cassandra.l.bournos@avemaria.edu";
const CHAPEL = "robert.musselman@avemaria.edu";

const snapshot = {
  items: [
    {
      gifts: [
        { donorName: "Tagged Donor", contactId: 7, contactUrl: "https://x/7", anonymousDonor: true, amount: 5 },
        { donorName: "Public Donor", contactId: 8, contactUrl: "https://x/8", anonymousDonor: false, amount: 6 },
        { donorName: "Old Cache Row", contactId: 9, amount: 7 },
      ],
    },
  ],
  gifts: [{ contactName: "Tagged Contact", contactId: 7, contactUrl: "https://x/7", anonymousDonor: true }],
};

describe("anonymous donor redaction", () => {
  it("leaves Advancement viewers' data untouched", () => {
    assert.equal(canSeeAnonymousDonorNames(ADVANCEMENT), true);
    assert.equal(redactAnonymousDonors(snapshot, ADVANCEMENT), snapshot);
  });

  it("hides tagged and unflagged donors from everyone else, keeping contactId", () => {
    assert.equal(canSeeAnonymousDonorNames(CHAPEL), false);
    const out = redactAnonymousDonors(snapshot, CHAPEL);
    const [tagged, pub, old] = out.items[0].gifts;
    assert.equal(tagged.donorName, ANONYMOUS_LABEL);
    assert.equal(tagged.contactUrl, null);
    assert.equal(tagged.contactId, 7);
    assert.equal(tagged.amount, 5);
    assert.equal(pub.donorName, "Public Donor");
    assert.equal(pub.contactUrl, "https://x/8");
    assert.equal(old.donorName, ANONYMOUS_LABEL);
    assert.equal(out.gifts[0].contactName, ANONYMOUS_LABEL);
    assert.equal(snapshot.items[0].gifts[0].donorName, "Tagged Donor");
  });

  it("redacts for an empty viewer", () => {
    const out = redactAnonymousDonors(snapshot, "");
    assert.equal(out.gifts[0].contactName, ANONYMOUS_LABEL);
  });
});
