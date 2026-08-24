"""agg_q2 / prospect_rows cover DST-1158 purchased-list field."""

from __future__ import annotations

import json
import unittest

import build


def _q2(*rows: dict) -> str:
    return json.dumps({"row": list(rows)})


def _row(**kwargs: object) -> dict:
    base = {
        "Region": "FL",
        "Status": "Prospect",
        "InstituteRecruitingBin": "",
        "InstituteRecruitingColumn": "",
        "MSATag": "",
        "PersonGPA-Self-Reportedhighschool": "",
        "PurchasedList": "N",
        "FirstName": "Ada",
        "LastName": "Lovelace",
        "PersonGUID": "guid-1",
    }
    base.update(kwargs)
    return base


class PurchasedListTests(unittest.TestCase):
    def test_is_purchased_accepts_y_yes_1_true(self):
        for v in ("Y", "y", "Yes", "1", "true", "TRUE"):
            self.assertTrue(build.is_purchased(v), v)
        for v in ("N", "no", "", None, "0", "false"):
            self.assertFalse(build.is_purchased(v), v)

    def test_agg_q2_counts_purchased_separately(self):
        raw = _q2(
            _row(PurchasedList="Y", Region="FL"),
            _row(PurchasedList="N", Region="FL"),
            _row(PurchasedList="", Region="TX"),
            _row(PurchasedList="yes", Region="OH"),
        )
        summary = build.agg_q2(raw)
        self.assertEqual(summary["total"], 4)
        self.assertEqual(summary["purchased"], 2)
        self.assertEqual(summary["byPurchased"], {"Y": 2, "N": 2})
        self.assertEqual(summary["byState"]["FL"], 2)

    def test_agg_q2_missing_field_counts_as_not_purchased(self):
        raw = _q2(_row())
        # Simulate a payload from before the Slate column existed.
        rows = json.loads(raw)["row"]
        rows[0].pop("PurchasedList")
        summary = build.agg_q2(json.dumps({"row": rows}))
        self.assertEqual(summary["purchased"], 0)
        self.assertEqual(summary["byPurchased"], {"N": 1})

    def test_prospect_rows_keep_purchased_and_drop_extra_fields(self):
        raw = _q2(_row(PurchasedList="Y", SecretField="drop-me", Email="a@b.c"))
        rows = build.prospect_rows(raw)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["PurchasedList"], "Y")
        self.assertEqual(rows[0]["Email"], "a@b.c")
        self.assertNotIn("SecretField", rows[0])

    def test_payload_inlines_q2_roster(self):
        data = build.payload(
            {
                "q1": json.dumps({"row": []}),
                "q2": _q2(_row(PurchasedList="Y"), _row(PurchasedList="N")),
                "q3": json.dumps({"row": []}),
                "q4": json.dumps({"row": []}),
                "q5": json.dumps({"row": []}),
                "q6": json.dumps({"row": []}),
            },
            ts="test",
        )
        self.assertEqual(len(data["q2"]), 2)
        self.assertEqual(data["q2_summary"]["purchased"], 1)
        self.assertEqual(data["counts"]["q2"], 2)


if __name__ == "__main__":
    unittest.main()
