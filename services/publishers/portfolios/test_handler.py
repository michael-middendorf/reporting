"""Unit tests for portfolio snapshot assembly (no network, no real donor names)."""
from __future__ import annotations

import unittest

from handler import (
    ROSTER,
    build_snapshot,
    classify_relationships,
    classify_stage,
    donor_sort_key,
    is_ma_portfolio,
    is_mgo_portfolio,
    split_creator_name,
)


class GroupNameTests(unittest.TestCase):
    def test_mgo_vs_ma(self):
        self.assertTrue(is_mgo_portfolio("Portfolio - James Thomas"))
        self.assertFalse(is_mgo_portfolio("MA Portfolio - Alanna"))
        self.assertTrue(is_ma_portfolio("MA Portfolio - Alanna"))
        self.assertFalse(is_ma_portfolio("Portfolio - Julie Musselman"))


class RosterStampTests(unittest.TestCase):
    def test_mgo_created_by_user_matches_live_virtuous_stamps(self):
        by_name = {p["name"]: p["createdByUser"] for p in ROSTER}
        self.assertEqual(by_name["Colleen M. Dolnick"], "Colleen Dolnick")
        self.assertEqual(by_name["James Thomas"], "Jim Thomas")
        self.assertEqual(by_name["Marita N. Emond"], "Marita Emond")
        self.assertEqual(by_name["Mark J. Middendorf"], "Mark Middendorf")
        self.assertEqual(by_name["Patrick J. O'Connell"], "Patrick OConnell")


class CreatorNameTests(unittest.TestCase):
    def test_split_creator_name_first_token_and_remainder(self):
        self.assertEqual(split_creator_name("Jim Thomas"), ("Jim", "Thomas"))
        self.assertEqual(split_creator_name("Patrick OConnell"), ("Patrick", "OConnell"))
        self.assertEqual(split_creator_name("Alanna McCann"), ("Alanna", "McCann"))


class TagTests(unittest.TestCase):
    def test_dual_stage_keeps_canonical_first(self):
        key, label = classify_stage(
            "mgo",
            [{"id": 76, "name": "Solicitation"}, {"id": 74, "name": "Identification"}],
        )
        self.assertEqual(key, "identification")
        self.assertEqual(label, "Identification")

    def test_dual_stage_by_prefixed_name_keeps_canonical_first(self):
        key, label = classify_stage(
            "mgo",
            [{"name": "MGO: Solicitation"}, {"name": "MGO: Identification"}],
        )
        self.assertEqual(key, "identification")
        self.assertEqual(label, "Identification")

    def test_mgo_stage_from_prefixed_tag_name(self):
        key, label = classify_stage("mgo", [{"name": "MGO: Cultivation"}])
        self.assertEqual(key, "cultivation")
        self.assertEqual(label, "Cultivation")

    def test_ma_stage_from_prefixed_tag_name(self):
        key, label = classify_stage("ma", [{"name": "MA: Engagement"}])
        self.assertEqual(key, "engagement")
        self.assertEqual(label, "Engagement")

    def test_untagged_and_ignored_ma_engaged(self):
        key, _label = classify_stage("ma", [{"id": 46, "name": "MA Engaged"}])
        self.assertEqual(key, "untagged")

    def test_relationships_canonical_order(self):
        rel = classify_relationships(
            "mgo",
            [{"name": "Prospect"}, {"name": "Current"}, {"name": "Estate Donor"}],
        )
        self.assertEqual(rel, ["Current", "Prospect", "Estate Donor"])

    def test_mgo_relationships_from_prefixed_tag_names(self):
        rel = classify_relationships(
            "mgo",
            [{"name": "MGO: Current"}, {"name": "MGO: Personal Relationship"}],
        )
        self.assertEqual(rel, ["Current", "Personal Relationship"])


class SnapshotTests(unittest.TestCase):
    def test_sorts_stale_donors_first_and_scopes_by_group(self):
        roster = [
            {
                "name": "Officer A",
                "email": "officer.a@avemaria.edu",
                "team": "mgo",
                "groupName": "Portfolio - Officer A",
                "createdByUser": "Officer A",
            }
        ]
        groups = [{"id": 9, "name": "Portfolio - Officer A"}]
        contacts = [
            {
                "id": 1,
                "name": "Donor Zulu",
                "lastGiftDate": "2025-01-01",
                "tags": [{"tagId": 75, "tagName": "Cultivation"}],
            },
            {
                "id": 2,
                "name": "Donor Alpha",
                "lastGiftDate": "2024-06-01",
                "tags": [{"tagId": 75, "tagName": "Cultivation"}],
            },
        ]
        activity = {
            "Officer A": {
                1: {"date": "2026-01-02", "by": "Officer A"},
            }
        }
        snap = build_snapshot(roster, groups, {9: contacts}, activity, "2026-09-14T00:00:00Z")
        self.assertEqual(len(snap["solicitors"]), 1)
        cult = next(s for s in snap["solicitors"][0]["stages"] if s["key"] == "cultivation")
        self.assertEqual([d["donorName"] for d in cult["donors"]], ["Donor Alpha", "Donor Zulu"])
        self.assertIsNone(cult["donors"][0]["lastActivityDate"])
        self.assertEqual(cult["donors"][1]["lastActivityDate"], "2026-01-02")
        self.assertEqual(donor_sort_key(cult["donors"][0])[0], 0)
