"""Unit tests for Advancement Overview FY windows (no network)."""
from __future__ import annotations

import datetime as dt
import unittest

from handler import (
    ASK_PATH,
    DESIGNATION_PATH,
    FULL_GIFT_PATH,
    GIFT_PATH,
    PLANNED_PATH,
    PLEDGE_PATH_V2,
    build_snapshot,
    fiscal_year_label,
    fiscal_year_window,
    gauge_label,
    overview_windows,
    shift_years,
    virt_date,
)


class FiscalYearTests(unittest.TestCase):
    def test_august_is_new_fy(self):
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

    def test_labels(self):
        self.assertEqual(fiscal_year_label(2027), "FY 2026-27")
        self.assertEqual(fiscal_year_label(2026), "FY 2025-26")
        self.assertEqual(gauge_label(2027), "of 26/27 FY")
        self.assertEqual(gauge_label(2026), "of 25/26 FY")

    def test_closed_prior_year_as_of_is_june_30(self):
        windows = overview_windows(dt.date(2026, 8, 21))
        self.assertEqual(windows[0][0], 2027)
        self.assertEqual(windows[0][3], dt.date(2026, 8, 21))
        self.assertEqual(windows[1][0], 2026)
        self.assertEqual(windows[1][1], dt.date(2025, 7, 1))
        self.assertEqual(windows[1][2], dt.date(2026, 6, 30))
        self.assertEqual(windows[1][3], dt.date(2026, 6, 30))

    def test_shift_years_handles_feb_29(self):
        self.assertEqual(shift_years(dt.date(2024, 2, 29), -1), dt.date(2023, 2, 28))


def _gift(gid: int, amount: float, day: str, solicitor: str | None = None) -> dict:
    row: dict = {"id": gid, "amount": amount, "giftDate": day}
    if solicitor:
        row["customFields"] = [{"name": "GFT_Solicitor", "value": solicitor}]
    return row


class FakeClient:
    def __init__(self, **buckets: list[dict]):
        self.buckets = buckets
        self.calls: list[tuple[str, dict]] = []

    def paged_query(self, path: str, body: dict, page_size: int = 1000) -> list[dict]:
        del page_size
        self.calls.append((path, body))
        conds = []
        for group in body.get("groups") or []:
            conds.extend(group.get("conditions") or [])
        params = {c.get("parameter"): c.get("value") for c in conds}
        if path == GIFT_PATH:
            if params.get("Segment Name") == "Realized Bequest":
                return list(self.buckets.get("realized") or [])
            return list(self.buckets.get("gifts") or [])
        if path == FULL_GIFT_PATH:
            return list(self.buckets.get("solicitor") or [])
        if path == DESIGNATION_PATH:
            return list(self.buckets.get("designations") or [])
        if path == PLEDGE_PATH_V2:
            return list(self.buckets.get("pledges") or [])
        if path == PLANNED_PATH:
            return list(self.buckets.get("planned") or [])
        if path == ASK_PATH:
            return list(self.buckets.get("asks") or [])
        raise AssertionError(f"unexpected path {path}")


