import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEmailPerformanceCsv } from "./email-import";

const csv = "email_id,email_name,subject,sent_at,recipients,unique_opens,unique_clicks\n95,Active launch,Story,2026-09-15T14:00:00Z,100,40,5\n96,Lapsed launch,Story,2026-09-16T14:00:00Z,50,10,2";

describe("Fall Appeal email CSV import", () => {
  it("groups approved aggregate sends and computes weighted rates", () => {
    const snapshot = parseEmailPerformanceCsv(csv);
    assert.equal(snapshot.segments[0].recipients, 100);
    assert.equal(snapshot.segments[0].openRate, 40);
    assert.equal(snapshot.segments[1].clickRate, 4);
  });
  it("rejects unapproved email IDs and impossible counts", () => {
    assert.throws(() => parseEmailPerformanceCsv(csv.replace("95,", "999,")));
    assert.throws(() => parseEmailPerformanceCsv(csv.replace(",100,40,5", ",100,101,5")));
  });

  it("defaults emailNumber sequentially when omitted", () => {
    const snapshot = parseEmailPerformanceCsv(csv);
    assert.equal(snapshot.segments[0].sends[0].emailNumber, 1);
  });

  it("parses email_number, revenue, and gifts and aggregates segment totals", () => {
    const revenueCsv =
      "email_id,email_name,subject,sent_at,recipients,unique_opens,unique_clicks,email_number,revenue,gifts\n" +
      "93,Active 1,Story 1,2026-09-10T14:00:00Z,100,40,10,1,500.00,5\n" +
      "94,Active 2,Story 2,2026-09-15T14:00:00Z,100,30,8,2,250.50,2\n" +
      "96,Lapsed 1,Story L,2026-09-12T14:00:00Z,50,15,3,1,100.00,1";
    const snapshot = parseEmailPerformanceCsv(revenueCsv);
    const active = snapshot.segments.find((s) => s.key === "active_donors")!;
    assert.equal(active.sends.length, 2);
    assert.equal(active.sends[0].emailNumber, 1);
    assert.equal(active.sends[0].revenue, 500.00);
    assert.equal(active.sends[0].gifts, 5);
    assert.equal(active.sends[0].avgGift, 100.00);
    assert.equal(active.sends[1].emailNumber, 2);
    assert.equal(active.sends[1].revenue, 250.50);
    assert.equal(active.sends[1].gifts, 2);
    assert.equal(active.sends[1].avgGift, 125.25);
    assert.equal(active.revenue, 750.50);
    assert.equal(active.gifts, 7);
    assert.equal(active.avgGift, 107.21);

    const lapsed = snapshot.segments.find((s) => s.key === "lapsed_12_24")!;
    assert.equal(lapsed.sends[0].emailNumber, 1);
    assert.equal(lapsed.revenue, 100.00);
    assert.equal(lapsed.gifts, 1);
    assert.equal(lapsed.avgGift, 100.00);
  });
});
