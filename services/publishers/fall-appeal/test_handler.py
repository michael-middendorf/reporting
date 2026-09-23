"""Unit tests for Fall Appeal aggregations (no network)."""
from __future__ import annotations

import datetime as dt
import os
import unittest
from unittest.mock import patch

from handler import (
    gift_breakdown,
    giving_pathways,
    mail_segments,
    normalize_gifts,
    pace_series,
    summarize,
    weekly_timeline,
    _parse_md,
    _parse_money,
    _pathway_key,
    _pct_delta,
    _load_overlays,
    build_payload,
    build_direct_mail,
)


def _g(
    contact_id: int,
    amount: float,
    day: dt.date,
    segment: str | None = "Active DM",
    batch: str | None = None,
) -> dict:
    gift = {"contactId": contact_id, "amount": amount, "date": day, "segment": segment}
    if batch is not None:
        gift["batch"] = batch
    return gift


class ParseTests(unittest.TestCase):
    def test_money_strips_currency_and_parens(self):
        self.assertEqual(_parse_money("$1,250.00"), 1250.0)
        self.assertEqual(_parse_money("($100.00)"), -100.0)
        self.assertEqual(_parse_money(None), 0.0)
        self.assertEqual(_parse_money(""), 0.0)

    def test_dates_md_and_iso(self):
        self.assertEqual(_parse_md("8/16/2026"), dt.date(2026, 8, 16))
        self.assertEqual(_parse_md("2026-08-16T04:00:00"), dt.date(2026, 8, 16))
        self.assertIsNone(_parse_md(""))
        self.assertIsNone(_parse_md("nope"))


class NormalizeTests(unittest.TestCase):
    def test_drops_rows_without_dates(self):
        rows = [
            {"contactId": 1, "amount": "$100.00", "giftDate": "8/16/2026", "segment": "A"},
            {"contactId": 2, "amount": "$50.00", "giftDate": "", "segment": "B"},
        ]
        out = normalize_gifts(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["amount"], 100.0)
        self.assertEqual(out[0]["date"], dt.date(2026, 8, 16))
        self.assertEqual(out[0]["batch"], "")

    def test_copies_batch_as_string(self):
        rows = [
            {"contactId": 1, "amount": "25.00", "giftDate": "9/1/2026", "segment": "A", "batch": "Stripe-Giving 2026-09-01"},
            {"contactId": 2, "amount": "10.00", "giftDate": "9/1/2026", "segment": "B", "batch": None},
        ]
        out = normalize_gifts(rows)
        self.assertEqual(out[0]["batch"], "Stripe-Giving 2026-09-01")
        self.assertEqual(out[1]["batch"], "")
        self.assertEqual(len(out), 2)


class SummaryTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(
            summarize([]),
            {
                "totalRevenue": 0.0,
                "totalGifts": 0,
                "avgGift": 0.0,
                "medianGift": 0.0,
                "donors": 0,
            },
        )

    def test_nets_reversals_and_counts_distinct_donors(self):
        gifts = [
            _g(1, 100, dt.date(2026, 8, 16)),
            _g(1, 50, dt.date(2026, 8, 17)),
            _g(2, 200, dt.date(2026, 8, 18)),
            _g(2, -100, dt.date(2026, 8, 19)),
        ]
        s = summarize(gifts)
        self.assertEqual(s["totalRevenue"], 250.0)
        self.assertEqual(s["totalGifts"], 4)
        self.assertEqual(s["avgGift"], 62.5)
        self.assertEqual(s["medianGift"], 75.0)
        self.assertEqual(s["donors"], 2)


class BreakdownTests(unittest.TestCase):
    def test_reversals_land_in_lowest_band_and_reconcile(self):
        gifts = [
            _g(1, 50, dt.date(2026, 8, 16)),
            _g(2, 100, dt.date(2026, 8, 16)),
            _g(3, 5000, dt.date(2026, 8, 16)),
            _g(4, -25, dt.date(2026, 8, 16)),
        ]
        bands = gift_breakdown(gifts)
        by_key = {b["key"]: b for b in bands}
        self.assertEqual(by_key["lt100"]["gifts"], 2)
        self.assertEqual(by_key["lt100"]["revenue"], 25.0)
        self.assertEqual(by_key["100_249"]["gifts"], 1)
        self.assertEqual(by_key["5000_plus"]["gifts"], 1)
        self.assertAlmostEqual(sum(b["revenue"] for b in bands), 5125.0)


class MailSegmentTests(unittest.TestCase):
    def test_groups_by_segment_and_sorts_by_revenue(self):
        gifts = [
            _g(1, 100, dt.date(2026, 8, 16), "Active DM"),
            _g(2, 200, dt.date(2026, 8, 16), "Lapsed DM"),
            _g(3, 50, dt.date(2026, 8, 16), None),
            _g(4, 25, dt.date(2026, 8, 16), "Active DM"),
        ]
        rows = mail_segments(gifts)
        self.assertEqual([r["segment"] for r in rows], ["Lapsed DM", "Active DM", "Unattributed"])
        self.assertEqual(rows[1]["gifts"], 2)
        self.assertEqual(rows[1]["revenue"], 125.0)


