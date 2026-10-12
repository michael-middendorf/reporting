"""Unit tests for the thank-you letter cards publisher (no network, synthetic data).

Run: PYTHONPATH=services/publishers python -m unittest discover -s services/publishers/ty-letters -t services/publishers/ty-letters
"""
from __future__ import annotations

import datetime as dt
import unittest

from handler import (
    Budget,
    address_lines,
    addressee,
    assemble,
    build_asof,
    build_asof_for_gifts,
    contact_fields,
    credited_amount,
    donor_contact_id,
    dry_run_summary,
    fund_names,
    is_anonymous,
    phone,
    reversed_gift_ids,
    salutation,
    select_window_gifts,
    strip_segment,
)

DONOR = 1001
OTHER = 2002


def gift(gid, date, amount, *, contact=DONOR, passthrough=None, pt_amount=None, gift_type="Check", **extra):
    g = {
        "id": gid,
        "giftDate": f"{date}T00:00:00",
        "amount": amount,
        "contactId": contact,
        "contactName": "Test Donor" if contact == DONOR else "Test Foundation",
        "giftType": gift_type,
        "segment": "Test Appeal",
        "batch": "B1",
        "giftDesignations": [{"project": "General Fund", "amountDesignated": amount}],
        "modifiedDateTimeUtc": "2026-01-01T00:00:00",
    }
    if passthrough is not None:
        g["contactPassthroughId"] = passthrough
        g["giftPassthroughs"] = [{"contactId": passthrough, "passthroughAmount": pt_amount}]
    g.update(extra)
    return g


class DonorResolutionTests(unittest.TestCase):
    def test_passthrough_wins(self):
        self.assertEqual(donor_contact_id(gift(1, "2026-09-01", 5000, contact=OTHER, passthrough=DONOR)), DONOR)

    def test_contact_when_no_passthrough(self):
        self.assertEqual(donor_contact_id(gift(1, "2026-09-01", 5000)), DONOR)

    def test_credited_amount_soft_and_hard(self):
        soft = gift(1, "2026-09-01", 5000, contact=OTHER, passthrough=DONOR, pt_amount=2500)
        self.assertEqual(float(credited_amount(soft, DONOR)), 2500.0)
        soft_no_amount = gift(2, "2026-09-01", 5000, contact=OTHER, passthrough=DONOR, pt_amount=None)
        self.assertEqual(float(credited_amount(soft_no_amount, DONOR)), 5000.0)
        self.assertEqual(float(credited_amount(gift(3, "2026-09-01", 700), DONOR)), 700.0)


class AsOfTests(unittest.TestCase):
    def test_history_after_thanked_date_is_ignored(self):
        thanked = gift(10, "2026-09-01", 5000)
        history = [gift(5, "2020-01-01", 100), gift(20, "2026-09-15", 99999), thanked]
        out = build_asof(DONOR, thanked, history, set())
        self.assertEqual(out["totalGiving"], 5100.0)
        self.assertEqual(out["rows"]["largest"]["giftId"], "10")
        self.assertEqual(out["rows"]["latest"]["giftId"], "10")
        self.assertEqual(out["rows"]["first"]["giftId"], "5")

    def test_same_date_gifts_all_included(self):
        thanked = gift(10, "2026-09-01", 5000)
        out = build_asof(DONOR, thanked, [gift(11, "2026-09-01", 300), thanked], set())
        self.assertEqual(out["totalGiving"], 5300.0)
        # Tie on date: higher gift id is more recent.
        self.assertEqual(out["rows"]["latest"]["giftId"], "11")
        self.assertEqual(out["rows"]["secondLatest"]["giftId"], "10")

    def test_thanked_gift_added_when_missing_from_history(self):
        thanked = gift(10, "2026-09-01", 5000)
        out = build_asof(DONOR, thanked, [], set())
        self.assertEqual(out["totalGiving"], 5000.0)
        self.assertIsNone(out["rows"]["secondLatest"])


