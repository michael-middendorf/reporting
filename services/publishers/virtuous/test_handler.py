"""Retry behavior for the Virtuous raw refresh client (no network)."""
from __future__ import annotations

import datetime as dt
import io
import json
import unittest
import urllib.request
from unittest import mock

import handler


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class PostRetryTests(unittest.TestCase):
    def setUp(self):
        self.client = handler.VirtuousClient("k", "https://example.invalid")

    @mock.patch("handler.time.sleep", lambda s: None)
    def test_read_timeout_is_retried(self):
        calls = {"n": 0}

        def fake_urlopen(req, timeout):
            calls["n"] += 1
            if calls["n"] < 3:
                raise TimeoutError("The read operation timed out")
            return _Resp(json.dumps({"list": [], "total": 0}).encode())

        with mock.patch.object(urllib.request, "urlopen", fake_urlopen):
            self.assertEqual(self.client._post("/api/x", {}, {}), {"list": [], "total": 0})
        self.assertEqual(calls["n"], 3)

    @mock.patch("handler.time.sleep", lambda s: None)
    def test_persistent_timeout_raises(self):
        def fake_urlopen(req, timeout):
            raise TimeoutError("The read operation timed out")

        with mock.patch.object(urllib.request, "urlopen", fake_urlopen):
            with self.assertRaisesRegex(RuntimeError, "timed out after retries"):
                self.client._post("/api/x", {}, {})


class RecurringGiftQueryTests(unittest.TestCase):
    def test_cancel_query_uses_cancel_date(self):
        body = handler._cancelled_recurring_gift_query(dt.date(2025, 9, 29), dt.date(2026, 9, 29))
        conds = body["groups"][0]["conditions"]
        cancel = [c for c in conds if c["parameter"] == "Cancel Date"]
        self.assertEqual(
            [(c["operator"], c["value"]) for c in cancel],
            [("OnOrAfter", "2025-09-29"), ("OnOrBefore", "2026-09-29")],
        )
        frequency = next(c for c in conds if c["parameter"] == "Frequency")
        self.assertEqual(frequency["value"], "Monthly")

    def test_cancel_only_rows_are_prior_evidence(self):
        merged = handler.merge_recurring_gifts(
            [{"id": 3824, "amount": 50}],
            [
                {"id": 3824, "amount": 50, "status": "Cancelled"},
                {"id": 1817, "amount": 25, "status": "Cancelled"},
            ],
        )
        by_id = {row["id"]: row for row in merged}
        self.assertNotIn("priorOnly", by_id[3824])
        self.assertEqual(by_id[3824]["amount"], 50)
        self.assertTrue(by_id[1817]["priorOnly"])
        self.assertEqual(by_id[1817]["amount"], 25)


class PassthroughGiftTests(unittest.TestCase):
    def test_passthrough_query_requires_a_passthrough_contact(self):
        body = handler._passthrough_gift_query(dt.date(2026, 6, 1), dt.date(2026, 10, 2))
        conds = body["groups"][0]["conditions"]
        self.assertEqual(
            [(c["parameter"], c["operator"]) for c in conds],
            [
                ("Gift Date", "OnOrAfter"),
                ("Gift Date", "OnOrBefore"),
                ("Passthrough Contact", "IsSet"),
            ],
        )

    def test_fullgift_passthrough_row_replaces_the_slim_gift(self):
        merged = handler.merge_passthrough_gifts(
            [{"id": 452490, "contactId": 131615, "contactName": "Vanguard Charitable"}],
            [{
                "id": 452490,
                "contactId": 131615,
                "contactName": "Vanguard Charitable",
                "contactPassthroughId": 4825,
                "giftPassthroughs": [{"contactId": 4825, "contactName": "Anthony and Cynthia Lesniewski"}],
            }],
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["contactPassthroughId"], 4825)

    def test_contact_ids_include_passthrough_households(self):
        ids = handler._contact_ids(
            [{
                "id": 452490,
                "contactId": 131615,
                "contactPassthroughId": 4825,
                "giftPassthroughs": [{"contactId": 4825}],
            }]
        )
        self.assertEqual(ids, [4825, 131615])


if __name__ == "__main__":
    unittest.main()
