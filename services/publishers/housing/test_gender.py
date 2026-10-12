"""Gender fill for Capacity Quest. No network, no student files."""

import unittest

from housing_data import _enrich_gender, _gender_from_demographics, _resident_gender


class GenderFromDemographicsTests(unittest.TestCase):
    def test_latest_term_wins_and_junk_years_are_skipped(self):
        rows = [
            {"PEOPLE_CODE_ID": "P1", "ACADEMIC_YEAR": "2024", "ACADEMIC_TERM": "FALL", "GENDER": "F"},
            {"PEOPLE_CODE_ID": "P1", "ACADEMIC_YEAR": "2026", "ACADEMIC_TERM": "SPRING", "GENDER": "F"},
            {"PEOPLE_CODE_ID": "P1", "ACADEMIC_YEAR": "2026", "ACADEMIC_TERM": "FALL", "GENDER": "M"},
            {"PEOPLE_CODE_ID": "P1", "ACADEMIC_YEAR": "5565", "ACADEMIC_TERM": "TRANS", "GENDER": "F"},
            {"PEOPLE_CODE_ID": "p2", "ACADEMIC_YEAR": "2022", "ACADEMIC_TERM": "SPRING", "GENDER": "U"},
            {"PEOPLE_CODE_ID": "p2", "ACADEMIC_YEAR": "2026", "ACADEMIC_TERM": "FALL", "GENDER": "Female"},
            {"PEOPLE_CODE_ID": "P3", "ACADEMIC_YEAR": "nope", "ACADEMIC_TERM": "FALL", "GENDER": "M"},
            {"PEOPLE_CODE_ID": "", "ACADEMIC_YEAR": "2026", "ACADEMIC_TERM": "FALL", "GENDER": "F"},
        ]
        self.assertEqual(_gender_from_demographics(rows), {"P1": "M", "P2": "F"})

    def test_slate_and_admissions_win_over_a_blank_powercampus_gap(self):
        admissions = {"P1": "F", "P2": "U"}
        pc = {"P2": "M", "P3": "F"}
        self.assertEqual(_resident_gender("Female", "P1", admissions, pc), "F")
        self.assertEqual(_resident_gender("", "P1", admissions, pc), "F")
        self.assertEqual(_resident_gender("", "P2", admissions, pc), "M")
        self.assertEqual(_resident_gender("Unknown", "P3", admissions, pc), "F")
        self.assertEqual(_resident_gender("", "P9", admissions, pc), "")

    def test_occupancy_rows_keep_admissions_and_fill_returners(self):
        records = [
            {"student_id": "p1"},
            {"student_id": "P2"},
            {"student_id": "P3"},
        ]
        _enrich_gender(records, {"P1": "F", "P2": "X"}, {"P2": "M"})
        self.assertEqual([r["gender"] for r in records], ["F", "M", ""])


if __name__ == "__main__":
    unittest.main()
