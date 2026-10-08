"""Unit tests for Year-End Appeal aggregations (no network, no AWS)."""
from __future__ import annotations

import datetime as dt
import json
import os
import unittest
from unittest.mock import patch

from handler import (
    build_aggregates,
    build_payload,
    classify_gifts,
    gift_breakdown,
    load_registry,
    normalize_gifts,
    normalize_mailed,
    pace_series,
    summarize,
    weekly_timeline,
)

REGISTRY = load_registry()
D = dt.date(2026, 11, 20)


def g(contact: int, amount: float, segment: str | None, day: dt.date = D) -> dict:
    return {"contactId": contact, "amount": amount, "date": day, "segment": segment}


def row(rows: list[dict], **want) -> dict:
    found = [r for r in rows if all(r.get(k) == v for k, v in want.items())]
    assert len(found) == 1, (want, found)
    return found[0]


class FakeClient:
    def __init__(self, by_campaign: dict[str, list[dict]]):
        self.by_campaign = by_campaign

    def paged_query(self, path, body, page_size=1000):
        return self.by_campaign[body["groups"][0]["conditions"][0]["value"]]


class RegistryTests(unittest.TestCase):
    def test_committed_registry_shape(self):
        self.assertEqual(len(REGISTRY), 27)
        codes = [e["code"] for e in REGISTRY]
        self.assertEqual(len(set(codes)), 27)
        self.assertIn("FYE27YE_LP12_4P_WEB", codes)
        ss = row(REGISTRY, code="FYE27YE_SS")
        self.assertIsNone(ss["segment"])
        self.assertIsNone(ss["length"])
        self.assertEqual(row(REGISTRY, code="FYE27YE_A_PC")["segment"], "A")
        self.assertEqual(row(REGISTRY, code="FYE27YE_A_SOC")["asset"], "SOC")
        for e in REGISTRY:
            self.assertIn(e["asset"], {"RD", "BRE", "EML", "WEB", "PC", "SS", "SOC"})

    def test_registry_file_matches_scheme(self):
        raw = json.loads(open(os.path.join(os.path.dirname(__file__), "year-end-codes.json")).read())
        for e in raw:
            if e["length"]:
                self.assertEqual(e["code"], f"FYE27YE_{e['segment']}_{e['length']}_{e['asset']}")


class MatchingTests(unittest.TestCase):
    def test_matched_unmatched_and_null_segment(self):
        gifts = [
            g(1, 100, "FYE27YE_A_2P_RD"),
            g(2, 50, " fye27ye_a_2p_rd "),  # case/space normalized
            g(3, 25, "FYE27YE_SS"),  # matched, donor segment null
            g(4, 10, "SOMETHING_ELSE"),
            g(5, 5, None),
            g(6, 7, ""),
        ]
        matched, unmatched = classify_gifts(gifts, REGISTRY)
        self.assertEqual(len(matched), 3)
        self.assertEqual(len(unmatched), 3)
        agg = build_aggregates(gifts, REGISTRY)
        self.assertEqual(agg["unmatched"]["gifts"], 3)
        self.assertEqual(agg["unmatched"]["revenue"], 22.0)
        self.assertEqual(agg["unmatched"]["codes"], ["(blank)", "SOMETHING_ELSE"])
        rd = row(agg["byCode"], code="FYE27YE_A_2P_RD")
        self.assertEqual((rd["revenue"], rd["gifts"], rd["donors"], rd["avgGift"]), (150.0, 2, 2, 75.0))
        # SS is matched with a null donor segment: it lives in the "none" row,
        # not in unmatched.
        none_row = row(agg["bySegment"], key="none")
        self.assertEqual((none_row["revenue"], none_row["gifts"]), (25.0, 1))
        self.assertEqual(row(agg["byAsset"], asset="SS")["revenue"], 25.0)
        # Everything reconciles to the gift total.
        total = sum(r["revenue"] for r in agg["bySegment"]) + agg["unmatched"]["revenue"]
        self.assertEqual(round(total, 2), round(sum(x["amount"] for x in gifts), 2))

    def test_zero_gifts_has_every_code(self):
        agg = build_aggregates([], REGISTRY)
        self.assertEqual(len(agg["byCode"]), 27)
        self.assertEqual(agg["unmatched"], {"revenue": 0.0, "gifts": 0, "codes": []})
        self.assertTrue(all(r["revenue"] == 0 and r["mailed"] is None for r in agg["byCode"]))

    def test_length_head_to_head_and_rollup_donors_are_distinct(self):
        gifts = [
            g(1, 100, "FYE27YE_A_2P_RD"),
            g(1, 40, "FYE27YE_A_2P_WEB"),  # same donor, two codes
            g(2, 200, "FYE27YE_A_4P_RD"),
            g(3, 60, "FYE27YE_LP12_4P_EML"),
            g(4, 30, "FYE27YE_A_PC"),  # no length: excluded from byLength
        ]
        agg = build_aggregates(gifts, REGISTRY)
        total_2p = row(agg["byLength"], scope="total", length="2P")
        total_4p = row(agg["byLength"], scope="total", length="4P")
        self.assertEqual((total_2p["revenue"], total_2p["gifts"], total_2p["donors"]), (140.0, 2, 1))
        self.assertEqual((total_4p["revenue"], total_4p["gifts"], total_4p["donors"]), (260.0, 2, 2))
        self.assertEqual(row(agg["byLength"], scope="A", length="4P")["revenue"], 200.0)
        self.assertEqual(row(agg["byLength"], scope="LP12", length="2P")["gifts"], 0)
        seg_a = row(agg["bySegment"], key="A")
        self.assertEqual(seg_a["donors"], 3)  # donors 1, 2, 4 (donor 1 once)
        self.assertEqual(row(agg["byAsset"], asset="PC")["revenue"], 30.0)