class GivingPathwayTests(unittest.TestCase):
    def test_classifies_each_gift_once_and_reconciles(self):
        day = dt.date(2026, 9, 21)
        active = "FYE27 Fall 2026 Appeal Active Direct Mail 1"
        gifts = [
            _g(1, 100, day, "FYE27 Fall 2026 Appeal Lapsed 24-48 Direct Mail 1", batch="Staff checks 9/18"),
            _g(2, 40, day, active, batch=""),
            _g(3, 10, day, None),
            _g(4, 75, day, active, batch="Stripe-Giving 2026-09-21"),
            _g(5, 25, day, "FYE27 Fall 2026 Appeal Lapsed 12-24 Direct Mail 1", batch="RaiseDonors 4412"),
            _g(6, 60, day, "FYE27 Fall Appeal Email 1", batch="Staff checks 9/20"),
            _g(7, 15, day, active, batch="Posted RaiseDonors"),
            _g(8, 5, day, "FYE27 EMAIL Direct Mail 1", batch="Staff checks 9/21"),
        ]
        pathways = giving_pathways(gifts)
        by_key = {row["key"]: row for row in pathways}
        self.assertEqual([row["key"] for row in pathways], ["direct_mail", "landing", "email"])
        self.assertEqual([row["label"] for row in pathways], ["Direct mail", "Landing pages", "Email"])

        direct = by_key["direct_mail"]
        self.assertEqual(direct["revenue"], 170.0)
        self.assertEqual(direct["gifts"], 5)
        self.assertEqual(direct["avgGift"], 34.0)
        self.assertEqual(
            [row["segment"] for row in direct["segments"]],
            [
                "FYE27 Fall 2026 Appeal Lapsed 24-48 Direct Mail 1",
                active,
                "Unattributed",
                "FYE27 EMAIL Direct Mail 1",
            ],
        )
        self.assertEqual(direct["segments"][1]["revenue"], 55.0)
        self.assertEqual(direct["segments"][1]["gifts"], 2)
        self.assertEqual(direct["segments"][1]["avgGift"], 27.5)

        landing = by_key["landing"]
        self.assertEqual(landing["revenue"], 100.0)
        self.assertEqual(landing["gifts"], 2)
        self.assertEqual(landing["avgGift"], 50.0)
        self.assertEqual(
            [(row["segment"], row["revenue"]) for row in landing["segments"]],
            [(active, 75.0), ("FYE27 Fall 2026 Appeal Lapsed 12-24 Direct Mail 1", 25.0)],
        )

        email = by_key["email"]
        self.assertEqual(email["revenue"], 60.0)
        self.assertEqual(email["gifts"], 1)
        self.assertEqual(email["segments"], [{
            "segment": "FYE27 Fall Appeal Email 1",
            "revenue": 60.0,
            "gifts": 1,
            "avgGift": 60.0,
        }])

        summary = summarize(gifts)
        self.assertEqual(round(sum(row["revenue"] for row in pathways), 2), summary["totalRevenue"])
        self.assertEqual(sum(row["gifts"] for row in pathways), summary["totalGifts"])

    def test_spring_batches_use_the_same_pathway_rule(self):
        day = dt.date(2026, 3, 1)
        chapel = _g(
            1,
            50,
            day,
            "FYE26 Spring Appeal Chapel Direct Mail",
            batch="RaiseDonors 2026-03-01",
        )
        bricks = _g(
            2,
            25,
            day,
            "FYE26 Spring Appeal Bricks Direct Mail",
            batch="2026-04-01 New Gifts and Pledges",
        )
        blank = _g(3, 10, day, "FYE26 Spring Appeal Chapel Direct Mail", batch="")
        self.assertEqual(_pathway_key(chapel), "landing")
        self.assertEqual(_pathway_key(bricks), "direct_mail")
        self.assertEqual(_pathway_key(blank), "direct_mail")

    def test_empty_pathways_have_no_segments(self):
        pathways = giving_pathways([])
        self.assertEqual([row["key"] for row in pathways], ["direct_mail", "landing", "email"])
        for row in pathways:
            self.assertEqual(row["revenue"], 0.0)
            self.assertEqual(row["gifts"], 0)
            self.assertEqual(row["avgGift"], 0.0)
            self.assertEqual(row["segments"], [])

    def test_payload_classifies_normalized_batch(self):
        class Client:
            def paged_query(self, *_args, **_kwargs):
                return [{
                    "contactId": 1,
                    "amount": "$25.00",
                    "giftDate": "9/1/2026",
                    "segment": "FYE27 Fall 2026 Appeal Active Direct Mail 1",
                    "batch": "Stripe-Giving 2026-09-01",
                }]

        payload = build_payload(
            Client(),
            "2026 Fall Appeal",
            "",
            1000,
            dt.date(2026, 9, 19),
            geo_enabled=False,
        )
        pathways = {row["key"]: row for row in payload["givingPathways"]}
        self.assertEqual(list(pathways), ["direct_mail", "landing", "email"])
        self.assertEqual(pathways["landing"]["gifts"], 1)
        self.assertEqual(pathways["landing"]["revenue"], 25.0)
        self.assertEqual(pathways["email"]["segments"], [])
        self.assertEqual(pathways["direct_mail"]["segments"], [])
        summary = payload["summary"]
        self.assertEqual(sum(row["revenue"] for row in payload["givingPathways"]), summary["totalRevenue"])
        self.assertEqual(sum(row["gifts"] for row in payload["givingPathways"]), summary["totalGifts"])


