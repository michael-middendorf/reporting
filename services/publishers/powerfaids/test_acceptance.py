"""Acceptance letters transform tests. Synthetic rows only; no database, no S3.

Run from the repo root:
  PYTHONPATH=services/publishers python -m unittest discover -s services/publishers/powerfaids -t services/publishers/powerfaids
"""
from __future__ import annotations

import copy
import hashlib
import json
import unittest
from datetime import datetime, timezone
from decimal import Decimal

import acceptance
import acceptance_rules as rules

NOW = datetime(2026, 10, 12, 7, 30, tzinfo=timezone.utc)
YEAR = "2027-2028"


def base_results():
    """One student (SAY 100) with a scheduled scholarship, a loan and costs; one fund per type."""
    return {
        "students": [
            {"campus_id": "P000000001", "student_token": 11, "stu_award_year_token": 100,
             "packaging_status": None, "date_withdrew": None},
        ],
        "awards": [
            {"stu_award_token": 1, "stu_award_year_token": 100, "fund_ay_token": 7, "status": "A",
             "actual_amt": Decimal("10000.00"), "created_dt": datetime(2026, 10, 1, 9, 0), "modified_dt": datetime(2026, 10, 2, 9, 0)},
            {"stu_award_token": 2, "stu_award_year_token": 100, "fund_ay_token": 8, "status": "A",
             "actual_amt": Decimal("5500"), "created_dt": datetime(2026, 9, 1, 9, 0), "modified_dt": None},
        ],
        "funds": [
            {"fund_token": 7, "fund_short_name": "AMUSCH", "fund_long_name": "Ave Maria Scholarship", "fund_type": "G",
             "fund_source": "I", "fund_family": "Academic"},
            {"fund_token": 8, "fund_short_name": "DLSUB", "fund_long_name": "Direct Loan Subsidized", "fund_type": "L",
             "fund_source": "F", "fund_family": "Federal Loan"},
        ],
        "schedule": [
            {"stu_award_token": 1, "poe_token": 50, "scheduled_amount": Decimal("5000")},
            {"stu_award_token": 1, "poe_token": 51, "scheduled_amount": Decimal("5000")},
            {"stu_award_token": 2, "poe_token": 50, "scheduled_amount": Decimal("2750")},
            {"stu_award_token": 2, "poe_token": 51, "scheduled_amount": Decimal("2750")},
        ],
        "poe": [{"poe_token": 50, "attend_desc": "FALL"}, {"poe_token": 51, "attend_desc": "Spring 2028"}],
        "costs": [
            {"stu_award_year_token": 100, "tot_tuition_fees": Decimal("33240"), "tot_room_board": Decimal("15704"),
             "tot_books_supplies": Decimal("1320"), "tot_transportation": None, "tot_other_budget": Decimal("0")},
        ],
    }


def build(results):
    out = acceptance.build_export(results, NOW, YEAR)
    (data_key, data), (manifest_key, manifest) = out.objects
    return out, data_key, data, manifest_key, manifest


def only_package(results):
    return build(results)[2]["packages"][0]


class MoneyTests(unittest.TestCase):
    def test_dollars_to_cents(self):
        self.assertEqual(acceptance.to_cents(Decimal("33240.00")), 3324000)
        self.assertEqual(acceptance.to_cents(3500), 350000)
        self.assertEqual(acceptance.to_cents(24.0), 2400)
        self.assertEqual(acceptance.to_cents("1320"), 132000)
        self.assertEqual(acceptance.to_cents(None), 0)
        self.assertEqual(acceptance.to_cents(Decimal("0.005")), 1)
        self.assertIsInstance(acceptance.to_cents(Decimal("12")), int)

    def test_split_odd_cent_to_fall(self):
        self.assertEqual(acceptance.split_even(10001), (5001, 5000))
        self.assertEqual(acceptance.split_even(10000), (5000, 5000))
        self.assertEqual(acceptance.split_even(1), (1, 0))
        self.assertEqual(acceptance.split_even(0), (0, 0))

    def test_cost_lines_are_integer_cents(self):
        package = only_package(base_results())
        tuition = package["costs"][0]
        self.assertEqual(tuition, {"code": "TUITION_FEES", "label": "Tuition and fees", "category": "tuition_fees",
                                   "fallCents": 1662000, "springCents": 1662000})
        for line in package["costs"] + package["awards"]:
            self.assertIsInstance(line["fallCents"], int)
            self.assertIsInstance(line["springCents"], int)


