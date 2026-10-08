"""Unit tests for the AD inbox reader: allowlist, type-rejection, staleness,
and newest-file selection. Fakes only; no S3, no network.

Run: PYTHONPATH=services/publishers python -m unittest discover
     -s services/publishers/security -t services/publishers/security
"""
from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone

from ad import collect, is_stale, newest_object, sanitize_payload

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


class SanitizePayloadTests(unittest.TestCase):
    def test_allowlisted_numeric_keys_pass_through(self):
        clean, rejected = sanitize_payload(
            {"domainAdminsCount": 25, "dnsAdminsCount": 28.0, "unrelatedField": "ignored"}
        )
        self.assertEqual(clean, {"domainAdminsCount": 25, "dnsAdminsCount": 28})
        self.assertEqual(rejected, [])
        self.assertNotIn("unrelatedField", clean)

    def test_string_value_on_an_allowlisted_key_is_rejected(self):
        clean, rejected = sanitize_payload({"domainAdminsCount": "twenty-five"})
        self.assertEqual(clean, {})
        self.assertEqual(rejected, ["domainAdminsCount"])

    def test_bool_is_rejected_not_treated_as_a_count(self):
        clean, rejected = sanitize_payload({"domainAdminsCount": True})
        self.assertEqual(clean, {})
        self.assertEqual(rejected, ["domainAdminsCount"])

    def test_a_leaked_name_under_a_numeric_key_is_rejected(self):
        # This is exactly the shape a leak would take: a string smuggled in
        # under a key that is supposed to be a count.
        clean, rejected = sanitize_payload({"passwordNotRequiredCount": "jane.doe@example.com"})
        self.assertEqual(clean, {})
        self.assertEqual(rejected, ["passwordNotRequiredCount"])

    def test_non_dict_payload_is_rejected(self):
        clean, rejected = sanitize_payload(["not", "an", "object"])
        self.assertEqual(clean, {})
        self.assertEqual(rejected, ["<root is not an object>"])

    def test_missing_keys_are_simply_absent(self):
        clean, rejected = sanitize_payload({"domainAdminsCount": 25})
        self.assertEqual(clean, {"domainAdminsCount": 25})
        self.assertEqual(rejected, [])


class StalenessTests(unittest.TestCase):
    def test_exactly_48_hours_is_not_stale(self):
        self.assertFalse(is_stale(NOW - timedelta(hours=48), NOW))

    def test_over_48_hours_is_stale(self):
        self.assertTrue(is_stale(NOW - timedelta(hours=48, minutes=1), NOW))

    def test_fresh_is_not_stale(self):
        self.assertFalse(is_stale(NOW - timedelta(hours=1), NOW))


class NewestObjectTests(unittest.TestCase):
    def test_picks_most_recently_modified(self):
        objects = [
            {"Key": "cybersecurity/inbox/ad/2026-10-05.json", "LastModified": NOW - timedelta(days=3)},
            {"Key": "cybersecurity/inbox/ad/2026-10-07.json", "LastModified": NOW - timedelta(days=1)},
            {"Key": "cybersecurity/inbox/ad/2026-10-06.json", "LastModified": NOW - timedelta(days=2)},
        ]
        self.assertEqual(newest_object(objects)["Key"], "cybersecurity/inbox/ad/2026-10-07.json")

    def test_empty_list_is_none(self):
        self.assertIsNone(newest_object([]))


class FakeBody:
    def __init__(self, payload: dict):
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")


class FakePaginator:
    def __init__(self, pages: list[dict]):
        self._pages = pages

    def paginate(self, **_kwargs):
        return iter(self._pages)


class FakeS3:
    def __init__(self, objects: list[dict], payloads: dict[str, dict]):
        self._objects = objects
        self._payloads = payloads
        self.get_object_calls: list[str] = []

    def get_paginator(self, name: str):
        assert name == "list_objects_v2"
        return FakePaginator([{"Contents": self._objects}] if self._objects else [{}])

    def get_object(self, Bucket: str, Key: str):  # noqa: N803 - matches boto3 signature
        self.get_object_calls.append(Key)
        return {"Body": FakeBody(self._payloads[Key])}


class CollectTests(unittest.TestCase):
    def test_no_inbox_files_is_not_configured(self):
        client = FakeS3([], {})
        result = collect(bucket="fake-bucket", client=client, now=NOW)
        self.assertEqual(result, {"status": "not_configured"})

    def test_fresh_file_is_ok(self):
        key = "cybersecurity/inbox/ad/2026-10-08.json"
        payload = {"generatedAt": "2026-10-08T06:00:00Z", "domainAdminsCount": 25, "dnsAdminsCount": 28}
        client = FakeS3([{"Key": key, "LastModified": NOW - timedelta(hours=6)}], {key: payload})
        result = collect(bucket="fake-bucket", client=client, now=NOW)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"], {"domainAdminsCount": 25, "dnsAdminsCount": 28})
        self.assertEqual(result["sourceKey"], key)

    def test_old_file_is_stale_but_still_returns_data(self):
        key = "cybersecurity/inbox/ad/2026-10-01.json"
        payload = {"generatedAt": "2026-10-01T06:00:00Z", "domainAdminsCount": 25}
        client = FakeS3([{"Key": key, "LastModified": NOW - timedelta(days=7)}], {key: payload})
        result = collect(bucket="fake-bucket", client=client, now=NOW)
        self.assertEqual(result["status"], "stale")
        self.assertEqual(result["data"], {"domainAdminsCount": 25})

    def test_missing_generated_at_falls_back_to_s3_last_modified(self):
        key = "cybersecurity/inbox/ad/2026-10-08.json"
        payload = {"domainAdminsCount": 25}
        client = FakeS3([{"Key": key, "LastModified": NOW - timedelta(hours=1)}], {key: payload})
        result = collect(bucket="fake-bucket", client=client, now=NOW)
        self.assertEqual(result["status"], "ok")

    def test_rejected_field_fails_the_whole_file_not_just_that_field(self):
        key = "cybersecurity/inbox/ad/2026-10-08.json"
        payload = {"generatedAt": "2026-10-08T06:00:00Z", "domainAdminsCount": "not-a-number"}
        client = FakeS3([{"Key": key, "LastModified": NOW}], {key: payload})
        result = collect(bucket="fake-bucket", client=client, now=NOW)
        self.assertEqual(result["status"], "error")
        self.assertIn("domainAdminsCount", result["error"])

    def test_unexpected_exception_is_isolated_to_error_status(self):
        class ExplodingS3:
            def get_paginator(self, _name):
                raise RuntimeError("S3 is unreachable")

        result = collect(bucket="fake-bucket", client=ExplodingS3(), now=NOW)
        self.assertEqual(result["status"], "error")
        self.assertIn("RuntimeError", result["error"])


if __name__ == "__main__":
    unittest.main()