class SnapshotTests(unittest.TestCase):
    def test_splits_this_year_and_last_year_and_ytd_prior(self):
        today = dt.date(2026, 8, 21)
        gifts = [
            _gift(1, 1000, "2026-08-01"),  # this FY
            _gift(2, 500, "2026-07-15"),  # this FY unrestricted
            _gift(3, 2000, "2025-08-01"),  # last FY, this-year YTD prior
            _gift(4, 3000, "2025-12-01"),  # last FY only
            _gift(5, 4000, "2024-08-01"),  # last-year YTD prior
            _gift(6, 600, "2025-06-15"),  # last-year YTD prior
            _gift(7, 50, "2026-07-02"),  # this FY, after last FY end
        ]
        designations = [
            {"giftId": 2, "projectLocation": "Unrestricted"},
            {"giftId": 3, "projectLocation": "Unrestricted"},
            {"giftId": 1, "projectLocation": "Chapel"},
        ]
        solicitor = [
            _gift(11, 100, "2026-08-01", "Mark Middendorf"),
            _gift(12, 200, "2025-08-01", "Mark Middendorf"),
            _gift(13, 50, "2025-12-01", "Mark Middendorf"),
            _gift(14, 25, "2024-08-01", "Mark Middendorf"),
        ]
        pledges = [
            {"status": "Active", "pledgeDate": "2026-08-10", "frequency": "Annually"},
            {"status": "Active", "pledgeDate": "2025-09-01", "frequency": "Annually"},
            {"status": "Cancelled", "pledgeDate": "2026-08-02", "frequency": "Annually"},
        ]
        realized = [
            _gift(21, 10, "2026-08-05"),
            _gift(22, 10, "2025-09-01"),
        ]
        planned = [
            {"plannedGiftDate": "2026-07-20"},
            {"plannedGiftDate": "2025-11-01"},
            {"plannedGiftDate": "2024-08-01"},
        ]
        asks = [
            {
                "status": "Cultivation / Gift Ask Strategy (MGO)",
                "askDate": "2026-08-01",
                "askAmount": 100_000,
            },
            {
                "status": "Pending (MGO)",
                "askDate": "2025-10-01",
                "askAmount": 50_000,
            },
            {
                "status": "Declined (MGO)",
                "askDate": "2026-08-02",
                "askAmount": 9_000,
            },
        ]
        client = FakeClient(
            gifts=gifts,
            designations=designations,
            solicitor=solicitor,
            pledges=pledges,
            realized=realized,
            planned=planned,
            asks=asks,
        )
        snap = build_snapshot(client, today)

        self.assertEqual(snap["currentFiscalYear"], 2027)
        self.assertEqual(snap["fiscalYearLabel"], "FY 2026-27")
        self.assertEqual(len(snap["fiscalYears"]), 2)

        gift_calls = [body for path, body in client.calls if path == GIFT_PATH]
        self.assertTrue(gift_calls)
        first_date = gift_calls[0]["groups"][0]["conditions"][0]["value"]
        self.assertEqual(first_date, virt_date(dt.date(2024, 7, 1)))

        this_year = snap["fiscalYears"][0]
        last_year = snap["fiscalYears"][1]
        self.assertEqual(this_year["fiscalYear"], 2027)
        self.assertEqual(this_year["asOf"], "2026-08-21")
        self.assertEqual(this_year["kpis"]["totalFundraising"]["amount"], 1550.0)
        self.assertEqual(this_year["kpis"]["unrestricted"]["amount"], 500.0)
        self.assertEqual(this_year["ytd"]["overall"]["prior"], 2000.0)
        self.assertEqual(this_year["ytd"]["currentYear"], 2026)
        self.assertEqual(this_year["ytd"]["priorYear"], 2025)
        self.assertEqual(this_year["kpis"]["multiYearPledges"]["count"], 1)
        self.assertEqual(this_year["kpis"]["estateGifts"]["count"], 2)
        self.assertEqual(this_year["pipeline"]["totalCount"], 1)
        mark = next(o for o in this_year["officers"] if o["solicitor"] == "Mark Middendorf")
        self.assertEqual(mark["received"], 100.0)
        self.assertEqual(this_year["ytd"]["mgoTeam"]["current"], 100.0)
        self.assertEqual(this_year["ytd"]["mgoTeam"]["prior"], 200.0)

        self.assertEqual(last_year["fiscalYear"], 2026)
        self.assertEqual(last_year["fiscalYearLabel"], "FY 2025-26")
        self.assertEqual(last_year["asOf"], "2026-06-30")
        self.assertEqual(last_year["kpis"]["totalFundraising"]["amount"], 5000.0)
        self.assertEqual(last_year["kpis"]["unrestricted"]["amount"], 2000.0)
        self.assertEqual(last_year["ytd"]["overall"]["prior"], 4600.0)
        self.assertEqual(last_year["ytd"]["currentYear"], 2025)
        self.assertEqual(last_year["ytd"]["priorYear"], 2024)
        self.assertEqual(last_year["kpis"]["multiYearPledges"]["count"], 1)
        self.assertEqual(last_year["kpis"]["estateGifts"]["count"], 2)
        self.assertEqual(last_year["pipeline"]["totalCount"], 1)
        mark_last = next(o for o in last_year["officers"] if o["solicitor"] == "Mark Middendorf")
        self.assertEqual(mark_last["received"], 250.0)
        self.assertEqual(last_year["ytd"]["mgoTeam"]["prior"], 25.0)

        self.assertEqual(snap["kpis"]["totalFundraising"]["amount"], this_year["kpis"]["totalFundraising"]["amount"])


if __name__ == "__main__":
    unittest.main()
