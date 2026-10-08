import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAppealImport } from "./imports";

describe("appeal aggregate CSV imports", () => {
  it("accepts a Fall email import and computes standard rates", () => {
    const parsed = parseAppealImport(
      "email_id,email_name,subject,sent_at,sent,delivered,unique_opens,unique_clicks,conversions,unsubscribes,attributed_revenue\n1,Newsletter,Give now,2026-08-16,100,95,50,10,4,2,125.50\n",
      "email", "fall-2026",
    );
    assert.deepEqual(parsed.rows[0], {
      emailId: 1, name: "Newsletter", subject: "Give now", sentAt: "2026-08-16T00:00:00.000Z",
      sent: 100, delivered: 95, uniqueOpens: 50, uniqueClicks: 10, conversions: 4, unsubscribes: 2,
      attributedRevenue: 125.5, deliveryRate: 95, openRate: 52.6, clickRate: 10.5, conversionRate: 4.2, unsubscribeRate: 2.1,
    });
  });

  it("keeps a legacy Fall recipients column compatible", () => {
    const parsed = parseAppealImport("email_id,email_name,sent_at,recipients,unique_opens,unique_clicks\n2,Legacy,2026-08-16,10,3,1\n", "email", "fall-2026");
    assert.equal((parsed.rows[0] as { delivered: number }).delivered, 10);
  });

  it("rejects invalid denominator relationships and the wrong campaign", () => {
    assert.throws(() => parseAppealImport("email_id,email_name,sent_at,sent,delivered,unique_opens,unique_clicks\n2,Bad,2026-08-16,10,9,10,1\n", "email", "fall-2026"), /cannot exceed delivered/);
    assert.throws(() => parseAppealImport("campaign_slug,mailing_id,label,drop_date,total_mailed\nspring-2026,m1,Drop,2026-08-16,10\n", "mail", "fall-2026"), /campaign_slug/);
  });

  it("passes optional segment and email_number through when present", () => {
    const parsed = parseAppealImport(
      "email_id,email_name,subject,sent_at,recipients,unique_opens,unique_clicks,segment,email_number\n3,Segmented,Touch 1,2026-08-16,10,3,1,Active Donors,1\n",
      "email", "fall-2026",
    );
    assert.equal((parsed.rows[0] as { segment?: string }).segment, "Active Donors");
    assert.equal((parsed.rows[0] as { emailNumber?: number }).emailNumber, 1);
  });
});
