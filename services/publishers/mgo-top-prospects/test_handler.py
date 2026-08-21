"""Unit tests for MGO top-prospects snapshot assembly (no network)."""
from __future__ import annotations

import datetime as dt
import unittest

from handler import (
    build_snapshot,
    fiscal_year_window,
    is_mgo_portfolio,
    pick_portfolio,
    portfolio_label,
)


class FiscalYearTests(unittest.TestCase):
    def test_july_starts_next_named_year(self):
        fy, start, end = fiscal_year_window(dt.date(2026, 8, 21))
        self.assertEqual(fy, 2027)
        self.assertEqual(start, dt.date(2026, 7, 1))
        self.assertEqual(end, dt.date(2027, 6, 30))

    def test_june_is_still_current_fy(self):
        fy, start, end = fiscal_year_window(dt.date(2027, 6, 30))
        self.assertEqual(fy, 2027)
        self.assertEqual(start, dt.date(2026, 7, 1))
        self.assertEqual(end, dt.date(2027, 6, 30))

    def test_july_1_rolls_forward(self):
        fy, start, _end = fiscal_year_window(dt.date(2027, 7, 1))
        self.assertEqual(fy, 2028)
        self.assertEqual(start, dt.date(2027, 7, 1))


class PortfolioNameTests(unittest.TestCase):
    def test_mgo_portfolio_not_ma(self):
        self.assertTrue(is_mgo_portfolio("Portfolio - James Thomas"))
        self.assertTrue(is_mgo_portfolio("Portfolio – Patrick J. O'Connell"))
        self.assertFalse(is_mgo_portfolio("MA Portfolio - Alanna"))
        self.assertFalse(is_mgo_portfolio("Cabinet Assigned: Dan Donaldson"))

    def test_label_strips_prefix(self):
        self.assertEqual(portfolio_label("Portfolio - Marita N. Emond"), "Marita N. Emond")

    def test_pick_matches_assigned_user(self):
        self.assertEqual(
            pick_portfolio("Jim Thomas", ["Marita N. Emond", "James Thomas"]),
            "James Thomas",
        )
        self.assertEqual(
            pick_portfolio("Patrick OConnell", ["Patrick J. O'Connell", "James Thomas"]),
            "Patrick J. O'Connell",
        )
        self.assertEqual(pick_portfolio("", ["Beatrice Sanford"]), "Beatrice Sanford")
        self.assertEqual(pick_portfolio("x", []), "Unassigned")


class SnapshotTests(unittest.TestCase):
    def test_groups_open_fy_asks_by_portfolio_and_names_donors(self):
        today = dt.date(2026, 8, 21)
        groups = [
            {"id": 1, "name": "Portfolio - James Thomas"},
            {"id": 5, "name": "Portfolio - Marita N. Emond"},
        ]
        members = [
            {
                "organizationGroupId": 1,
                "organizationGroupName": "Portfolio - James Thomas",
                "contactId": 10,
                "contactName": "Mike and Lisa Schwartz",
            },
            {
                "organizationGroupId": 5,
                "organizationGroupName": "Portfolio - Marita N. Emond",
                "contactId": 20,
                "contactName": "George and Kathy Schwartz",
            },
        ]
        asks = [
            {
                "id": 1,
                "contactId": 10,
                "askAmount": 3_000_000,
                "status": "Solicitation / Ask (MGO)",
                "askDate": "2026-07-15",
                "expectedFulfillmentDate": "2026-12-01",
                "assignedUser": "Jim Thomas",
                "project": "Chapel",
            },
            {
                "id": 2,
                "contactId": 20,
                "askAmount": 300_000,
                "status": "Cultivation / Gift Ask Strategy (MGO)",
                "askDate": "2026-08-01",
                "expectedFulfillmentDate": "2027-03-01",
                "assignedUser": "Marita Emond",
                "project": None,
            },
            {
                "id": 3,
                "contactId": 10,
                "askAmount": 1_000_000,
                "status": "Declined (MGO)",
                "askDate": "2026-07-01",
                "expectedFulfillmentDate": "2026-11-01",
                "assignedUser": "Jim Thomas",
            },
            {
                "id": 4,
                "contactId": 99,
                "askAmount": 50_000,
                "status": "Pending (MGO)",
                "askDate": "2026-07-20",
                "expectedFulfillmentDate": "2026-10-01",
                "assignedUser": "Andrew Antonio",
            },
            {
                "id": 5,
                "contactId": 20,
                "askAmount": 25_000,
                "status": "Pending (MGO)",
                "askDate": "2025-08-01",
                "expectedFulfillmentDate": "2026-01-15",
                "assignedUser": "Marita Emond",
            },
        ]
        extra = {99: "Unassigned Prospect"}
        snap = build_snapshot(asks, groups, members, extra, today)
        self.assertEqual(snap["fiscalYear"], 2027)
        self.assertEqual(snap["fiscalYearLabel"], "FY2027")
        names = [p["name"] for p in snap["portfolios"]]
        self.assertEqual(names, ["James Thomas", "Marita N. Emond", "Unassigned"])

        james = snap["portfolios"][0]
        self.assertEqual(james["donorCount"], 1)
        self.assertEqual(james["askAmount"], 3_000_000)
        self.assertEqual(james["donors"][0]["donorName"], "Mike and Lisa Schwartz")
        self.assertEqual(james["donors"][0]["askCount"], 1)

        marita = snap["portfolios"][1]
        self.assertEqual(marita["askAmount"], 300_000)
        self.assertEqual(marita["donors"][0]["donorName"], "George and Kathy Schwartz")

        unassigned = snap["portfolios"][2]
        self.assertEqual(unassigned["donors"][0]["donorName"], "Unassigned Prospect")
        self.assertEqual(unassigned["askAmount"], 50_000)

        self.assertEqual(snap["summary"]["askAmount"], 3_350_000)
        self.assertEqual(snap["summary"]["donorCount"], 3)
        self.assertEqual(snap["summary"]["portfoliosWithAsks"], 2)
        self.assertEqual(snap["skipped"]["status"], 1)
        self.assertEqual(snap["skipped"]["outsideFy"], 1)

    def test_empty_portfolio_still_listed(self):
        today = dt.date(2026, 8, 21)
        groups = [{"id": 6, "name": "Portfolio - Beatrice Sanford"}]
        snap = build_snapshot([], groups, [], {}, today)
        self.assertEqual(len(snap["portfolios"]), 1)
        self.assertEqual(snap["portfolios"][0]["name"], "Beatrice Sanford")
        self.assertEqual(snap["portfolios"][0]["askAmount"], 0)
        self.assertEqual(snap["summary"]["portfoliosWithAsks"], 0)


if __name__ == "__main__":
    unittest.main()