class MailedTests(unittest.TestCase):
    def test_mailed_absent_gives_null_rate(self):
        agg = build_aggregates([g(1, 10, "FYE27YE_A_2P_RD")], REGISTRY, None)
        self.assertFalse(agg["mailedAvailable"])
        for section in ("byCode", "bySegment", "byAsset", "byLength"):
            for r in agg[section]:
                self.assertIsNone(r["mailed"])
                self.assertIsNone(r["responseRate"])

    def test_mailed_present_computes_rate(self):
        mailed = {"FYE27YE_A_2P_RD": 200, "fye27ye_a_2p_bre": 100, "FYE27YE_A_4P_RD": 0}
        gifts = [g(1, 10, "FYE27YE_A_2P_RD"), g(2, 20, "FYE27YE_A_2P_RD"), g(3, 5, "FYE27YE_A_4P_RD")]
        agg = build_aggregates(gifts, REGISTRY, normalize_mailed(mailed))
        self.assertTrue(agg["mailedAvailable"])
        rd = row(agg["byCode"], code="FYE27YE_A_2P_RD")
        self.assertEqual((rd["mailed"], rd["responseRate"]), (200, 1.0))
        # A code with no count stays null, and a zero count is treated as absent.
        self.assertIsNone(row(agg["byCode"], code="FYE27YE_A_4P_RD")["mailed"])
        self.assertIsNone(row(agg["byCode"], code="FYE27YE_A_4P_RD")["responseRate"])
        # 2P/A rollup: only gift-bearing code is A_2P_RD (counted); A_2P_BRE has a
        # count but no gifts, so it adds to the denominator: 200 + 100, 2 donors.
        two_p_a = row(agg["byLength"], scope="A", length="2P")
        self.assertEqual(two_p_a["mailed"], 300)
        self.assertEqual(two_p_a["responseRate"], round(100 * 2 / 300, 2))
        # Segment A has a gift-bearing code (A_4P_RD) with no count: rollup is null.
        seg_a = row(agg["bySegment"], key="A")
        self.assertIsNone(seg_a["mailed"])
        self.assertIsNone(seg_a["responseRate"])

    def test_rollup_rate_null_when_only_some_gift_codes_have_counts(self):
        gifts = [g(1, 10, "FYE27YE_A_2P_RD"), g(2, 20, "FYE27YE_A_2P_WEB"), g(3, 5, "FYE27YE_A_2P_EML")]
        agg = build_aggregates(gifts, REGISTRY, {"FYE27YE_A_2P_RD": 100})
        # The one counted code still reports its own rate.
        self.assertEqual(row(agg["byCode"], code="FYE27YE_A_2P_RD")["responseRate"], 1.0)
        for r in (
            row(agg["byLength"], scope="A", length="2P"),
            row(agg["byLength"], scope="total", length="2P"),
            row(agg["bySegment"], key="A"),
        ):
            self.assertIsNone(r["mailed"])
            self.assertIsNone(r["responseRate"])
        self.assertIsNone(row(agg["byAsset"], asset="WEB")["responseRate"])

    def test_rollup_rate_computed_when_all_gift_codes_have_counts(self):
        gifts = [g(1, 10, "FYE27YE_A_2P_RD"), g(2, 20, "FYE27YE_A_2P_WEB"), g(2, 5, "FYE27YE_A_2P_RD")]
        mailed = {"FYE27YE_A_2P_RD": 100, "FYE27YE_A_2P_WEB": 50}
        agg = build_aggregates(gifts, REGISTRY, mailed)
        r = row(agg["byLength"], scope="A", length="2P")
        self.assertEqual(r["mailed"], 150)
        self.assertEqual(r["donors"], 2)
        self.assertEqual(r["responseRate"], round(100 * 2 / 150, 2))
        # A_2P_BRE/EML have no gifts and no counts, which is fine.
        self.assertEqual(row(agg["byAsset"], asset="RD")["responseRate"], 2.0 * 0 + round(100 * 2 / 100, 2))

    def test_normalize_mailed_drops_bad_values(self):
        self.assertEqual(normalize_mailed({"a": "12", "b": "x", "c": True, "d": -3}), {"A": 12})
        self.assertEqual(normalize_mailed([1, 2]), {})


