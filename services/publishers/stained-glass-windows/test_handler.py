"""Unit tests for stained-glass snapshot assembly (no network)."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from handler import (
    build_snapshot,
    chapel_object_from_naming,
    fold,
    load_inventory,
    match_window,
    specifics_subject,
    window_id,
)


def _gift(
    *,
    gid: int,
    contact_id: int,
    name: str,
    amount: float,
    naming: str,
    specifics: str | None = None,
    project: str = "AMU Student Chapel",
    gift_date: str = "2026-03-01",
) -> dict:
    fields = [{"name": "4 Naming Opportunity", "value": naming}]
    if specifics:
        fields.append({"name": "5 Naming Opportunity Specifics", "value": specifics})
    return {
        "id": gid,
        "contactId": contact_id,
        "contactName": name,
        "amount": amount,
        "giftDate": gift_date,
        "giftDesignations": [{"project": project}],
        "customFields": fields,
    }


def _inventory() -> list[dict]:
    return json.loads((Path(__file__).resolve().parent / "windows.json").read_text())


class ParseTests(unittest.TestCase):
    def test_chapel_object_parse(self):
        self.assertEqual(
            chapel_object_from_naming("STUDENT CHAPEL - ROSE WINDOW $125,000 (1)"),
            "ROSE WINDOW",
        )
        self.assertEqual(
            chapel_object_from_naming(
                "STUDENT CHAPEL - SMALL STAINED GLASS WINDOW $25,000 (16)"
            ),
            "SMALL STAINED GLASS WINDOW",
        )
        self.assertEqual(
            chapel_object_from_naming("STUDENT CHAPEL - NAVE WINDOW - St. Joseph $35,000"),
            "NAVE WINDOW - ST. JOSEPH",
        )
        self.assertEqual(
            chapel_object_from_naming(
                "STUDENT CHAPEL - SANCTUARY WINDOW - Immaculate Conception $25,000"
            ),
            "SANCTUARY WINDOW - IMMACULATE CONCEPTION",
        )

    def test_fold_collapses_field5_variants(self):
        self.assertEqual(fold("St. Patrick"), fold("St Patrick"))
        self.assertEqual(fold("Descent of the Holy Spirit"), fold("Descent of Holy Spirit"))
        self.assertEqual(fold("Wedding Feast at Cana"), fold("Wedding feast at Cana"))
        self.assertEqual(fold("Nativity of Our Lord"), fold("Nativity of our Lord"))
        self.assertEqual(fold("St. Thomas Aquinas"), fold(" St. Thomas Aquinas"))

    def test_specifics_subject_strips_prefixes(self):
        self.assertEqual(
            specifics_subject("Student Chapel Stained Glass Window - Annunciation"),
            "Annunciation",
        )
        self.assertEqual(
            specifics_subject("Student Chapel Saints in Nave -  St. Thomas Aquinas"),
            "St. Thomas Aquinas",
        )

    def test_window_id(self):
        self.assertEqual(window_id("nave", "St. Joseph"), "nave-st-joseph")
        self.assertEqual(
            window_id("sanctuary", "Immaculate Conception"),
            "sanctuary-immaculate-conception",
        )


class MatchTests(unittest.TestCase):
    def setUp(self):
        snapshot = build_snapshot([], _inventory())
        self.by_object = {w["chapelObject"]: w for w in snapshot["windows"] if w["fromInventory"]}
        self.by_fold = {fold(w["item"]): w for w in snapshot["windows"] if w["fromInventory"]}

    def test_named_nave_field4_wins(self):
        hit = match_window(
            "NAVE WINDOW - ST. FRANCIS OF ASSISI",
            "Student Chapel Saints in Nave - St. Joseph",
            self.by_object,
            self.by_fold,
        )
        self.assertEqual(hit["item"], "St. Francis of Assisi")

    def test_grouped_plus_field5_sanctuary(self):
        hit = match_window(
            "SMALL STAINED GLASS WINDOW",
            "Student Chapel Stained Glass Window - Descent of Holy Spirit",
            self.by_object,
            self.by_fold,
        )
        self.assertEqual(hit["item"], "Descent of the Holy Spirit")

    def test_grouped_without_specifics_is_unspecified(self):
        hit = match_window("SMALL STAINED GLASS WINDOW", None, self.by_object, self.by_fold)
        self.assertEqual(hit["id"], "unspecified")

    def test_non_window_is_skipped(self):
        self.assertIsNone(match_window("ALTAR", None, self.by_object, self.by_fold))


class SnapshotTests(unittest.TestCase):
    def test_inventory_has_39_named_windows(self):
        inv = load_inventory()
        self.assertEqual(len(inv), 39)
        self.assertEqual(sum(1 for r in inv if r["group"] == "rose"), 1)
        self.assertEqual(sum(1 for r in inv if r["group"] == "sanctuary"), 12)
        self.assertEqual(sum(1 for r in inv if r["group"] == "nave"), 26)

    def test_assigns_named_donors_and_keeps_unfunded_rows(self):
        gifts = [
            _gift(
                gid=1,
                contact_id=10,
                name="Rose Family",
                amount=115000,
                naming="STUDENT CHAPEL - ROSE WINDOW $125,000 (1)",
            ),
            _gift(
                gid=2,
                contact_id=20,
                name="Nave Donor",
                amount=35000,
                naming="STUDENT CHAPEL - NAVE WINDOW - St. Francis of Assisi $35,000",
            ),
            _gift(
                gid=3,
                contact_id=30,
                name="Sanctuary Donor",
                amount=25000,
                naming="STUDENT CHAPEL - SMALL STAINED GLASS WINDOW $25,000 (16)",
                specifics="Student Chapel Stained Glass Window - Annunciation",
            ),
            _gift(
                gid=4,
                contact_id=40,
                name="Unspecified Donor",
                amount=10000,
                naming="STUDENT CHAPEL - SMALL STAINED GLASS WINDOW $25,000 (16)",
            ),
            _gift(
                gid=5,
                contact_id=50,
                name="Pew Donor",
                amount=10000,
                naming="STUDENT CHAPEL - PEW $10,000 (34)",
            ),
            _gift(
                gid=6,
                contact_id=60,
                name="Wrong Project",
                amount=25000,
                naming="STUDENT CHAPEL - ROSE WINDOW $125,000 (1)",
                project="Annual Fund",
            ),
        ]
        snap = build_snapshot(gifts, _inventory())
        by_id = {w["id"]: w for w in snap["windows"]}
        flags = {
            g["donorName"]: g["anonymousDonor"]
            for w in snap["windows"] for g in w.get("gifts") or []
        }
        self.assertTrue(flags and all(flags.values()))  # tag lookup unknown: fail closed
        tagged = build_snapshot(gifts, _inventory(), anonymous_ids=frozenset({"10"}))
        tagged_flags = {
            str(g["contactId"]): g["anonymousDonor"]
            for w in tagged["windows"] for g in w.get("gifts") or []
        }
        self.assertTrue(tagged_flags.pop("10", True))
        self.assertTrue(tagged_flags and not any(tagged_flags.values()))

        self.assertEqual(snap["summary"]["windowCount"], 39)
        self.assertEqual(snap["summary"]["fullyFunded"], 2)  # Francis + Annunciation
        self.assertEqual(snap["summary"]["partial"], 1)  # Rose
        self.assertEqual(snap["summary"]["unfunded"], 36)
        self.assertEqual(snap["summary"]["giftCount"], 4)
        self.assertEqual(snap["summary"]["donorCount"], 4)
        self.assertEqual(snap["summary"]["amountReceived"], 185000)
        self.assertEqual(snap["summary"]["fundingRequest"], 125000 + 12 * 25000 + 26 * 35000)

        rose = by_id["rose-rose-window"]
        self.assertEqual(rose["amountReceived"], 115000)
        self.assertEqual(rose["gifts"][0]["donorName"], "Rose Family")

        francis = by_id["nave-st-francis-of-assisi"]
        self.assertEqual(francis["amountReceived"], 35000)
        self.assertEqual(francis["donorCount"], 1)

        annunciation = by_id["sanctuary-annunciation"]
        self.assertEqual(annunciation["amountReceived"], 25000)

        unspecified = by_id["unspecified"]
        self.assertFalse(unspecified["fromInventory"])
        self.assertEqual(unspecified["amountReceived"], 10000)
        self.assertEqual(unspecified["gifts"][0]["donorName"], "Unspecified Donor")

        self.assertEqual(snap["skipped"]["project"], 1)
        self.assertEqual(snap["skipped"]["notWindow"], 1)

        group_ids = [g["id"] for g in snap["groups"]]
        self.assertEqual(group_ids, ["rose", "sanctuary", "nave", "unspecified"])


if __name__ == "__main__":
    unittest.main()
