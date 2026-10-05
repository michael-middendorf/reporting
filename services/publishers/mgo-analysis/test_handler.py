"""Unit tests for the MGO Analysis snapshot (no network, fictional names)."""
from __future__ import annotations

import datetime as dt
import unittest

from handler import (
    TEAM_KEY,
    author_index,
    build_discovery,
    build_mgos,
    build_snapshot,
    classify_note_type,
    clean_note_text,
    fiscal_year_window,
    is_funded_ask,
    is_open_ask,
    is_open_ask_in_fy,
    is_top_prospect,
    map_user_to_mgo,
)

TODAY = dt.date(2026, 10, 1)
FY_START = dt.date(2026, 7, 1)
FY_END = dt.date(2027, 6, 30)

GROUPS = [
    {"id": 1, "name": "Portfolio - James Thomas"},
    {"id": 2, "name": "Portfolio - Patrick J. O'Connell"},
    {"id": 3, "name": "MA Portfolio - Alanna"},
]


class FiscalYearTests(unittest.TestCase):
    def test_october_2026_is_fy2027(self):
        fy, start, end = fiscal_year_window(TODAY)
        self.assertEqual(fy, 2027)
        self.assertEqual(start, FY_START)
        self.assertEqual(end, FY_END)


class NoteTypeTests(unittest.TestCase):
    def test_classification(self):
        cases = {
            "Mission Advancement Call | Conversation": None,
            "Letter": "outreach",
            "Text Message": "outreach",
            "Phone Call": "outreach",
            "In Person": "face_to_face",
            "MGO Plan for FY27": "plan",
            "FY27 MGO Plan": "plan",
            "FY27 MGO Goal Activity": "plan",
            "Goal Activity": None,
            "Mission Advancement Call | Goal": None,
            "Planned Gift / Bequest Documentation": None,
            "AS - Invalid Phone/Email Address": None,
            "Thank You": "outreach",
            "Direct Mail": "outreach",
            "Call": "outreach",
            "Email": "outreach",
            "Proposal / Gift Ask Documentation": "proposal",
            "Proposal Documentation": "proposal",
            "General": None,
            "Zoom Meeting": None,
            "Virtual Visit": None,
            "Meeting": "face_to_face",
            "Planned Giving FY27": None,
            "FY27 Activity Plan": "plan",
            "Obituary": None,
            "": None,
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(classify_note_type(raw), expected)

    def test_whitespace_and_case_are_normalized(self):
        self.assertEqual(classify_note_type("  mgo   plan for fy 27 "), "plan")
        self.assertEqual(classify_note_type("Mission Advancement In Person"), None)

    def test_goal_activity_is_case_and_space_insensitive(self):
        self.assertEqual(classify_note_type("  fy27   mgo  GOAL   activity "), "plan")

    def test_plan_without_year_is_not_plan(self):
        self.assertNotEqual(classify_note_type("Estate Plan Review"), "plan")

    def test_clean_note_text(self):
        self.assertEqual(clean_note_text("<p>Ask &amp; visit</p>\n<br/> in  spring"), "Ask & visit in spring")


class AskStatusTests(unittest.TestCase):
    def test_open_vs_excluded(self):
        self.assertTrue(is_open_ask({"status": "Pending Installment  / Annual Gift (MGO)"}))
        self.assertTrue(is_open_ask({"status": "Solicitation / Ask (MGO)"}))
        self.assertFalse(is_open_ask({"status": "Declined (MGO)"}))
        self.assertFalse(is_open_ask({"status": "gift received  (adv svcs)"}))
        self.assertFalse(is_open_ask({"status": "Prospect Research Review (Adv Svcs)"}))
        self.assertFalse(is_open_ask({"status": ""}))

    def test_funded_requires_status_and_fy_date(self):
        received = "Gift Received (Adv Svcs)"
        self.assertTrue(is_funded_ask({"status": received, "askDate": "2026-08-01"}, FY_START, FY_END))
        self.assertTrue(
            is_funded_ask(
                {"status": received, "askDate": "2026-01-01", "expectedFulfillmentDate": "2026-09-01"},
                FY_START,
                FY_END,
            )
        )
        self.assertFalse(is_funded_ask({"status": received, "askDate": "2026-01-01"}, FY_START, FY_END))
        self.assertTrue(is_funded_ask({"status": received, "modifiedDateTimeUtc": "2026-09-01T10:00:00"}, FY_START, FY_END))
        self.assertFalse(is_funded_ask({"status": "Pending (MGO)", "askDate": "2026-08-01"}, FY_START, FY_END))

    def test_open_ask_requires_expected_date_in_fy(self):
        pending = "Pending (MGO)"
        self.assertTrue(is_open_ask_in_fy({"status": pending, "expectedFulfillmentDate": "2026-12-01"}, FY_START, FY_END))
        # Formatted fallback.
        self.assertTrue(is_open_ask_in_fy({"status": pending, "expectedFulfillmentDateFormatted": "7/1/2026"}, FY_START, FY_END))
        # Boundaries: Jul 1 and Jun 30 in; Jun 30 of prior FY and Jul 1 of next FY out.
        self.assertTrue(is_open_ask_in_fy({"status": pending, "expectedFulfillmentDate": "2026-07-01"}, FY_START, FY_END))
        self.assertTrue(is_open_ask_in_fy({"status": pending, "expectedFulfillmentDate": "2027-06-30"}, FY_START, FY_END))
        self.assertFalse(is_open_ask_in_fy({"status": pending, "expectedFulfillmentDate": "2026-06-30"}, FY_START, FY_END))
        self.assertFalse(is_open_ask_in_fy({"status": pending, "expectedFulfillmentDate": "2027-07-01"}, FY_START, FY_END))
        # No date: not open.
        self.assertFalse(is_open_ask_in_fy({"status": pending}, FY_START, FY_END))
        # Excluded statuses stay excluded even with an in-FY date.
        self.assertFalse(is_open_ask_in_fy({"status": "Declined (MGO)", "expectedFulfillmentDate": "2026-12-01"}, FY_START, FY_END))
        self.assertFalse(is_open_ask_in_fy({"status": "", "expectedFulfillmentDate": "2026-12-01"}, FY_START, FY_END))


class AuthorMappingTests(unittest.TestCase):
    def setUp(self):
        self.index = author_index(build_mgos(GROUPS))

    def test_roster_stamps_and_fallbacks(self):
        self.assertEqual(map_user_to_mgo("Jim Thomas", self.index), "James Thomas")
        self.assertEqual(map_user_to_mgo("James Thomas", self.index), "James Thomas")
        self.assertEqual(map_user_to_mgo("Patrick OConnell", self.index), "Patrick J. O'Connell")
        self.assertEqual(map_user_to_mgo("patrick o\u2019connell", self.index), "Patrick J. O'Connell")
        self.assertIsNone(map_user_to_mgo("Alanna McCann", self.index))

    def test_mgos_exclude_ma_and_use_roster_first_name(self):
        mgos = build_mgos(GROUPS)
        self.assertEqual([m["key"] for m in mgos], ["James Thomas", "Patrick J. O'Connell"])
        self.assertEqual(mgos[0]["firstName"], "Jim")
        self.assertEqual(mgos[0]["email"], "jim.thomas@avemaria.edu")
        self.assertEqual(mgos[1]["firstName"], "Patrick")


class TagTests(unittest.TestCase):
    def test_top_prospect_tag_and_aliases(self):
        self.assertTrue(is_top_prospect({"tags": [{"tagName": "Top FY27 MGO Donor"}]}))
        self.assertTrue(is_top_prospect({"tags": [{"tagName": "Top FY27 MGO Prospect", "tagGroupName": "Prospect Pipeline"}]}))
        self.assertTrue(is_top_prospect({"tags": ["top  fy27 prospect"]}))
        self.assertTrue(is_top_prospect({"contactTags": [{"name": "FY27 Top Prospect"}]}))
        self.assertFalse(is_top_prospect({"tags": [{"tagName": "Top FY26 MGO Donor"}]}))


def _fixture():
    contacts_by_group = {
        1: [
            {"id": 101, "name": "Donor A", "lastGiftDate": "2026-02-24T00:00:00", "tags": [{"tagName": "Top FY27 MGO Donor"}]},
            {"id": 103, "name": "Donor C", "lastGiftDate": None, "tags": []},
        ],
        2: [
            {"id": 102, "name": "Donor B", "lastGiftDate": "2025-12-01", "tags": []},
            {"id": 103, "name": "Donor C", "lastGiftDate": None, "tags": []},
        ],
        3: [{"id": 999, "name": "MA Donor", "tags": []}],
    }
    asks = [
        {"id": 1, "contactId": 101, "askAmount": 25000, "status": "Solicitation / Ask (MGO)", "expectedFulfillmentDate": "2026-12-01", "assignedUser": "Jim Thomas"},
        {"id": 2, "contactId": 102, "askAmount": 1000, "status": "Pending Installment  / Annual Gift (MGO)", "expectedFulfillmentDateFormatted": "6/30/2027", "assignedUser": "Patrick OConnell"},
        {"id": 3, "contactId": 103, "askAmount": 500, "status": "Gift Received (Adv Svcs)", "askDate": "2026-08-01", "assignedUser": "Jim Thomas"},
        {"id": 4, "contactId": 103, "askAmount": 700, "status": "Declined (MGO)", "assignedUser": "Jim Thomas"},
        {"id": 5, "contactId": 555, "askAmount": 300, "status": "Pending (MGO)", "assignedUser": "Someone Else"},
    ]
    gifts = [
        # Solicitor wins.
        {"id": 10, "contactId": 102, "giftDate": "2026-08-15", "amount": 100,
         "customFields": [{"name": "GFT_Solicitor", "value": "Jim Thomas"}]},
        # Contact in two portfolios: alphabetical first group (James Thomas), counted once.
        {"id": 11, "contactId": 103, "giftDate": "2026-09-01", "amount": 50},
        {"id": 11, "contactId": 103, "giftDate": "2026-09-01", "amount": 50},
        {"id": 12, "contactId": 102, "giftDate": "2026-07-02", "amount": 20},
        # Prior FY: ignored.
        {"id": 13, "contactId": 101, "giftDate": "2026-06-30", "amount": 999},
    ]
    fy_notes = [
        {"id": 201, "contactId": 101, "noteDate": "2026-09-30", "type": "Text Message", "createdByUser": "Jim Thomas"},
        # Outreach by Jim on Patrick's donor: excluded.
        {"id": 202, "contactId": 102, "noteDate": "2026-09-29", "type": "Letter", "createdByUser": "Jim Thomas"},
        {"id": 203, "contactId": 102, "noteDate": "2026-09-28", "type": "In Person", "createdByUser": "Patrick OConnell"},
        # Proposal by a non-MGO author on a two-portfolio contact: one row per MGO.
        {"id": 204, "contactId": 103, "noteDate": "2026-08-10", "type": "Proposal / Gift Ask Documentation", "createdByUser": "Staff Writer"},
        {"id": 205, "contactId": 101, "noteDate": "2026-08-15", "type": "MGO Plan for FY27", "createdByUser": "Staff Writer",
         "note": "<p>Visit in <b>spring</b></p>"},
        {"id": 206, "contactId": 101, "noteDate": "2026-07-15", "type": "MGO Plan for FY27", "createdByUser": "Jim Thomas",
         "note": "older plan"},
        {"id": 207, "contactId": 101, "noteDate": "2026-09-01", "type": "Mission Advancement Call | Conversation", "createdByUser": "Jim Thomas"},
        {"id": 208, "contactId": 101, "noteDate": "2026-09-02", "type": "General", "createdByUser": "Jim Thomas"},
    ]
    creator_notes = [
        {"id": 301, "contactId": 103, "noteDate": "2024-05-01", "type": "General", "createdByUser": "Patrick OConnell"},
        {"id": 302, "contactId": 103, "noteDate": "2023-01-01", "type": "Letter", "createdByUser": "Jim Thomas"},
        # Plan written in spring, before the FY started: still fills planFy27.
        {"id": 303, "contactId": 102, "noteDate": "2026-05-01", "type": "MGO Plan for FY27", "createdByUser": "Patrick OConnell",
         "note": "spring plan"},
    ]
    return contacts_by_group, asks, gifts, fy_notes, creator_notes


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        contacts_by_group, asks, gifts, fy_notes, creator_notes = _fixture()
        self.snap = build_snapshot(
            today=TODAY,
            groups=GROUPS,
            contacts_by_group=contacts_by_group,
            asks=asks,
            gifts=gifts,
            fy_notes=fy_notes,
            creator_notes=creator_notes,
            generated_at="2026-10-01T18:00:00Z",
        )

    def test_contract_keys(self):
        s = self.snap
        for key in ("generated_at", "source", "fiscalYear", "asOf", "definitions", "mgos", "kpisByMgo", "notes", "donors"):
            self.assertIn(key, s)
        self.assertEqual(s["fiscalYear"], {"label": "FY 2026-27", "start": "2026-07-01", "end": "2027-06-30"})
        self.assertEqual(s["asOf"], "2026-10-01")
        self.assertEqual(s["source"], "virtuous")
        for key in ("outreachTypes", "faceToFaceTypes", "proposalTypes", "planTypes", "topProspectTag",
                    "openAskExcludedStatuses", "fundedStatuses"):
            self.assertIn(key, s["definitions"])
        self.assertEqual(s["definitions"]["outreachTypes"], ["Letter", "Text Message"])
        self.assertEqual(s["definitions"]["faceToFaceTypes"], ["In Person"])
        self.assertEqual(s["definitions"]["planTypes"], ["MGO Plan for FY27"])
        self.assertEqual(set(s["mgos"][0]), {"key", "name", "firstName", "email", "groupName"})
        kpi_keys = {"fyRaised", "openAskAmount", "openAskCount", "fundedAmount", "fundedCount", "donorCount"}
        for k in ("James Thomas", "Patrick J. O'Connell", TEAM_KEY):
            self.assertEqual(set(s["kpisByMgo"][k]), kpi_keys)
        for row in s["notes"]:
            self.assertEqual(set(row), {"mgo", "contactId", "kind", "date", "noteId"})
        donor_keys = {"contactId", "name", "contactUrl", "assignedMgo", "assignedFirstName", "topProspect",
                      "openAskAmount", "openAskCount", "formalProposal", "planFy27", "planDate",
                      "lastGiftDate", "lastMgoActivityDate"}
        for d in s["donors"]:
            self.assertEqual(set(d), donor_keys)

    def test_team_dedupes_donors_and_gifts(self):
        k = self.snap["kpisByMgo"]
        self.assertEqual(k["James Thomas"]["donorCount"], 2)
        self.assertEqual(k["Patrick J. O'Connell"]["donorCount"], 2)
        self.assertEqual(k[TEAM_KEY]["donorCount"], 3)
        self.assertEqual(k["James Thomas"]["fyRaised"], 150.0)
        self.assertEqual(k["Patrick J. O'Connell"]["fyRaised"], 20.0)
        self.assertEqual(k[TEAM_KEY]["fyRaised"], 170.0)

    def test_ask_kpis(self):
        k = self.snap["kpisByMgo"]
        self.assertEqual(k["James Thomas"]["openAskAmount"], 25000.0)
        self.assertEqual(k["James Thomas"]["openAskCount"], 1)
        self.assertEqual(k["James Thomas"]["fundedAmount"], 500.0)
        self.assertEqual(k["James Thomas"]["fundedCount"], 1)
        self.assertEqual(k["Patrick J. O'Connell"]["openAskAmount"], 1000.0)
        # Ask 5 maps to no MGO: not in team totals.
        self.assertEqual(k[TEAM_KEY]["openAskAmount"], 26000.0)
        self.assertEqual(k[TEAM_KEY]["openAskCount"], 2)
        self.assertEqual(k[TEAM_KEY]["fundedCount"], 1)

    def test_note_rows(self):
        rows = [(r["mgo"], r["contactId"], r["kind"], r["noteId"]) for r in self.snap["notes"]]
        self.assertIn(("James Thomas", 101, "outreach", 201), rows)
        self.assertNotIn(202, [r[3] for r in rows])  # outreach outside author's portfolio
        self.assertIn(("Patrick J. O'Connell", 102, "face_to_face", 203), rows)
        self.assertIn(("James Thomas", 103, "proposal", 204), rows)
        self.assertIn(("Patrick J. O'Connell", 103, "proposal", 204), rows)
        self.assertIn(("James Thomas", 101, "plan", 205), rows)
        self.assertNotIn(207, [r[3] for r in rows])
        self.assertNotIn(208, [r[3] for r in rows])

    def test_donor_rows(self):
        donors = {(d["assignedMgo"], d["contactId"]): d for d in self.snap["donors"]}
        self.assertEqual(len(donors), 4)
        a = donors[("James Thomas", 101)]
        self.assertTrue(a["topProspect"])
        self.assertEqual(a["assignedFirstName"], "Jim")
        self.assertEqual(a["openAskAmount"], 25000.0)
        self.assertEqual(a["openAskCount"], 1)
        self.assertEqual(a["planFy27"], "Visit in spring")
        self.assertEqual(a["planDate"], "2026-08-15")
        self.assertFalse(a["formalProposal"])
        self.assertEqual(a["lastGiftDate"], "2026-02-24")
        self.assertEqual(a["lastMgoActivityDate"], "2026-09-30")
        self.assertEqual(a["contactUrl"], "https://app.virtuoussoftware.com/Generosity/Contact/View/101")
        c_jim = donors[("James Thomas", 103)]
        c_pat = donors[("Patrick J. O'Connell", 103)]
        self.assertTrue(c_jim["formalProposal"])
        self.assertTrue(c_pat["formalProposal"])
        self.assertEqual(c_jim["openAskAmount"], 0.0)
        self.assertEqual(c_jim["lastMgoActivityDate"], "2023-01-01")
        self.assertEqual(c_pat["lastMgoActivityDate"], "2024-05-01")
        self.assertIsNone(c_jim["planFy27"])
        b = donors[("Patrick J. O'Connell", 102)]
        self.assertEqual(b["openAskAmount"], 1000.0)
        self.assertEqual(b["lastMgoActivityDate"], "2026-09-28")
        self.assertEqual(b["planFy27"], "spring plan")
        self.assertEqual(b["planDate"], "2026-05-01")
        # Pre-FY plan notes do not become FY note rows (KPIs stay FY-only).
        self.assertNotIn(303, [r["noteId"] for r in self.snap["notes"]])


class GoalActivityPlanTests(unittest.TestCase):
    def _snap(self, fy_notes, creator_notes=None):
        contacts_by_group, asks, gifts, _notes, _creator = _fixture()
        return build_snapshot(
            today=TODAY,
            groups=GROUPS,
            contacts_by_group=contacts_by_group,
            asks=asks,
            gifts=gifts,
            fy_notes=fy_notes,
            creator_notes=creator_notes or [],
            generated_at="2026-10-01T18:00:00Z",
        )

    @staticmethod
    def _donor(snap, mgo, cid):
        return next(d for d in snap["donors"] if d["assignedMgo"] == mgo and d["contactId"] == cid)

    def test_non_mgo_goal_activity_fills_plan(self):
        snap = self._snap([
            {"id": 401, "contactId": 101, "noteDate": "2026-09-10", "type": "FY27 MGO Goal Activity",
             "createdByUser": "Staff Writer", "note": "<p>Goal: two visits</p>"},
        ])
        d = self._donor(snap, "James Thomas", 101)
        self.assertEqual(d["planFy27"], "Goal: two visits")
        self.assertEqual(d["planDate"], "2026-09-10")
        self.assertEqual(snap["definitions"]["planTypes"], ["FY27 MGO Goal Activity"])

    def test_latest_of_plan_and_goal_activity_wins(self):
        snap = self._snap([
            {"id": 402, "contactId": 101, "noteDate": "2026-08-01", "type": "FY27 MGO Plan",
             "createdByUser": "Jim Thomas", "note": "older plan"},
            {"id": 403, "contactId": 101, "noteDate": "2026-09-15", "type": "FY27 MGO Goal Activity",
             "createdByUser": "Staff Writer", "note": "newer goal"},
        ])
        self.assertEqual(self._donor(snap, "James Thomas", 101)["planFy27"], "newer goal")
        snap = self._snap([
            {"id": 404, "contactId": 101, "noteDate": "2026-09-15", "type": "FY27 MGO Goal Activity",
             "createdByUser": "Staff Writer", "note": "goal"},
            {"id": 405, "contactId": 101, "noteDate": "2026-09-20", "type": "FY27 MGO Plan",
             "createdByUser": "Jim Thomas", "note": "newer plan"},
        ])
        self.assertEqual(self._donor(snap, "James Thomas", 101)["planFy27"], "newer plan")

    def test_goal_activity_does_not_inflate_activity_counts(self):
        snap = self._snap([
            {"id": 406, "contactId": 101, "noteDate": "2026-09-10", "type": "FY27 MGO Goal Activity",
             "createdByUser": "Jim Thomas", "note": "goal"},
        ])
        kinds = [r["kind"] for r in snap["notes"] if r["noteId"] == 406]
        self.assertEqual(kinds, ["plan"])

    def test_creator_notes_path_accepts_roster_author_goal_activity(self):
        snap = self._snap([], [
            {"id": 407, "contactId": 102, "noteDate": "2026-05-01", "type": "FY27 MGO Goal Activity",
             "createdByUser": "Patrick OConnell", "note": "spring goal"},
        ])
        self.assertEqual(self._donor(snap, "Patrick J. O'Connell", 102)["planFy27"], "spring goal")
        self.assertIn("FY27 MGO Goal Activity", snap["definitions"]["planTypes"])


class OpenAskGateSnapshotTests(unittest.TestCase):
    def test_out_of_fy_and_undated_open_asks_excluded_from_kpis_and_donors(self):
        contacts_by_group, _asks, _gifts, _notes, _creator = _fixture()
        pending = "Pending (MGO)"
        asks = [
            {"id": 1, "contactId": 101, "askAmount": 100, "status": pending, "expectedFulfillmentDate": "2026-07-01", "assignedUser": "Jim Thomas"},
            {"id": 2, "contactId": 101, "askAmount": 200, "status": pending, "expectedFulfillmentDate": "2027-06-30", "assignedUser": "Jim Thomas"},
            {"id": 3, "contactId": 101, "askAmount": 400, "status": pending, "expectedFulfillmentDate": "2026-06-30", "assignedUser": "Jim Thomas"},
            {"id": 4, "contactId": 101, "askAmount": 800, "status": pending, "expectedFulfillmentDate": "2027-07-01", "assignedUser": "Jim Thomas"},
            {"id": 5, "contactId": 101, "askAmount": 1600, "status": pending, "assignedUser": "Jim Thomas"},
            {"id": 6, "contactId": 101, "askAmount": 3200, "status": "Declined (MGO)", "expectedFulfillmentDate": "2026-12-01", "assignedUser": "Jim Thomas"},
            # Funded logic is unchanged: no expected date needed.
            {"id": 7, "contactId": 101, "askAmount": 50, "status": "Gift Received (Adv Svcs)", "askDate": "2026-08-01", "assignedUser": "Jim Thomas"},
        ]
        snap = build_snapshot(
            today=TODAY,
            groups=GROUPS,
            contacts_by_group=contacts_by_group,
            asks=asks,
            gifts=[],
            fy_notes=[],
            creator_notes=[],
            generated_at="2026-10-01T18:00:00Z",
        )
        jim = snap["kpisByMgo"]["James Thomas"]
        self.assertEqual(jim["openAskAmount"], 300.0)
        self.assertEqual(jim["openAskCount"], 2)
        self.assertEqual(jim["fundedAmount"], 50.0)
        self.assertEqual(snap["kpisByMgo"][TEAM_KEY]["openAskAmount"], 300.0)
        donor = next(d for d in snap["donors"] if d["assignedMgo"] == "James Thomas" and d["contactId"] == 101)
        self.assertEqual(donor["openAskAmount"], 300.0)
        self.assertEqual(donor["openAskCount"], 2)


class DiscoveryTests(unittest.TestCase):
    def test_discovery_has_counts_only(self):
        contacts_by_group, asks, _gifts, fy_notes, _creator = _fixture()
        out = build_discovery(today=TODAY, groups=GROUPS, contacts_by_group=contacts_by_group, asks=asks, fy_notes=fy_notes)
        self.assertEqual(out["noteTypesFy"]["MGO Plan for FY27"], 2)
        self.assertEqual(out["noteTypesByMgoAuthor"]["James Thomas"]["Letter"], 1)
        self.assertEqual(out["tagsMatching"], ["Top FY27 MGO Donor"])
        self.assertEqual(out["giftAskStatuses"]["Pending Installment / Annual Gift (MGO)"], 1)
        self.assertEqual(out["mgos"], ["James Thomas", "Patrick J. O'Connell"])
        self.assertNotIn("donors", out)
        self.assertNotIn("Donor A", repr(out))


if __name__ == "__main__":
    unittest.main()
