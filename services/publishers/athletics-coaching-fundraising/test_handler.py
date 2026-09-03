"""Unit tests for athletics coaching fundraising (no network)."""
from __future__ import annotations

import datetime as dt
import json
import unittest
from typing import Any
from urllib.parse import unquote

from handler import (
    FORBIDDEN_CODES,
    all_time_from_project,
    build_snapshot,
    collect_snapshot,
    designation_query,
    fiscal_year_label,
    fiscal_year_window,
    fytd_from_designations,
    load_sports_catalog,
    mapped_row,
    parse_gift_date,
    parse_sports_catalog,
    unmapped_row,
    unavailable_row,
)


def _des(
    *,
    code: str,
    amount: float,
    gift_date: str,
    gift_id: int | None = 1,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "projectCode": code,
        "amountDesignated": amount,
        "giftDate": gift_date,
    }
    if gift_id is not None:
        row["giftId"] = gift_id
    return row


class FakeClient:
    def __init__(
        self,
        projects: dict[str, dict[str, Any] | None],
        designations: dict[str, list[dict[str, Any]]],
    ):
        self.projects = projects
        self.designations = designations

    def get(self, path: str) -> Any:
        code = unquote(path.rsplit("/", 1)[-1])
        if code not in self.projects:
            return None
        return self.projects[code]

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = 1000) -> list[dict]:
        del path, page_size
        code = body["groups"][0]["conditions"][0]["value"]
        return list(self.designations.get(code, []))


class FiscalYearTests(unittest.TestCase):
    def test_september_2026_is_fy_2027(self):
        fy, start, end = fiscal_year_window(dt.date(2026, 9, 3))
        self.assertEqual(fy, 2027)
        self.assertEqual(start, dt.date(2026, 7, 1))
        self.assertEqual(end, dt.date(2027, 6, 30))
        self.assertEqual(fiscal_year_label(fy), "FY 2026-27")

    def test_june_30_2026_is_fy_2026(self):
        fy, start, end = fiscal_year_window(dt.date(2026, 6, 30))
        self.assertEqual(fy, 2026)
        self.assertEqual(start, dt.date(2025, 7, 1))
        self.assertEqual(end, dt.date(2026, 6, 30))
        self.assertEqual(fiscal_year_label(fy), "FY 2025-26")

    def test_july_1_rolls_forward(self):
        fy, start, end = fiscal_year_window(dt.date(2026, 7, 1))
        self.assertEqual(fy, 2027)
        self.assertEqual(start, dt.date(2026, 7, 1))
        self.assertEqual(end, dt.date(2027, 6, 30))


class CatalogTests(unittest.TestCase):
    def test_catalog_has_19_sports_xc_and_womens_golf_unmapped(self):
        sports = load_sports_catalog()
        keys = [s["key"] for s in sports]
        self.assertEqual(len(sports), 19)
        self.assertEqual(len(set(keys)), 19)
        by_key = {s["key"]: s["projectCode"] for s in sports}
        self.assertIsNone(by_key["cross-country"])
        self.assertIsNone(by_key["womens-golf"])
        self.assertEqual(by_key["football"], "6552FB")
        self.assertNotIn("6117AthGEN", by_key.values())
        self.assertNotIn("6644", by_key.values())

    def test_forbidden_codes_in_catalog_text_become_unmapped(self):
        text = """
export const SPORTS: SportDef[] = [
  { key: "football", label: "Football", virtuousProjectCode: "6552FB" },
  { key: "bad-gen", label: "General", virtuousProjectCode: "6117AthGEN" },
  { key: "bad-boost", label: "Booster", virtuousProjectCode: "6644" },
];

export const sportByKey
"""
        sports = parse_sports_catalog(text)
        by_key = {s["key"]: s["projectCode"] for s in sports}
        self.assertEqual(by_key["football"], "6552FB")
        self.assertIsNone(by_key["bad-gen"])
        self.assertIsNone(by_key["bad-boost"])