class ExclusionTests(unittest.TestCase):
    def test_zero_reversed_and_reversing_excluded(self):
        thanked = gift(10, "2026-09-01", 5000)
        history = [
            thanked,
            gift(1, "2019-01-01", 0),
            gift(2, "2018-01-01", 40000),
            gift(3, "2018-02-01", -40000, gift_type="ReversingTransaction", reversedGiftId=2),
            gift(4, "2017-01-01", 250),
        ]
        reversed_ids = reversed_gift_ids([history[3]])
        self.assertEqual(reversed_ids, {2})
        out = build_asof(DONOR, thanked, history, reversed_ids)
        self.assertEqual(out["totalGiving"], 5250.0)
        self.assertEqual(out["rows"]["first"]["giftId"], "4")
        self.assertEqual(out["rows"]["largest"]["giftId"], "10")
        picked = {r["giftId"] for r in out["rows"].values() if r}
        self.assertFalse(picked & {"1", "2", "3"})

    def test_unmatched_refund_nets_total_but_is_never_a_row(self):
        thanked = gift(10, "2026-09-01", 5000)
        refund = gift(9, "2026-08-01", -25, gift_type="ReversingTransaction", reversedGiftId=None)
        out = build_asof(DONOR, thanked, [thanked, gift(8, "2026-07-01", 25), refund], set())
        self.assertEqual(out["totalGiving"], 5000.0)
        self.assertNotIn("9", {r["giftId"] for r in out["rows"].values() if r})

    def test_window_selection(self):
        rows = [
            gift(1, "2026-09-01", 999.99),
            gift(2, "2026-09-01", 1000),
            gift(3, "2026-09-01", 5000),
            gift(4, "2026-09-01", -5000, gift_type="ReversingTransaction", reversedGiftId=3),
        ]
        picked = select_window_gifts(rows, reversed_gift_ids(rows))
        self.assertEqual([g["id"] for g in picked], [2])


class TieBreakTests(unittest.TestCase):
    def test_largest_tie_goes_to_most_recent(self):
        thanked = gift(30, "2026-09-01", 1000)
        history = [thanked, gift(10, "2020-01-01", 7000), gift(20, "2023-01-01", 7000)]
        out = build_asof(DONOR, thanked, history, set())
        self.assertEqual(out["rows"]["largest"]["giftId"], "20")

    def test_first_is_earliest(self):
        thanked = gift(30, "2026-09-01", 1000)
        history = [thanked, gift(12, "2010-05-05", 50), gift(11, "2010-05-05", 60)]
        out = build_asof(DONOR, thanked, history, set())
        self.assertEqual(out["rows"]["first"]["giftId"], "11")


class SoftCreditTotalTests(unittest.TestCase):
    def test_total_mixes_hard_and_soft(self):
        thanked = gift(30, "2026-09-01", 10000, contact=OTHER, passthrough=DONOR, pt_amount=10000)
        history = [
            thanked,
            gift(10, "2020-01-01", 1000),
            gift(20, "2022-01-01", 8000, contact=OTHER, passthrough=DONOR, pt_amount=4000),
            gift(25, "2023-01-01", 500, contact=OTHER),  # not credited to the donor
        ]
        out = build_asof(DONOR, thanked, history, set())
        self.assertEqual(out["totalGiving"], 15000.0)
        self.assertEqual(out["rows"]["secondLatest"]["amount"], 4000.0)
        self.assertEqual(out["rows"]["secondLatest"]["hardCredit"], "Test Foundation")


class RowFieldTests(unittest.TestCase):
    def test_segment_suffix_strip(self):
        self.assertEqual(strip_segment("2019 Christmas Appeal-HIST_AB12"), "2019 Christmas Appeal")
        self.assertEqual(strip_segment("Spring Appeal"), "Spring Appeal")
        self.assertEqual(strip_segment(None), "")

    def test_fund_order_by_amount(self):
        g = {"giftDesignations": [
            {"project": "Small Fund", "amountDesignated": 100},
            {"project": "Big Fund", "amountDesignated": 900},
        ]}
        self.assertEqual(fund_names(g), "Big Fund; Small Fund")

    def test_raw_gift_type(self):
        thanked = gift(30, "2026-09-01", 1000, gift_type="Stock")
        out = build_asof(DONOR, thanked, [thanked], set())
        self.assertEqual(out["rows"]["latest"]["type"], "Stock")
        self.assertEqual(out["rows"]["latest"]["date"], "2026-09-01")


CONTACT = {
    "id": DONOR,
    "name": "Test Donor",
    "preferredSalutationName": "Default",
    "preferredAddresseeName": "Default",
    "formalContactName": "Mr. Test Donor",
    "address": {"address1": "1 Test Way", "address2": None, "city": "Testville", "state": "FL", "postal": "00000", "country": "United States"},
    "tags": ["No Children"],
    "customFields": [],
    "contactIndividuals": [
        {"isPrimary": True, "isDeceased": True, "contactMethods": [{"type": "Mobile Phone", "value": "555-0100"}]},
        {"isPrimary": False, "isDeceased": False, "contactMethods": [
            {"type": "Home Phone", "value": "555-0101"},
            {"type": "Mobile Phone", "value": "555-0102"},
        ]},
    ],
}


