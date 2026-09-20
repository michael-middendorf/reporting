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
});
