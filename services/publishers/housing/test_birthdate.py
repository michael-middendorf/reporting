"""Birthdate normalization for the housing resident payload. No network, no student files."""

import datetime
import unittest

from housing_data import _birthdates_from_deposits, _iso_date, _row_birthdate


class BirthdateTests(unittest.TestCase):
    def test_iso_and_us_dates(self):
        self.assertEqual(_iso_date("2006-09-03"), "2006-09-03")
        self.assertEqual(_iso_date("2006-09-03T00:00:00"), "2006-09-03")
        self.assertEqual(_iso_date("9/3/2006"), "2006-09-03")
        self.assertEqual(_iso_date(datetime.date(2006, 9, 3)), "2006-09-03")
        self.assertEqual(_iso_date(""), "")
        self.assertEqual(_iso_date("not a date"), "")

    def test_roster_wins_and_deposits_fill_gaps(self):
        self.assertEqual(_row_birthdate({"Birthdate": "1/2/2005"}), "2005-01-02")
        self.assertEqual(_row_birthdate({"Dep_Birthdate": "03/04/2004"}), "2004-03-04")
        by_pcid = _birthdates_from_deposits(
            [
                {"Dep_PCID": "p0001", "Dep_Birthdate": "5/6/2007"},
                {"Dep_PCID": "", "Dep_Birthdate": "1/1/2000"},
                {"Dep_PCID": "P0002", "Dep_Birthdate": ""},
            ]
        )
        self.assertEqual(by_pcid, {"P0001": "2007-05-06"})


if __name__ == "__main__":
    unittest.main()