class ContactTests(unittest.TestCase):
    def test_default_placeholders(self):
        self.assertEqual(salutation(CONTACT), "")
        self.assertEqual(addressee(CONTACT), "Mr. Test Donor")
        self.assertEqual(addressee({**CONTACT, "formalContactName": "Default Contact"}), "")
        self.assertEqual(salutation({**CONTACT, "preferredSalutationName": "Test"}), "Test")

    def test_phone_skips_deceased_primary(self):
        self.assertEqual(phone(CONTACT, "Mobile Phone"), "555-0102")
        self.assertEqual(phone(CONTACT, "Home Phone"), "555-0101")
        living_primary = {"contactIndividuals": [
            {"isPrimary": False, "contactMethods": [{"type": "Mobile Phone", "value": "555-0200"}]},
            {"isPrimary": True, "contactMethods": [{"type": "Mobile Phone", "value": "555-0201"}]},
        ]}
        self.assertEqual(phone(living_primary, "Mobile Phone"), "555-0201")

    def test_address_lines(self):
        self.assertEqual(address_lines(CONTACT), ["1 Test Way", "Testville, FL 00000"])

    def test_solicitor_fallback(self):
        thanked = gift(1, "2026-09-01", 5000, customFields=[{"name": "GFT_Solicitor", "value": "Test Officer"}])
        self.assertEqual(contact_fields(CONTACT, thanked, DONOR)["solicitor"], "Test Officer")
        with_contact = {**CONTACT, "customFields": [{"name": "Solicitor", "value": "Contact Officer"}]}
        self.assertEqual(contact_fields(with_contact, thanked, DONOR)["solicitor"], "Contact Officer")

    def test_anonymous_tag(self):
        self.assertFalse(is_anonymous(CONTACT))
        self.assertTrue(is_anonymous({"tags": ["anonymous donor"]}))


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class CacheAndBudgetTests(unittest.TestCase):
    def test_cache_reuse_and_rebuild_on_modified(self):
        g1 = gift(101, "2026-09-02", 5000)
        g2 = gift(102, "2026-09-01", 2000)
        previous = {"cards": [
            {"giftId": "101", "donorContactId": str(DONOR), "giftModified": g1["modifiedDateTimeUtc"],
             "rows": {"latest": None, "secondLatest": None, "largest": None, "first": None}, "totalGiving": 123.0},
            {"giftId": "102", "donorContactId": str(DONOR), "giftModified": "stale",
             "rows": {}, "totalGiving": 1.0},
        ]}
        calls = []

        def history_fn(_client, donors):
            calls.append(list(donors))
            return {d: [g1, g2] for d in donors}

        from handler import _cache_hit, cached_asof

        cache = cached_asof(previous)
        todo = [g for g in (g1, g2) if not _cache_hit(cache.get(str(g["id"])), g)]
        self.assertEqual([g["id"] for g in todo], [102])
        built = build_asof_for_gifts(None, todo, set(), Budget(600), history_fn=history_fn)
        snap = assemble(window_gifts=[g1, g2], previous=previous, built=built, contacts={DONOR: CONTACT},
                        window_start=dt.date(2026, 8, 1), window_end=dt.date(2026, 9, 30), generated_at="t")
        self.assertEqual(len(calls), 1)
        by_id = {c["giftId"]: c for c in snap["cards"]}
        self.assertEqual(by_id["101"]["totalGiving"], 123.0)
        self.assertEqual(by_id["102"]["totalGiving"], 2000.0)  # as of 09-01, gift 101 is later
        self.assertFalse(snap["partial"])
        self.assertEqual([c["giftId"] for c in snap["cards"]], ["101", "102"])

    def test_budget_marks_partial(self):
        clock = FakeClock()
        gifts = [gift(200 + i, "2026-09-01", 1000, contact=3000 + i) for i in range(4)]

        def history_fn(_client, donors):
            clock.now += 700  # first batch blows the budget
            return {d: [] for d in donors}

        built = build_asof_for_gifts(None, gifts, set(), Budget(600, clock), history_fn=history_fn,
                                     concurrency=1, donor_batch=1)
        self.assertEqual(len(built), 1)
        snap = assemble(window_gifts=gifts, previous=None, built=built, contacts={},
                        window_start=dt.date(2026, 8, 1), window_end=dt.date(2026, 9, 30), generated_at="t")
        self.assertTrue(snap["partial"])
        self.assertEqual(snap["pending"], 3)
        self.assertEqual(len(snap["cards"]), 1)
        summary = dry_run_summary(snap, requests=1, elapsed=1.0)
        self.assertEqual(summary["cards"], 1)
        self.assertNotIn("Test Donor", str(summary))


if __name__ == "__main__":
    unittest.main()
