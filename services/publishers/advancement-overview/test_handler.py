"""Unit tests for the Qlik Advancement Overview snapshot (no network)."""
from __future__ import annotations

import datetime as dt
import math
import unittest

from handler import (
    OBJECTS,
    build_snapshot,
    fiscal_year_label,
    fiscal_year_window,
    kpi_number,
    kpi_pct,
    officer_rows,
    pipeline_rows,
    snapshot_from_layouts,
)


def kpi(num: float | None, text: str) -> dict:
    q_num: float | None = num
    if num is None:
        q_num = math.nan
    return {
        "qInfo": {"qType": "kpi"},
        "qHyperCube": {
            "qDataPages": [{"qMatrix": [[{"qText": text, "qNum": q_num}]]}],
            "qMeasureInfo": [{"qFallbackTitle": text}],
            "qSize": {"qcx": 1, "qcy": 1},
        },
    }


def table(rows: list[list[dict]]) -> dict:
    return {
        "qInfo": {"qType": "sn-table"},
        "qHyperCube": {
            "qDataPages": [{"qMatrix": rows}],
            "qSize": {"qcx": len(rows[0]) if rows else 0, "qcy": len(rows)},
        },
    }


def live_layouts() -> dict[str, dict]:
    """Layouts matching the FY27 Results sheet on 2026-08-31."""
    return {
        "endowed": kpi(27780.26, "$ 27,780"),
        "temp_restricted": kpi(1046092.41, "$ 1,046,092"),
        "unrestricted": kpi(501971.5999999999, "$ 501,972"),
        "total_received": kpi(1585526.9, "$ 1,585,527"),
        "released_fy26": kpi(None, "--"),
        "released_other": kpi(None, "--"),
        "released_total": kpi(0, "$ 0"),
        "pledges": kpi(3, "3"),
        "estate_realized": kpi(3, "3"),
        "estate_planned": kpi(0, "0"),
        "ytd_overall_cur": kpi(1585526.9, "$ 1,585,527"),
        "ytd_mgo_cur": kpi(1433214.03, "$ 1,433,214"),
        "ytd_donors_cur": kpi(809, "809"),
        "ytd_overall_prior": kpi(552113.7899999999, "$ 552,114"),
        "ytd_mgo_prior": kpi(483653.33, "$ 483,653"),
        "ytd_donors_prior": kpi(1015, "1,015"),
        "ytd_overall_diff": kpi(1033413.11, "$ 1,033,413"),
        "ytd_mgo_diff": kpi(949560.7, "$ 949,561"),
        "ytd_donors_diff": kpi(-206, "-206"),
        "ytd_overall_pct": kpi(1.871739356483018, "187%"),
        "ytd_mgo_pct": kpi(1.9633085127316294, "196%"),
        "ytd_donors_pct": kpi(-0.20295566502463055, "-20.3%"),
        "officers": table([
            [{"qText": "Middendorf"}, {"qText": "$ 815,589", "qNum": 815589.01}],
            [{"qText": "Thomas"}, {"qText": "$ 193,252", "qNum": 193251.7}],
            [{"qText": "Sanford"}, {"qText": "$ 188,088", "qNum": 188088.16999999998}],
            [{"qText": "Dolnick"}, {"qText": "$ 72,366", "qNum": 72365.99999999996}],
            [{"qText": "Buzzanca"}, {"qText": "$ 62,666", "qNum": 62666.16}],
            [{"qText": "O'Connell"}, {"qText": "$ 43,489", "qNum": 43489.29}],
            [{"qText": "Emond"}, {"qText": "$ 41,488", "qNum": 41488.44}],
            [{"qText": "Luzarraga"}, {"qText": "$ 16,275", "qNum": 16275.260000000011}],
        ]),
        "pipeline": table([
            [
                {"qText": "Cultivation / Gift Ask Strategy (MGO)"},
                {"qText": "$ 5,589,000", "qNum": 5589000},
                {"qText": "41", "qNum": 41},
            ],
            [
                {"qText": "Preparing Proposal / Agreement (MGO)"},
                {"qText": "$ 205,000", "qNum": 205000},
                {"qText": "8", "qNum": 8},
            ],
            [
                {"qText": "Solicitation / Ask (MGO)"},
                {"qText": "$ 3,328,500", "qNum": 3328500},
                {"qText": "13", "qNum": 13},
            ],
            [
                {"qText": "Pending (MGO)"},
                {"qText": "$ 2,050,000", "qNum": 2050000},
                {"qText": "13", "qNum": 13},
            ],
            [
                {"qText": "Accepted (MGO)"},
                {"qText": "$ 81,500", "qNum": 81500},
                {"qText": "5", "qNum": 5},
            ],
            [
                {"qText": "Pending Installment  / Annual Gift (MGO)"},
                {"qText": "$ 143,500", "qNum": 143500},
                {"qText": "8", "qNum": 8},
            ],
        ]),
    }


