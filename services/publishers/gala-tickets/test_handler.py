import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from handler import apply_known_contacts, build_snapshot, ticket_from_intent

EASTERN = ZoneInfo("America/New_York")


def intent(**overrides):
    created = int(datetime(2026, 10, 5, 15, 0, tzinfo=EASTERN).timestamp())
    row = {
        "id": "pi_new",
        "status": "succeeded",
        "amount": 43800,
        "amount_received": 43800,
        "created": created,
        "metadata": {
            "portal": "chancellors-gala",
            "first_name": "Ada",
            "last_name": "Lovelace",
            "email": "Ada@Example.com",
        },
    }
    row.update(overrides)
    return row


class TicketFromIntentTest(unittest.TestCase):
    def test_keeps_succeeded_gala_checkout(self):
        ticket = ticket_from_intent(intent())
        self.assertEqual(ticket["paymentIntentId"], "pi_new")
        self.assertEqual(ticket["day"], "2026-10-05")
        self.assertEqual(ticket["email"], "ada@example.com")
        self.assertEqual(ticket["amountCents"], 43800)
        self.assertEqual(ticket["stripeName"], "Ada Lovelace")
        self.assertFalse(ticket["inVirtuous"])

    def test_keeps_settling_ach_using_amount(self):
        ticket = ticket_from_intent(intent(status="processing", amount_received=0, amount=400500))
        self.assertEqual(ticket["amountCents"], 400500)
        self.assertEqual(ticket["status"], "processing")

    def test_drops_failed_other_portal_and_zero(self):
        self.assertIsNone(ticket_from_intent(intent(status="requires_payment_method")))
        self.assertIsNone(ticket_from_intent(intent(metadata={"portal": "booster-club", "email": "a@b.c"})))
        self.assertIsNone(ticket_from_intent(intent(amount=0, amount_received=0)))


class SnapshotTest(unittest.TestCase):
    def test_keeps_hand_matched_contact_on_a_known_payment(self):
        prior = [{
            "paymentIntentId": "pi_new",
            "contactId": 64738,
            "contactName": "Don and Mary Huffines",
            "emailMatch": "snapshot",
            "inVirtuous": False,
        }]
        snapshot = build_snapshot([intent()], prior, "2026-10-06T12:00:00-04:00")
        ticket = snapshot["tickets"][0]
        self.assertEqual(ticket["contactId"], 64738)
        self.assertEqual(ticket["contactName"], "Don and Mary Huffines")
        self.assertEqual(snapshot["segment"], "FYE27_GALA_1EV")

    def test_does_not_copy_a_false_virtuous_flag_over_a_blank(self):
        tickets = apply_known_contacts(
            [ticket_from_intent(intent())],
            [{"paymentIntentId": "pi_new", "inVirtuous": False}],
        )
        self.assertFalse(tickets[0]["inVirtuous"])
        self.assertNotIn("giftId", tickets[0])


if __name__ == "__main__":
    unittest.main()