class CoreTests(unittest.TestCase):
    def test_normalize_drops_undated(self):
        rows = [
            {"contactId": 1, "amount": "$1,000.50", "giftDate": "11/13/2026", "segment": "X"},
            {"contactId": 2, "amount": "5", "giftDate": "", "segment": "Y"},
        ]
        out = normalize_gifts(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["amount"], 1000.5)

    def test_summary_breakdown_reconcile(self):
        gifts = [g(1, 50, "A"), g(2, 150, "A"), g(2, -20, "A")]
        s = summarize(gifts)
        self.assertEqual((s["totalRevenue"], s["totalGifts"], s["donors"]), (180.0, 3, 2))
        bands = gift_breakdown(gifts)
        self.assertEqual(round(sum(b["revenue"] for b in bands), 2), 180.0)
        self.assertNotIn("–", "".join(b["label"] for b in bands))

    def test_timeline_and_pace(self):
        gifts = [g(1, 10, "A", dt.date(2026, 11, 16)), g(2, 5, "A", dt.date(2026, 11, 30))]
        tl = weekly_timeline(gifts, [{"date": "11/18/2026", "label": "Mailer"}])
        self.assertEqual(len(tl), 3)
        self.assertEqual(tl[0]["overlays"], ["Mailer"])
        self.assertEqual(tl[-1]["cumRevenue"], 15.0)
        pace = pace_series(gifts, [g(9, 100, "A", dt.date(2025, 11, 2))], dt.date(2026, 11, 13), dt.date(2025, 11, 1), 3)
        self.assertEqual(pace["currentToDate"]["revenue"], 10.0)
        self.assertEqual(pace["priorToDate"]["revenue"], 100.0)

    def test_build_payload_end_to_end_no_pii(self):
        client = FakeClient({
            "2026 End of Calendar Year": [
                {"contactId": 77, "amount": "$100.00", "giftDate": "11/20/2026", "segment": "FYE27YE_A_2P_RD"},
                {"contactId": 78, "amount": "$25.00", "giftDate": "11/21/2026", "segment": "BOGUS"},
            ],
            "2025 End of Calendar Year": [
                {"contactId": 5, "amount": "$40.00", "giftDate": "11/05/2025", "segment": None},
            ],
        })
        with patch.dict(os.environ, {"YEAR_END_START": "2026-11-13", "YEAR_END_PRIOR_START": "2025-11-01"}):
            payload = build_payload(
                client, "2026 End of Calendar Year", "2025 End of Calendar Year", 1000,
                dt.date(2026, 11, 25), registry=REGISTRY, mailed={"FYE27YE_A_2P_RD": 10},
            )
        self.assertFalse(payload["empty"])
        self.assertEqual(payload["summary"]["totalRevenue"], 125.0)
        self.assertEqual(payload["unmatched"]["codes"], ["BOGUS"])
        self.assertEqual(payload["yoy"]["priorToDate"]["revenue"], 40.0)
        self.assertEqual(row(payload["byCode"], code="FYE27YE_A_2P_RD")["responseRate"], 10.0)
        self.assertEqual(payload["campaignStart"], "2026-11-13")
        text = json.dumps(payload)
        self.assertNotIn('"contactId"', text)

    def test_build_payload_empty_before_drop(self):
        client = FakeClient({"2026 End of Calendar Year": []})
        payload = build_payload(
            client, "2026 End of Calendar Year", "", 1000, dt.date(2026, 10, 7), registry=REGISTRY,
        )
        self.assertTrue(payload["empty"])
        self.assertEqual(payload["campaignStart"], "2026-11-13")
        self.assertEqual(payload["timeline"], [])
        self.assertEqual(len(payload["byCode"]), 27)


if __name__ == "__main__":
    unittest.main()