class FiscalYearTests(unittest.TestCase):
    def test_august_is_new_fy(self):
        fy, start, end = fiscal_year_window(dt.date(2026, 8, 21))
        self.assertEqual(fy, 2027)
        self.assertEqual(start, dt.date(2026, 7, 1))
        self.assertEqual(end, dt.date(2027, 6, 30))

    def test_labels(self):
        self.assertEqual(fiscal_year_label(2027), "FY 2026-27")


class KpiParseTests(unittest.TestCase):
    def test_blank_kpi_is_none(self):
        self.assertIsNone(kpi_number(kpi(None, "--")))

    def test_percent_uses_qlik_text(self):
        self.assertEqual(kpi_pct(kpi(1.871739356483018, "187%")), 187.0)
        self.assertEqual(kpi_pct(kpi(-0.20295566502463055, "-20.3%")), -20.3)


class SnapshotTests(unittest.TestCase):
    def test_object_map_covers_the_results_sheet(self):
        self.assertEqual(
            set(OBJECTS),
            set(live_layouts()),
        )

    def test_matches_qlik_fy27_results_sheet(self):
        snap = snapshot_from_layouts(
            live_layouts(),
            today=dt.date(2026, 8, 31),
            generated_at="2026-08-31T15:14:38Z",
        )
        self.assertEqual(snap["source"], "qlik")
        self.assertEqual(snap["fiscalYearLabel"], "FY 2026-27")
        self.assertEqual(snap["currentFiscalYear"], 2027)
        self.assertEqual(round(snap["received"]["total"]), 1_585_527)
        self.assertEqual(round(snap["received"]["unrestricted"]), 501_972)
        self.assertEqual(round(snap["received"]["endowed"]), 27_780)
        self.assertEqual(round(snap["received"]["temporaryRestricted"]), 1_046_092)
        self.assertIsNone(snap["released"]["fy26"])
        self.assertIsNone(snap["released"]["other"])
        self.assertEqual(snap["released"]["total"], 0.0)
        self.assertEqual(snap["pledges"]["multiYear"], 3.0)
        self.assertEqual(snap["pledges"]["realizedEstate"], 3.0)
        self.assertEqual(snap["pledges"]["plannedEstate"], 0.0)
        self.assertEqual(snap["ytd"]["currentLabel"], "FY2027")
        self.assertEqual(snap["ytd"]["priorLabel"], "FY2026")
        self.assertEqual(round(snap["ytd"]["overall"]["current"]), 1_585_527)
        self.assertEqual(round(snap["ytd"]["overall"]["prior"]), 552_114)
        self.assertEqual(round(snap["ytd"]["mgoTeam"]["current"]), 1_433_214)
        self.assertEqual(snap["ytd"]["overall"]["pct"], 187.0)
        self.assertEqual(snap["ytd"]["mgoTeam"]["pct"], 196.0)
        self.assertEqual(snap["ytd"]["activeDonors"]["pct"], -20.3)
        self.assertEqual(snap["ytd"]["activeDonors"]["current"], 809.0)
        names = [row["name"] for row in snap["officers"]]
        self.assertEqual(names[0], "Totals")
        self.assertIn("Sanford", names)
        self.assertIn("Luzarraga", names)
        self.assertEqual(round(snap["officers"][0]["amount"]), 1_433_214)
        self.assertEqual(snap["pipeline"]["totalCount"], 88)
        self.assertEqual(snap["pipeline"]["totalAmount"], 11_397_500.0)
        statuses = [row["status"] for row in snap["pipeline"]["rows"]]
        self.assertTrue(any("Pending Installment" in s for s in statuses))

    def test_build_snapshot_sets_generated_at(self):
        snap = build_snapshot(live_layouts(), dt.date(2026, 8, 31))
        self.assertTrue(snap["generated_at"].endswith("Z"))

    def test_missing_object_raises(self):
        layouts = live_layouts()
        del layouts["endowed"]
        with self.assertRaisesRegex(RuntimeError, "endowed"):
            snapshot_from_layouts(
                layouts,
                today=dt.date(2026, 8, 31),
                generated_at="2026-08-31T00:00:00Z",
            )

    def test_officer_and_pipeline_helpers(self):
        officers = officer_rows(live_layouts()["officers"])
        self.assertEqual(officers[0]["isTotal"], True)
        rows, amount, count = pipeline_rows(live_layouts()["pipeline"])
        self.assertEqual(len(rows), 6)
        self.assertEqual(count, 88)
        self.assertEqual(amount, 11_397_500.0)


if __name__ == "__main__":
    unittest.main()
