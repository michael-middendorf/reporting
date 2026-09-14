"""Unit tests for athletics giving (no network)."""
from __future__ import annotations

import datetime as dt
import unittest
from typing import Any

from handler import (
    SEGMENTS,
    build_snapshot,
    designation_query,
    fiscal_year_label,
    fiscal_year_window,
    fund_rows,
    normalize_row,
    parse_gift_date,
    parse_money,
    previous_fiscal_year_start,
    window_totals,
)


def _des(
    *,
    amount: float,
    gift_date: str,
    project: str,
    code: str,
    segment: str = "Athletics Fundraising",
    gift_id: int | None = 1,
    contact: str = "Jane Donor",
    contact_id: int = 10,
) -> dict[str, Any]:
    return {
        "giftId": gift_id,
        "giftDate": gift_date,
        "amountDesignated": amount,
        "contactId": contact_id,
        "contactName": contact,
        "project": project,
        "projectCode": code,
        "segmentName": segment,
        "segmentCode": "VOA_ATHLETICS_DS",
        "giftType": "Credit",
        "giftIsPrivate": False,
    }


class FiscalYearTests(unittest.TestCase):
    def test_september_2026_is_fy_2027(self):
        fy, start, end = fiscal_year_window(dt.date(2026, 9, 14))
        self.assertEqual(fy, 2027)
        self.assertEqual(start, dt.date(2026, 7, 1))
        self.assertEqual(end, dt.date(2027, 6, 30))
        self.assertEqual(fiscal_year_label(fy), "FY 2026-27")
        self.assertEqual(previous_fiscal_year_start(start), dt.date(2025, 7, 1))


class ParseTests(unittest.TestCase):
    def test_money_and_dates(self):
        self.assertEqual(parse_money("$1,030.18"), 1030.18)
        self.assertEqual(parse_money(1000), 1000.0)
        self.assertEqual(parse_gift_date("9/12/2026"), dt.date(2026, 9, 12))
        self.assertEqual(parse_gift_date("2026-09-01T00:00:00"), dt.date(2026, 9, 1))


class QueryTests(unittest.TestCase):
    def test_or_groups_for_the_three_qlik_segments(self):
        body = designation_query()
        values = [group["conditions"][0]["value"] for group in body["groups"]]
        self.assertEqual(values, list(SEGMENTS))
        self.assertEqual(body["groups"][0]["conditions"][0]["parameter"], "Segment Name")

    def test_query_starts_at_fy_2025_26(self):
        body = designation_query(dt.date(2025, 7, 1))
        self.assertEqual(
            body["groups"][0]["conditions"][1],
            {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "2025-07-01"},
        )


class NormalizeTests(unittest.TestCase):
    def test_marks_processing_fees_and_builds_contact_url(self):
        row = normalize_row(
            _des(
                amount=30.18,
                gift_date="9/1/2026",
                project="Donor Paid Costs",
                code="CREDITCARDCOSTS",
                gift_id=451502,
                contact="Miles Humphries",
                contact_id=131118,
            )
        )
        assert row is not None
        self.assertTrue(row["isFee"])
        self.assertEqual(row["amountDesignated"], 30.18)
        self.assertEqual(row["giftDate"], "2026-09-01")
        self.assertIn("131118", row["contactUrl"] or "")

    def test_drops_rows_without_an_amount(self):
        raw = _des(amount=100, gift_date="9/1/2026", project="Football Program", code="6552FB")
        raw["amountDesignated"] = None
        self.assertIsNone(normalize_row(raw))


class TotalsTests(unittest.TestCase):
    def test_splits_fees_and_counts_unique_gifts(self):
        rows = [
            normalize_row(
                _des(amount=1000, gift_date="2026-09-01", project="Women's Soccer", code="6572WSoc", gift_id=1)
            ),
            normalize_row(
                _des(amount=30.18, gift_date="2026-09-01", project="Donor Paid Costs", code="CREDITCARDCOSTS", gift_id=1)
            ),
            normalize_row(
                _des(amount=250, gift_date="2026-08-05", project="Football Program", code="6552FB", gift_id=2)
            ),
        ]
        clean = [row for row in rows if row]
        totals = window_totals(clean, dt.date(2026, 9, 1), dt.date(2026, 9, 14))
        self.assertEqual(totals["amount"], 1030.18)
        self.assertEqual(totals["programAmount"], 1000.0)
        self.assertEqual(totals["feeAmount"], 30.18)
        self.assertEqual(totals["giftCount"], 1)
        self.assertEqual(totals["designationCount"], 2)

    def test_fund_rows_sort_by_amount(self):
        rows = [
            normalize_row(_des(amount=250, gift_date="2026-08-05", project="Football Program", code="6552FB", gift_id=2)),
            normalize_row(
                _des(amount=1000, gift_date="2026-09-01", project="Women's Soccer", code="6572WSoc", gift_id=1)
            ),
            normalize_row(
                _des(amount=30.18, gift_date="2026-09-01", project="Donor Paid Costs", code="CREDITCARDCOSTS", gift_id=1)
            ),
        ]
        funds = fund_rows([row for row in rows if row])
        self.assertEqual([item["project"] for item in funds], ["Women's Soccer", "Football Program", "Donor Paid Costs"])
        self.assertTrue(funds[-1]["isFee"])
        soccer = funds[0]
        self.assertEqual(soccer["giftCount"], 1)
        self.assertEqual(soccer["amount"], 1000.0)


class SnapshotTests(unittest.TestCase):
    def test_weekly_fytd_and_all_time(self):
        raw = [
            _des(amount=200, gift_date="9/12/2026", project="Men's Ultimate Frisbee", code="6251FrisM", gift_id=10),
            _des(amount=6.28, gift_date="9/12/2026", project="Donor Paid Costs", code="CREDITCARDCOSTS", gift_id=10),
            _des(amount=1000, gift_date="8/1/2026", project="Football Program", code="6552FB", gift_id=11),
            _des(amount=500, gift_date="5/13/2026", project="Athletic Scholarship", code="6521", gift_id=12),
            _des(amount=9999, gift_date="8/1/2024", project="Old Endowment", code="OLD", gift_id=99),
        ]
        snap = build_snapshot(
            raw,
            today=dt.date(2026, 9, 14),
            generated_at="2026-09-14T18:00:00Z",
        )
        self.assertEqual(snap["source"], "virtuous")
        self.assertEqual(snap["fiscalYearLabel"], "FY 2026-27")
        self.assertEqual(snap["since"], "2025-07-01")
        self.assertEqual(snap["weekly"]["giftCount"], 1)
        self.assertEqual(snap["weekly"]["amount"], 206.28)
        self.assertEqual(snap["fytd"]["giftCount"], 2)
        self.assertEqual(snap["fytd"]["programAmount"], 1200.0)
        self.assertEqual(snap["lastFy"]["programAmount"], 500.0)
        self.assertEqual(snap["allTime"]["giftCount"], 3)
        self.assertEqual(snap["allTime"]["amount"], 1706.28)
        self.assertEqual(snap["gifts"][0]["giftDate"], "2026-09-12")
        self.assertEqual(len(snap["funds"]), 4)
        self.assertFalse(any(row["project"] == "Old Endowment" for row in snap["gifts"]))


if __name__ == "__main__":
    unittest.main()
