"""Unit tests for the PII/ARN/secret-key guard. No network, no AWS."""
from __future__ import annotations

import unittest

from guard import GuardViolation, assert_clean, scan


class ScanTests(unittest.TestCase):
    def test_clean_document_has_no_violations(self):
        doc = {
            "generatedAt": "2026-10-08T05:00:00Z",
            "kpis": [{"id": "fsbp_pass_rate", "value": 92.5, "rag": "amber", "label": "FSBP pass rate"}],
            "sources": {"aws": {"status": "ok", "data": {"iam": {"usersTotal": 12}}}},
        }
        self.assertEqual(scan(doc), [])
        assert_clean(doc)  # must not raise

    def test_email_is_caught_with_path(self):
        doc = {"sources": {"ad": {"owner": "jane.doe@example.com"}}}
        violations = scan(doc)
        self.assertIn(("$.sources.ad.owner", "email"), violations)
        with self.assertRaises(GuardViolation):
            assert_clean(doc)

    def test_ipv4_is_caught(self):
        doc = {"note": "vpn endpoint 10.20.30.40 is down"}
        violations = scan(doc)
        self.assertEqual([v[1] for v in violations], ["ipv4"])

    def test_arn_is_caught(self):
        doc = {"detail": "role arn:aws:iam::905418447941:role/ReportingWorker is misconfigured"}
        violations = scan(doc)
        self.assertEqual([v[1] for v in violations], ["arn"])

    def test_aws_access_key_is_caught(self):
        doc = {"leaked": "key AKIAABCDEFGHIJKLMNOP found in old commit"}
        violations = scan(doc)
        self.assertEqual([v[1] for v in violations], ["aws_access_key"])

    def test_violation_message_never_contains_the_value(self):
        doc = {"owner": "jane.doe@example.com"}
        try:
            assert_clean(doc)
            self.fail("expected GuardViolation")
        except GuardViolation as exc:
            self.assertNotIn("jane.doe@example.com", str(exc))
            self.assertIn("email", str(exc))

    def test_scan_walks_lists(self):
        doc = {"rows": [{"ok": "fine"}, {"bad": "visitor@example.com"}]}
        violations = scan(doc)
        self.assertEqual(violations, [("$.rows[1].bad", "email")])

    def test_percent_and_counts_do_not_false_positive_as_ipv4(self):
        doc = {"fsbpPassRatePercent": 92.5, "count": 12, "version": "3.12.14"}
        # version strings with 3 dot-separated 1-3 digit numbers are not 4-group IPv4
        self.assertEqual(scan(doc), [])


if __name__ == "__main__":
    unittest.main()