class AllTimeProjectTests(unittest.TestCase):
    def test_prefers_raised_amount_and_gift_amount(self):
        amount, count = all_time_from_project({"raisedAmount": "1500.50", "giftAmount": 9})
        self.assertEqual(amount, 1500.50)
        self.assertEqual(count, 9)

    def test_falls_back_to_life_to_date_fields(self):
        amount, count = all_time_from_project(
            {"lifeToDateGiving": 2000, "lifeToDateGiftCount": "4"}
        )
        self.assertEqual(amount, 2000.0)
        self.assertEqual(count, 4)

    def test_missing_count_is_none(self):
        amount, count = all_time_from_project({"raisedAmount": 10})
        self.assertEqual(amount, 10.0)
        self.assertIsNone(count)


class FytdDesignationTests(unittest.TestCase):
    def test_null_code_is_not_used_as_zero(self):
        row = unmapped_row("womens-golf", None)
        self.assertFalse(row["mapped"])
        self.assertIsNone(row["fytdAmount"])
        self.assertIsNone(row["fytdGiftCount"])
        self.assertIsNone(row["allTimeAmount"])
        self.assertIsNone(row["allTimeGiftCount"])
        self.assertEqual(row["reason"], "unmapped")

    def test_split_uses_only_amount_designated_for_football(self):
        rows = [
            _des(code="6552FB", amount=100, gift_date="2026-07-01", gift_id=10),
            _des(code="6117AthGEN", amount=50, gift_date="2026-07-01", gift_id=10),
            _des(code="6644", amount=25, gift_date="2026-07-01", gift_id=10),
        ]
        amount, count = fytd_from_designations(
            "6552FB", rows, dt.date(2026, 7, 1), dt.date(2027, 6, 30)
        )
        self.assertEqual(amount, 100.0)
        self.assertEqual(count, 1)

    def test_gift_on_june_30_not_in_fy27_july_1_is(self):
        rows = [
            _des(code="6552FB", amount=40, gift_date="2026-06-30", gift_id=1),
            _des(code="6552FB", amount=60, gift_date="2026-07-01", gift_id=2),
            _des(code="6552FB", amount=5, gift_date="6/30/2026", gift_id=3),
        ]
        amount, count = fytd_from_designations(
            "6552FB", rows, dt.date(2026, 7, 1), dt.date(2027, 6, 30)
        )
        self.assertEqual(amount, 60.0)
        self.assertEqual(count, 1)

    def test_parse_gift_date_md_and_iso(self):
        self.assertEqual(parse_gift_date("7/1/2026"), dt.date(2026, 7, 1))
        self.assertEqual(parse_gift_date("2026-07-01T04:00:00"), dt.date(2026, 7, 1))


