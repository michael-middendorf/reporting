import unittest

from handler import project_member


def contact(**overrides):
    row = {
        "id": 42,
        "name": "Doe, Jane",
        "contactType": "Household",
        "contactIndividuals": [],
        "address": {},
        "customFields": [],
    }
    row.update(overrides)
    return row


class ProjectMemberTests(unittest.TestCase):
    def test_primary_secondary_skips_deceased(self):
        row = project_member(
            contact(
                contactIndividuals=[
                    {
                        "firstName": "Late",
                        "lastName": "Doe",
                        "prefix": "Mr.",
                        "isPrimary": True,
                        "isDeceased": True,
                    },
                    {
                        "firstName": "Jane",
                        "lastName": "Doe",
                        "prefix": "Ms.",
                        "suffix": "PhD",
                        "isPrimary": True,
                    },
                    {
                        "firstName": "Sam",
                        "lastName": "Doe",
                        "prefix": "Mr.",
                        "isSecondary": True,
                    },
                    {"firstName": "Pat", "lastName": "Doe"},
                ]
            )
        )
        self.assertEqual(row["firstName"], "Jane")
        self.assertEqual(row["lastName"], "Doe")
        self.assertEqual(row["prefix"], "Ms.")
        self.assertEqual(row["suffix"], "PhD")
        self.assertEqual(row["secondaryFirstName"], "Sam")
        self.assertEqual(row["secondaryLastName"], "Doe")
        self.assertEqual(row["secondaryPrefix"], "Mr.")
        self.assertIsNone(row["secondarySuffix"])

    def test_first_living_when_nobody_is_primary(self):
        row = project_member(
            contact(
                contactIndividuals=[
                    {"firstName": "Gone", "lastName": "Doe", "isDeceased": True, "isPrimary": True},
                    {"firstName": "Jane", "lastName": "Doe"},
                    {"firstName": "Sam", "lastName": "Doe", "isSecondary": True},
                ]
            )
        )
        self.assertEqual(row["firstName"], "Jane")
        self.assertEqual(row["secondaryFirstName"], "Sam")

    def test_does_not_guess_a_secondary(self):
        row = project_member(
            contact(
                contactIndividuals=[
                    {"firstName": "Jane", "lastName": "Doe", "isPrimary": True},
                    {"firstName": "Sam", "lastName": "Doe"},
                ]
            )
        )
        self.assertEqual(row["firstName"], "Jane")
        self.assertIsNone(row["secondaryFirstName"])
        self.assertIsNone(row["secondaryLastName"])
        self.assertIsNone(row["secondaryPrefix"])
        self.assertIsNone(row["secondarySuffix"])

    def test_address2_sits_between_street_and_city(self):
        row = project_member(
            contact(
                address={
                    "address1": "1 Main",
                    "address2": "Apt 2",
                    "city": "Ave Maria",
                    "state": "FL",
                    "postal": "34142",
                    "country": "US",
                }
            )
        )
        self.assertEqual(row["address"], "1 Main, Apt 2, Ave Maria, FL 34142")
        self.assertEqual(row["location"], "Ave Maria, FL")
        self.assertEqual(row["address1"], "1 Main")
        self.assertEqual(row["address2"], "Apt 2")
        self.assertEqual(row["country"], "US")

    def test_formal_name_custom_field(self):
        row = project_member(
            contact(
                formalContactName="  ",
                customFields=[
                    {"name": "Addressee", "value": "The Doe Family"},
                    {"displayName": "Formal Contact Name", "value": "Ms. Jane Doe"},
                    {"name": "Formal Name", "value": "Dr. Jane Doe"},
                ],
            )
        )
        self.assertEqual(row["formalContactName"], "Dr. Jane Doe")

        direct = project_member(
            contact(
                formalContactName="Jane Doe",
                customFields=[{"name": "Formal Name", "value": "Dr. Jane Doe"}],
            )
        )
        self.assertEqual(direct["formalContactName"], "Jane Doe")


if __name__ == "__main__":
    unittest.main()