class TimelineTests(unittest.TestCase):
    def test_cumulative_weeks_and_overlays(self):
        gifts = [
            _g(1, 100, dt.date(2026, 8, 17)),  # Monday
            _g(2, 50, dt.date(2026, 8, 24)),
        ]
        weeks = weekly_timeline(
            gifts,
            [{"label": "Mail drop", "date": "2026-08-19"}],
        )
        self.assertEqual(len(weeks), 2)
        self.assertEqual(weeks[0]["revenue"], 100.0)
        self.assertEqual(weeks[0]["cumRevenue"], 100.0)
        self.assertEqual(weeks[0]["overlays"], ["Mail drop"])
        self.assertEqual(weeks[1]["cumRevenue"], 150.0)
        self.assertEqual(weeks[1]["overlays"], [])


class PaceTests(unittest.TestCase):
    def test_compares_same_day_offset(self):
        start = dt.date(2026, 8, 16)
        prior_start = dt.date(2025, 11, 1)
        current = [_g(1, 100, start), _g(2, 50, start + dt.timedelta(days=2))]
        prior = [
            _g(9, 200, prior_start),
            _g(8, 300, prior_start + dt.timedelta(days=2)),
        ]
        pace = pace_series(current, prior, start, prior_start, as_of_offset=2)
        self.assertEqual(pace["asOfOffset"], 2)
        self.assertEqual(pace["currentToDate"]["revenue"], 150.0)
        self.assertEqual(pace["priorToDate"]["revenue"], 500.0)
        self.assertEqual(pace["priorFinal"]["revenue"], 500.0)
        self.assertEqual(_pct_delta(150.0, 500.0), -70.0)

    def test_delta_none_when_prior_is_zero(self):
        self.assertIsNone(_pct_delta(10.0, 0.0))


class EmailPerformanceTests(unittest.TestCase):
    def test_payload_carries_aggregate_email_snapshot_without_changing_gift_summary(self):
        class Client:
            def paged_query(self, *_args, **_kwargs):
                return []

        email = {
            "status": "available",
            "generatedAt": "2026-09-19T18:00:00Z",
            "sourceSyncedAt": "2026-09-19T17:00:00Z",
            "segments": [{"key": "active_donors", "recipients": 100, "openRate": 40.0, "sends": []}],
        }
        payload = build_payload(Client(), "2026 Fall Appeal", "", 1000, dt.date(2026, 9, 19), geo_enabled=False, email_performance=email)
        self.assertEqual(payload["summary"]["totalGifts"], 0)
        self.assertEqual(payload["emailPerformance"], email)


class DirectMailTests(unittest.TestCase):
    def test_uses_tag_audience_for_response_rate_and_keeps_creatives_separate(self):
        class Client:
            def get(self, path):
                tag_id = int(path.split("/ByTag/")[1].split("?")[0])
                return {"list": [{"id": contact_id} for contact_id in ({48: [1, 2], 47: [2, 3]}[tag_id])], "total": 2}

        direct = build_direct_mail(
            Client(),
            [_g(1, 100, dt.date(2026, 3, 24)), _g(3, 50, dt.date(2026, 3, 25))],
            [{"id": 48, "label": "Brick", "creative": True}, {"id": 47, "label": "Chapel", "creative": True}],
            1000,
            {"status": "unavailable", "rows": []},
        )
        self.assertEqual(direct["audience"], 3)
        self.assertEqual(direct["responders"], 2)
        self.assertEqual(direct["responseRate"], 66.7)
        self.assertEqual([row["label"] for row in direct["variants"]], ["Brick", "Chapel"])


class OverlayTests(unittest.TestCase):
    def test_reads_configured_overlays(self):
        with patch.dict(os.environ, {"FALL_APPEAL_OVERLAYS": '[{"label":"Email launch","date":"2026-09-15"}]'}):
            self.assertEqual(_load_overlays(), [{"label": "Email launch", "date": "2026-09-15"}])


if __name__ == "__main__":
    unittest.main()