class SnapshotTests(unittest.TestCase):
    def _sports(self) -> list[dict[str, str | None]]:
        return load_sports_catalog()

    def test_snapshot_has_19_keys_unmapped_and_no_forbidden(self):
        sports = self._sports()
        as_of = "2026-09-03T12:00:00Z"
        rows = {}
        for sport in sports:
            key = str(sport["key"])
            code = sport.get("projectCode")
            if not code:
                rows[key] = unmapped_row(key, None)
            else:
                rows[key] = mapped_row(
                    key,
                    code,
                    fytd_amount=1,
                    fytd_gift_count=1,
                    all_time_amount=2,
                    all_time_gift_count=2,
                    as_of=as_of,
                )
        # Inject forbidden designations into the football total path; output must omit them.
        snap = build_snapshot(sports, rows, today=dt.date(2026, 9, 3), generated_at=as_of)
        self.assertEqual(len(snap["sports"]), 19)
        self.assertEqual(snap["fiscalYear"], 2027)
        self.assertEqual(snap["fiscalYearLabel"], "FY 2026-27")
        self.assertEqual(snap["fyStart"], "2026-07-01")
        self.assertEqual(snap["fyEnd"], "2027-06-30")
        self.assertFalse(snap["sports"]["cross-country"]["mapped"])
        self.assertIsNone(snap["sports"]["cross-country"]["fytdAmount"])
        self.assertFalse(snap["sports"]["womens-golf"]["mapped"])
        self.assertIsNone(snap["sports"]["womens-golf"]["allTimeAmount"])
        dumped = json.dumps(snap)
        self.assertNotIn("6117AthGEN", dumped)
        self.assertNotIn("6644", dumped)
        codes = {row["projectCode"] for row in snap["sports"].values()}
        self.assertTrue(FORBIDDEN_CODES.isdisjoint(codes))

    def test_collect_skips_forbidden_splits_and_unmapped(self):
        sports = [
            {"key": "football", "projectCode": "6552FB"},
            {"key": "cross-country", "projectCode": None},
            {"key": "womens-golf", "projectCode": None},
        ]
        client = FakeClient(
            {
                "6552FB": {"raisedAmount": 500, "giftAmount": 3},
            },
            {
                "6552FB": [
                    _des(code="6552FB", amount=80, gift_date="2026-07-01", gift_id=1),
                    _des(code="6117AthGEN", amount=20, gift_date="2026-07-01", gift_id=1),
                    _des(code="6552FB", amount=10, gift_date="2026-06-30", gift_id=2),
                ],
            },
        )
        snap = collect_snapshot(
            client,
            sports,
            today=dt.date(2026, 9, 3),
            generated_at="2026-09-03T12:00:00Z",
        )
        football = snap["sports"]["football"]
        self.assertTrue(football["mapped"])
        self.assertEqual(football["fytdAmount"], 80.0)
        self.assertEqual(football["fytdGiftCount"], 1)
        self.assertEqual(football["allTimeAmount"], 500.0)
        self.assertEqual(football["allTimeGiftCount"], 3)
        self.assertEqual(snap["sports"]["cross-country"]["reason"], "unmapped")
        self.assertIsNone(snap["sports"]["cross-country"]["fytdAmount"])
        self.assertEqual(snap["sports"]["womens-golf"]["reason"], "unmapped")
        dumped = json.dumps(snap)
        self.assertNotIn("6117AthGEN", dumped)
        self.assertNotIn("6644", dumped)

    def test_missing_project_is_unavailable_not_zero(self):
        sports = [{"key": "football", "projectCode": "6552FB"}]
        client = FakeClient({}, {})
        snap = collect_snapshot(
            client,
            sports,
            today=dt.date(2026, 9, 3),
            generated_at="2026-09-03T12:00:00Z",
        )
        row = snap["sports"]["football"]
        self.assertEqual(row["reason"], "unavailable")
        self.assertIsNone(row["fytdAmount"])
        self.assertIsNone(row["allTimeAmount"])

    def test_counts_designations_when_project_has_no_gift_count(self):
        sports = [{"key": "football", "projectCode": "6552FB"}]
        client = FakeClient(
            {"6552FB": {"raisedAmount": 90}},
            {
                "6552FB": [
                    _des(code="6552FB", amount=40, gift_date="2025-01-01", gift_id=1),
                    _des(code="6552FB", amount=50, gift_date="2026-08-01", gift_id=2),
                ]
            },
        )
        snap = collect_snapshot(
            client,
            sports,
            today=dt.date(2026, 9, 3),
            generated_at="2026-09-03T12:00:00Z",
        )
        row = snap["sports"]["football"]
        self.assertEqual(row["allTimeAmount"], 90.0)
        self.assertEqual(row["allTimeGiftCount"], 2)
        self.assertEqual(row["fytdAmount"], 50.0)
        self.assertEqual(row["fytdGiftCount"], 1)

    def test_designation_query_uses_project_code_and_fy_bounds(self):
        body = designation_query("6552FB", dt.date(2026, 7, 1), dt.date(2027, 6, 30))
        conditions = body["groups"][0]["conditions"]
        self.assertEqual(conditions[0], {"parameter": "Project Code", "operator": "Is", "value": "6552FB"})
        self.assertEqual(
            conditions[1],
            {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "2026-07-01"},
        )
        self.assertEqual(
            conditions[2],
            {"parameter": "Gift Date", "operator": "OnOrBefore", "value": "2027-06-30"},
        )

    def test_unavailable_row_is_not_zeros(self):
        row = unavailable_row("football", "6552FB")
        self.assertTrue(row["mapped"])
        self.assertIsNone(row["fytdAmount"])
        self.assertIsNone(row["fytdGiftCount"])
        self.assertEqual(row["reason"], "unavailable")


if __name__ == "__main__":
    unittest.main()