class TimeTests(unittest.TestCase):
    def test_naive_eastern_to_utc(self):
        # October: EDT, UTC-4.
        self.assertEqual(acceptance.iso_utc(acceptance.to_utc(datetime(2026, 10, 2, 9, 0))), "2026-10-02T13:00:00Z")
        # January: EST, UTC-5.
        self.assertEqual(acceptance.iso_utc(acceptance.to_utc("2027-01-15 09:00:00.123000")), "2027-01-15T14:00:00Z")
        self.assertIsNone(acceptance.to_utc(None))
        self.assertIsNone(acceptance.to_utc(""))

    def test_effective_at_is_latest_award_stamp_else_run_time(self):
        package = only_package(base_results())
        self.assertEqual(package["effectiveAt"], "2026-10-02T13:00:00Z")
        results = base_results()
        results["awards"] = []
        package = only_package(results)
        self.assertEqual(package["effectiveAt"], "2026-10-12T07:30:00Z")
        self.assertRegex(package["effectiveAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")


class AwardTests(unittest.TestCase):
    def test_schedule_split_fall_spring(self):
        package = only_package(base_results())
        self.assertEqual(package["notes"], [])
        by_code = {a["code"]: a for a in package["awards"]}
        self.assertEqual((by_code["AMUSCH"]["fallCents"], by_code["AMUSCH"]["springCents"]), (500000, 500000))
        self.assertEqual((by_code["DLSUB"]["fallCents"], by_code["DLSUB"]["springCents"]), (275000, 275000))

    def test_uneven_schedule_is_kept_as_scheduled(self):
        results = base_results()
        results["schedule"][0]["scheduled_amount"] = Decimal("6000")
        results["schedule"][1]["scheduled_amount"] = Decimal("4000")
        award = [a for a in only_package(results)["awards"] if a["code"] == "AMUSCH"][0]
        self.assertEqual((award["fallCents"], award["springCents"]), (600000, 400000))

    def test_no_schedule_splits_evenly_with_note(self):
        results = base_results()
        results["schedule"] = [r for r in results["schedule"] if r["stu_award_token"] != 1]
        results["awards"][0]["actual_amt"] = Decimal("10000.01")
        package = only_package(results)
        award = [a for a in package["awards"] if a["code"] == "AMUSCH"][0]
        self.assertEqual((award["fallCents"], award["springCents"]), (500001, 500000))
        self.assertEqual(package["notes"], ["award AMUSCH split evenly, no schedule"])
        self.assertEqual(package["status"], "draft")

    def test_non_term_disbursement_goes_in_neither_bucket(self):
        results = base_results()
        results["poe"].append({"poe_token": 52, "attend_desc": "Summer"})
        results["schedule"].append({"stu_award_token": 1, "poe_token": 52, "scheduled_amount": Decimal("1000")})
        package = only_package(results)
        award = [a for a in package["awards"] if a["code"] == "AMUSCH"][0]
        self.assertEqual((award["fallCents"], award["springCents"]), (500000, 500000))
        self.assertIn("award AMUSCH has non fall/spring disbursements", package["notes"])

    def test_unknown_poe_counts_as_non_term(self):
        results = base_results()
        results["schedule"].append({"stu_award_token": 1, "poe_token": 999, "scheduled_amount": Decimal("1")})
        self.assertIn("award AMUSCH has non fall/spring disbursements", only_package(results)["notes"])

    def test_schedule_not_matching_amount_adds_note(self):
        results = base_results()
        results["schedule"][0]["scheduled_amount"] = Decimal("4000")
        package = only_package(results)
        self.assertEqual(package["notes"], ["award AMUSCH schedule does not match the award amount"])

    def test_poe_matching_is_case_insensitive_prefix(self):
        self.assertEqual(acceptance._poe_bucket("fall 2027"), "fall")
        self.assertEqual(acceptance._poe_bucket("FALL"), "fall")
        self.assertEqual(acceptance._poe_bucket("SPRING"), "spring")
        self.assertEqual(acceptance._poe_bucket("Late Fall"), "other")
        self.assertEqual(acceptance._poe_bucket(None), "other")

    def test_status_map_and_skips(self):
        results = base_results()
        extra = [
            ("O", "offered"), ("D", "declined"), ("X", None), ("C", None), (None, None),
        ]
        for i, (code, _) in enumerate(extra):
            results["awards"].append({"stu_award_token": 20 + i, "stu_award_year_token": 100, "fund_ay_token": 8,
                                      "status": code, "actual_amt": 100, "created_dt": None, "modified_dt": None})
            results["schedule"] += [
                {"stu_award_token": 20 + i, "poe_token": 50, "scheduled_amount": 5000},
                {"stu_award_token": 20 + i, "poe_token": 51, "scheduled_amount": 5000},
            ]
        out, _, data, _, manifest = build(results)
        statuses = sorted(a["status"] for a in data["packages"][0]["awards"])
        self.assertEqual(statuses, ["accepted", "accepted", "declined", "offered"])
        self.assertEqual(manifest["summary"]["awardsSkippedStatus"], 3)
        self.assertEqual(rules.AWARD_STATUS_MAP, {"O": "offered", "A": "accepted", "D": "declined"})

    def test_categories(self):
        def category(fund_type, source="I", family="Academic"):
            results = base_results()
            results["funds"][0].update(fund_type=fund_type, fund_source=source, fund_family=family)
            awards = only_package(results)["awards"]
            return [a for a in awards if a["code"] == "AMUSCH"][0]["category"] if awards and any(
                a["code"] == "AMUSCH" for a in awards) else None

        self.assertEqual(category("L"), "loan")
        self.assertEqual(category("J"), "work")
        self.assertEqual(category("G"), "scholarship")
        self.assertEqual(category("G", family="AcademicPT"), "scholarship")
        self.assertEqual(category("G", family="AdmissioPT"), "scholarship")
        self.assertEqual(category("G", source="F", family="Federal Grant"), "grant")
        self.assertEqual(category("G", source="I", family="Institutional Other"), "grant")
        self.assertEqual(category("G", source="S", family="Academic"), "grant")
        self.assertEqual(len(rules.SCHOLARSHIP_FAMILIES), 12)

    def test_unknown_fund_type_skipped_counted_and_noted(self):
        results = base_results()
        results["funds"][0]["fund_type"] = "Z"
        _, _, data, _, manifest = build(results)
        package = data["packages"][0]
        self.assertEqual([a["code"] for a in package["awards"]], ["DLSUB"])
        self.assertEqual(manifest["summary"]["awardsSkippedFundType"], 1)
        self.assertEqual(package["notes"], ["award AMUSCH has an unrecognized fund type and was left out"])
        self.assertEqual(package["status"], "draft")

    def test_missing_fund_is_noted_not_silent(self):
        results = base_results()
        results["funds"] = results["funds"][:1]
        _, _, data, _, manifest = build(results)
        self.assertEqual(manifest["summary"]["awardsSkippedNoFund"], 1)
        self.assertEqual(data["packages"][0]["notes"], ["award 8 has no fund record"])

    def test_code_label_fallbacks(self):
        results = base_results()
        results["funds"][0].update(fund_short_name=None, fund_long_name="")
        award = [a for a in only_package(results)["awards"] if a["category"] == "scholarship"][0]
        self.assertEqual((award["code"], award["label"]), ("7", "7"))

    def test_featured_is_the_largest_scholarship_only(self):
        results = base_results()
        results["funds"][1].update(fund_type="G", fund_source="I", fund_family="Athletic")  # second scholarship
        package = only_package(results)
        featured = {a["code"]: a["featured"] for a in package["awards"]}
        self.assertEqual(featured, {"AMUSCH": True, "DLSUB": False})  # 10000 beats 5500

    def test_featured_tie_breaks_on_label_and_never_a_loan(self):
        results = base_results()
        results["funds"][1].update(fund_type="G", fund_source="I", fund_family="Athletic", fund_long_name="Aardvark Award")
        results["awards"][1]["actual_amt"] = Decimal("10000")
        results["schedule"][2]["scheduled_amount"] = Decimal("5000")
        results["schedule"][3]["scheduled_amount"] = Decimal("5000")
        featured = {a["code"]: a["featured"] for a in only_package(results)["awards"]}
        self.assertEqual(featured, {"AMUSCH": False, "DLSUB": True})
        # With no scholarship at all nothing is featured.
        results = base_results()
        results["funds"][0].update(fund_type="L")
        self.assertFalse(any(a["featured"] for a in only_package(results)["awards"]))


class CostAndHousingTests(unittest.TestCase):
    def test_cost_lines_and_housing(self):
        package = only_package(base_results())
        self.assertEqual([c["code"] for c in package["costs"]], ["TUITION_FEES", "HOUSING_MEALS", "BOOKS"])
        self.assertEqual(package["costs"][1]["category"], "housing_meals")
        self.assertEqual(package["costs"][2]["category"], "other")
        self.assertEqual(package["housingPlan"], "On campus")

    def test_odd_cent_to_fall_on_costs(self):
        results = base_results()
        results["costs"][0]["tot_transportation"] = Decimal("1200.01")
        line = [c for c in only_package(results)["costs"] if c["code"] == "TRANSPORT"][0]
        self.assertEqual((line["fallCents"], line["springCents"]), (60001, 60000))
        self.assertEqual(line["category"], "other")

    def test_commuter_when_no_room_board(self):
        for value in (None, 0, Decimal("0")):
            with self.subTest(value=value):
                results = base_results()
                results["costs"][0]["tot_room_board"] = value
                package = only_package(results)
                self.assertEqual(package["housingPlan"], "Commuter")
                self.assertNotIn("HOUSING_MEALS", [c["code"] for c in package["costs"]])

    def test_zero_or_null_other_lines_omitted(self):
        codes = [c["code"] for c in only_package(base_results())["costs"]]
        self.assertNotIn("TRANSPORT", codes)
        self.assertNotIn("PERSONAL", codes)

    def test_no_cost_of_attendance_note_blocks_approval(self):
        for tuition in (None, 0):
            with self.subTest(tuition=tuition):
                results = base_results()
                results["costs"][0]["tot_tuition_fees"] = tuition
                package = only_package(results)
                self.assertIn("no cost of attendance", package["notes"])
                self.assertNotIn("TUITION_FEES", [c["code"] for c in package["costs"]])
        results = base_results()
        results["costs"] = []
        package = only_package(results)
        self.assertIn("no cost of attendance", package["notes"])
        self.assertEqual(package["costs"], [])
        self.assertEqual(package["housingPlan"], "Commuter")


class StatusTests(unittest.TestCase):
    def test_default_is_draft_because_no_packaged_statuses(self):
        self.assertEqual(rules.PACKAGED_STATUSES, ())
        results = base_results()
        results["students"][0]["packaging_status"] = "PKG"
        self.assertEqual(only_package(results)["status"], "draft")

    def test_approved_needs_packaged_status_and_no_notes(self):
        results = base_results()
        results["students"][0]["packaging_status"] = "PKG"
        original = rules.PACKAGED_STATUSES
        rules.PACKAGED_STATUSES = ("PKG",)
        try:
            self.assertEqual(only_package(results)["status"], "approved")
            results["costs"][0]["tot_tuition_fees"] = 0  # a note appears
            self.assertEqual(only_package(results)["status"], "draft")
            results = base_results()
            results["students"][0]["packaging_status"] = "OTHER"
            self.assertEqual(only_package(results)["status"], "draft")
            results["students"][0]["packaging_status"] = None
            self.assertEqual(only_package(results)["status"], "draft")
        finally:
            rules.PACKAGED_STATUSES = original

    def test_withdrawn_wins(self):
        results = base_results()
        results["students"][0]["date_withdrew"] = datetime(2027, 1, 5)
        results["students"][0]["packaging_status"] = "PKG"
        original = rules.PACKAGED_STATUSES
        rules.PACKAGED_STATUSES = ("PKG",)
        try:
            self.assertEqual(only_package(results)["status"], "withdrawn")
        finally:
            rules.PACKAGED_STATUSES = original


class PopulationTests(unittest.TestCase):
    def two_students(self, second_id):
        results = base_results()
        results["students"].append(
            {"campus_id": second_id, "student_token": 12, "stu_award_year_token": 101,
             "packaging_status": None, "date_withdrew": None}
        )
        return results

    def test_duplicate_campus_id_emits_neither(self):
        results = self.two_students("P000000001")
        _, _, data, _, manifest = build(results)
        self.assertEqual(data["packages"], [])
        self.assertEqual(manifest["summary"]["packages"], 0)
        self.assertEqual(manifest["summary"]["campusIdsDuplicate"], 1)
        self.assertEqual(manifest["summary"]["studentsExcludedDuplicate"], 2)

    def test_unique_ids_both_emitted_sorted(self):
        results = self.two_students("P000000000")
        _, _, data, _, manifest = build(results)
        self.assertEqual([p["slatePersonReferenceId"] for p in data["packages"]], ["P000000000", "P000000001"])
        self.assertEqual(manifest["summary"]["campusIdsDuplicate"], 0)

    def test_bad_or_missing_campus_ids_are_never_emitted(self):
        for bad in (None, "", "123456789", "P12345678", "P1234567890", "p123456789", "123-45-6789"):
            with self.subTest(bad=bad):
                results = self.two_students(bad)
                _, _, data, _, manifest = build(results)
                self.assertEqual([p["slatePersonReferenceId"] for p in data["packages"]], ["P000000001"])
                self.assertEqual(manifest["summary"]["studentsExcludedNoCampusId"], 1)

    def test_student_without_awards_still_gets_a_package(self):
        results = base_results()
        results["awards"] = []
        package = only_package(results)
        self.assertEqual(package["awards"], [])
        self.assertEqual(package["powerfaidsStudentId"], "11")


class ContractTests(unittest.TestCase):
    def test_shape_matches_contract_v2(self):
        out, data_key, data, manifest_key, manifest = build(base_results())
        self.assertEqual(data_key, "sources/acceptance-letters/exports/2026-10-12T073000Z.json")
        self.assertEqual(manifest_key, "sources/acceptance-letters/manifest.json")
        self.assertEqual([k for k, _ in out.objects], [data_key, manifest_key])  # manifest last
        self.assertEqual(list(data), ["schemaVersion", "generatedAt", "awardYear", "packages"])
        self.assertEqual((data["schemaVersion"], data["awardYear"], data["generatedAt"]), (2, YEAR, "2026-10-12T07:30:00Z"))
        self.assertEqual(
            manifest,
            {"schemaVersion": 2, "success": True, "generatedAt": "2026-10-12T07:30:00Z", "dataKey": data_key,
             "summary": manifest["summary"]},
        )
        self.assertEqual(manifest["summary"]["packages"], 1)
        self.assertEqual(manifest["summary"]["draft"], 1)
        self.assertEqual((out.record_count, out.prefix), (1, "sources/acceptance-letters"))
        package = data["packages"][0]
        self.assertEqual(
            sorted(package),
            sorted(["schemaVersion", "slatePersonReferenceId", "powerfaidsStudentId", "awardYear", "status",
                    "sourceVersion", "effectiveAt", "housingPlan", "costs", "awards", "notes"]),
        )
        self.assertRegex(package["slatePersonReferenceId"], r"^P\d{9}$")
        self.assertEqual(sorted(package["awards"][0]), sorted(["code", "label", "category", "status", "fallCents", "springCents", "featured"]))
        self.assertEqual(sorted(package["costs"][0]), sorted(["code", "label", "category", "fallCents", "springCents"]))
        json.dumps(data)  # serializable with no Decimal or datetime left over

    def test_source_version_is_sha256_of_canonical_package_without_volatile_fields(self):
        package = only_package(base_results())
        body = {k: v for k, v in package.items() if k not in ("sourceVersion", "effectiveAt")}
        expected = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(package["sourceVersion"], expected)
        self.assertRegex(package["sourceVersion"], r"^[0-9a-f]{64}$")

    def test_source_version_stable_across_row_order_and_run_time_but_changes_with_content(self):
        base = only_package(base_results())
        shuffled = base_results()
        shuffled["awards"].reverse()
        shuffled["schedule"].reverse()
        shuffled["funds"].reverse()
        self.assertEqual(only_package(shuffled)["sourceVersion"], base["sourceVersion"])
        later = acceptance.build_export(base_results(), datetime(2026, 11, 1, tzinfo=timezone.utc), YEAR)
        self.assertEqual(later.objects[0][1]["packages"][0]["sourceVersion"], base["sourceVersion"])
        changed = base_results()
        changed["costs"][0]["tot_tuition_fees"] = Decimal("34000")
        self.assertNotEqual(only_package(changed)["sourceVersion"], base["sourceVersion"])
        # effectiveAt alone does not change it
        moved = base_results()
        moved["awards"][0]["modified_dt"] = datetime(2026, 12, 1, 9, 0)
        moved_pkg = only_package(moved)
        self.assertNotEqual(moved_pkg["effectiveAt"], base["effectiveAt"])
        self.assertEqual(moved_pkg["sourceVersion"], base["sourceVersion"])

    def test_inputs_are_not_mutated(self):
        results = base_results()
        before = copy.deepcopy(results)
        build(results)
        self.assertEqual(results, before)


if __name__ == "__main__":
    unittest.main()
