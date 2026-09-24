"""Unit tests for the Anonymous Donor tag helpers (no network)."""
from __future__ import annotations

import unittest

from common.anonymous_donors import (
    CONTACT_QUERY_PATH,
    anonymous_contact_ids,
    gift_contact_ids,
    is_anonymous_donor,
)


class _Client:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def paged_query(self, path, body):
        self.calls.append((path, body))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class AnonymousDonorTests(unittest.TestCase):
    def test_lookup_uses_isanyof_values(self):
        client = _Client([{"id": 7}, {"id": 9}])
        self.assertEqual(anonymous_contact_ids(client), frozenset({"7", "9"}))
        path, body = client.calls[0]
        cond = body["groups"][0]["conditions"][0]
        self.assertEqual(path, CONTACT_QUERY_PATH)
        self.assertEqual((cond["parameter"], cond["operator"], cond["values"]),
                         ("Tag", "IsAnyOf", ["Anonymous Donor"]))

    def test_failure_or_empty_is_unknown(self):
        self.assertIsNone(anonymous_contact_ids(_Client(RuntimeError("400"))))
        self.assertIsNone(anonymous_contact_ids(_Client([])))

    def test_unknown_marks_everyone_anonymous(self):
        self.assertTrue(is_anonymous_donor({"1"}, None))
        self.assertTrue(is_anonymous_donor(set(), None))

    def test_tagged_contact_or_passthrough(self):
        ids = frozenset({"7"})
        self.assertTrue(is_anonymous_donor(gift_contact_ids({"contactId": 7}), ids))
        self.assertTrue(is_anonymous_donor(
            gift_contact_ids({"contactId": 1, "giftPassthroughs": [{"contactId": 7}]}), ids))
        self.assertFalse(is_anonymous_donor(gift_contact_ids({"contactId": 1}), ids))


if __name__ == "__main__":
    unittest.main()
