"""Unit tests for the AWS source module. No network, no real AWS calls:
boto3 client construction (aws._client) is monkeypatched to hand-rolled fake
clients, the same style the repo's other publishers use for SQL Server
fakes (see common/test_mssql.py).

Run: PYTHONPATH=services/publishers python -m unittest discover
     -s services/publishers/security -t services/publishers/security
"""
from __future__ import annotations

import os
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import aws
from botocore.exceptions import ClientError


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "SomeOperation")


class ClassifyTests(unittest.TestCase):
    def test_access_denied(self):
        status, detail = aws._classify(_client_error("AccessDenied"))
        self.assertEqual(status, "error")
        self.assertIn("AccessDenied", detail)

    def test_not_licensed(self):
        status, _detail = aws._classify(_client_error("OptInRequired"))
        self.assertEqual(status, "not_licensed")

    def test_not_configured(self):
        status, _detail = aws._classify(_client_error("InvalidAccessException"))
        self.assertEqual(status, "not_configured")

    def test_unclassified_client_error_is_a_generic_error(self):
        status, detail = aws._classify(_client_error("Throttling", "slow down"))
        self.assertEqual(status, "error")
        self.assertIn("Throttling", detail)

    def test_non_client_error_is_a_generic_error(self):
        status, detail = aws._classify(RuntimeError("network blip"))
        self.assertEqual(status, "error")
        self.assertIn("RuntimeError", detail)

    def test_classify_never_includes_the_raw_message_even_when_it_has_an_arn(self):
        # aws.py:78 (pre-fix) put the raw botocore Message into the written
        # document, which can carry an ARN/account id and trip the PII/ARN
        # guard, blocking the whole write. _classify must return code-only.
        exc = _client_error(
            "TrailNotFoundException",
            "Unknown trail: arn:aws:cloudtrail:us-east-2:111122223333:trail/example-trail",
        )
        status, detail = aws._classify(exc)
        self.assertEqual(status, "error")
        self.assertEqual(detail, "TrailNotFoundException")
        self.assertNotIn("arn:aws", detail)
        self.assertNotIn("111122223333", detail)

    def test_full_message_is_for_logging_only_and_carries_the_real_text(self):
        exc = _client_error("TrailNotFoundException", "Unknown trail: arn:aws:cloudtrail:us-east-2:111122223333:trail/x")
        self.assertIn("arn:aws", aws._full_message(exc))

    def test_full_message_on_a_non_client_error(self):
        self.assertIn("network blip", aws._full_message(RuntimeError("network blip")))


class WrapTests(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(aws._wrap("x", lambda: {"n": 1}), {"status": "ok", "data": {"n": 1}})

    def test_exception_never_propagates(self):
        def boom():
            raise _client_error("AccessDenied")

        result = aws._wrap("x", boom)
        self.assertEqual(result["status"], "error")
        self.assertIn("error", result)

    def test_wrapped_error_never_carries_the_raw_arn_bearing_message(self):
        def boom():
            raise _client_error(
                "TrailNotFoundException",
                "Unknown trail: arn:aws:cloudtrail:us-east-2:111122223333:trail/example-trail",
            )

        result = aws._wrap("x", boom)
        self.assertEqual(result, {"status": "error", "error": "TrailNotFoundException"})
        self.assertNotIn("arn:aws", result["error"])


class MergeRegionResultsTests(unittest.TestCase):
    def test_all_regions_ok(self):
        merged = aws._merge_region_results("x", lambda region: {"region": region}, ("a", "b"))
        self.assertEqual(merged["status"], "ok")
        self.assertEqual(merged["byRegion"], {"a": "ok", "b": "ok"})
        self.assertEqual(set(merged["regions"]), {"a", "b"})

    def test_one_region_fails_the_other_still_reports(self):
        def region_fn(region):
            if region == "b":
                raise _client_error("AccessDenied")
            return {"region": region}

        merged = aws._merge_region_results("x", region_fn, ("a", "b"))
        self.assertEqual(merged["status"], "ok")
        self.assertEqual(merged["byRegion"]["a"], "ok")
        self.assertEqual(merged["byRegion"]["b"], "error")
        self.assertEqual(list(merged["regions"]), ["a"])

    def test_all_regions_not_configured(self):
        def region_fn(_region):
            raise _client_error("InvalidAccessException")

        merged = aws._merge_region_results("x", region_fn, ("a", "b"))
        self.assertEqual(merged["status"], "not_configured")
        self.assertNotIn("regions", merged)


# ---------------------------------------------------------------------------
# Fakes for end-to-end per-source tests
# ---------------------------------------------------------------------------


class FakeSecurityHubClient:
    """Single-pass fake: one GetFindings call per tally (distinguished by
    which filter key is present, matching aws.py's real filters), returning
    real-shaped findings (Compliance.Status / Severity.Label) for the
    caller to tally client-side, the same as the real API would."""

    def __init__(self, passed: int, failed: int, by_sev: dict[str, int], *, always_more: bool = False):
        self.passed = passed
        self.failed = failed
        self.by_sev = by_sev
        # When True, every page claims there's another page (NextToken set),
        # simulating a findings count larger than aws.py's page cap.
        self.always_more = always_more

    def get_enabled_standards(self):
        return {
            "StandardsSubscriptions": [
                {"StandardsArn": "arn:aws:securityhub:::standards/aws-foundational-security-best-practices/v/1.0.0"}
            ]
        }

    def get_findings(self, Filters, MaxResults=100, NextToken=None):  # noqa: N803
        if NextToken:
            # Every page after the first is empty except for always_more,
            # which repeats a single finding forever to simulate more
            # results than the page cap / time budget allows.
            findings = [{"Severity": {"Label": "CRITICAL"}}] if self.always_more else []
        elif "ComplianceAssociatedStandardsId" in Filters:
            findings = [{"Compliance": {"Status": "PASSED"}}] * self.passed + [
                {"Compliance": {"Status": "FAILED"}}
            ] * self.failed
        elif "WorkflowStatus" in Filters:
            findings = []
            for sev, count in self.by_sev.items():
                findings.extend([{"Severity": {"Label": sev}}] * count)
        else:
            findings = []
        resp = {"Findings": findings}
        if self.always_more:
            resp["NextToken"] = "more"
        return resp


class FakePaginator:
    def __init__(self, pages: list[dict]):
        self._pages = pages

    def paginate(self, **_kwargs):
        return iter(self._pages)


class FakeIamClient:
    def __init__(self, csv_body: bytes):
        self._csv_body = csv_body

    def generate_credential_report(self):
        return {"State": "COMPLETE"}

    def get_credential_report(self):
        return {"Content": self._csv_body}


class FakeRdsClient:
    def __init__(self, instances: list[dict]):
        self._instances = instances

    def get_paginator(self, name: str):
        assert name == "describe_db_instances"
        return FakePaginator([{"DBInstances": self._instances}])


class FakeBackupClient:
    def __init__(self, jobs: list[dict]):
        self._jobs = jobs

    def get_paginator(self, name: str):
        assert name == "list_backup_jobs"
        return FakePaginator([{"BackupJobs": self._jobs}])


class FakeEc2Client:
    def __init__(self, connections: list[dict]):
        self._connections = connections

    def describe_vpn_connections(self, Filters):  # noqa: N803
        return {"VpnConnections": self._connections}


IAM_CSV = (
    b"user,password_enabled,mfa_active,access_key_1_active,access_key_1_last_rotated,"
    b"access_key_2_active,access_key_2_last_rotated\n"
    b"<root_account>,not_supported,false,true,2020-01-01T00:00:00+00:00,false,N/A\n"
    b"user1,true,false,false,N/A,false,N/A\n"
    b"user2,true,true,true,2020-01-01T00:00:00+00:00,false,N/A\n"
)


class FakeMultiPageFindingsClient:
    """Plain multi-page GetFindings fake: each entry in ``pages`` is one
    page's worth of raw finding dicts. NextToken is set on every page
    except the last, so pagination ends naturally once ``pages`` runs out
    (no built-in truncation unless the caller's max_pages/deadline cuts it
    off first)."""

    def __init__(self, pages: list[list[dict]]):
        self._pages = pages
        self.calls = 0

    def get_findings(self, Filters, MaxResults=100, NextToken=None):  # noqa: N803
        page = self._pages[self.calls]
        self.calls += 1
        resp = {"Findings": page}
        if self.calls < len(self._pages):
            resp["NextToken"] = f"token-{self.calls}"
        return resp


class ScanFindingsTests(unittest.TestCase):
    """aws._scan_findings: the single-pass GetFindings helper that replaced
    one paginated call per severity/compliance-status bucket."""

    def test_tallies_every_finding_across_all_pages_when_nothing_truncates(self):
        client = FakeMultiPageFindingsClient([[{"v": 1}], [{"v": 2}], [{"v": 3}]])
        seen: list[dict] = []
        truncated = aws._scan_findings(client, {}, seen.append, deadline=time.monotonic() + 60)
        self.assertFalse(truncated)
        self.assertEqual(seen, [{"v": 1}, {"v": 2}, {"v": 3}])

    def test_truncates_when_the_page_cap_is_hit_with_more_pages_remaining(self):
        client = FakeMultiPageFindingsClient([[{"v": 1}], [{"v": 2}], [{"v": 3}]])
        seen: list[dict] = []
        truncated = aws._scan_findings(client, {}, seen.append, deadline=time.monotonic() + 60, max_pages=2)
        self.assertTrue(truncated)
        self.assertEqual(seen, [{"v": 1}, {"v": 2}])  # the 3rd page was never fetched

    def test_truncates_when_the_wall_clock_deadline_is_already_passed(self):
        # A deadline in the past: the page already in hand still gets
        # tallied, but the pass stops instead of requesting the next page.
        client = FakeMultiPageFindingsClient([[{"v": 1}], [{"v": 2}], [{"v": 3}]])
        seen: list[dict] = []
        truncated = aws._scan_findings(client, {}, seen.append, deadline=time.monotonic() - 1)
        self.assertTrue(truncated)
        self.assertEqual(seen, [{"v": 1}])

    def test_not_truncated_when_pagination_ends_naturally_even_past_the_deadline(self):
        # Only one page exists: NextToken is absent, so pagination ends
        # before the deadline is ever checked. An already-passed deadline
        # must never be reported as truncation when there was nothing left
        # to fetch anyway.
        client = FakeMultiPageFindingsClient([[{"v": 1}]])
        seen: list[dict] = []
        truncated = aws._scan_findings(client, {}, seen.append, deadline=time.monotonic() - 1)
        self.assertFalse(truncated)
        self.assertEqual(seen, [{"v": 1}])

    def test_a_shared_deadline_across_two_scans_can_truncate_the_second_one(self):
        # Mirrors _securityhub_region: one deadline is reused for both the
        # FSBP tally and the active-findings tally. If the first scan nearly
        # exhausts the budget, the second scan truncates even though it
        # individually "could" have paged further.
        deadline = time.monotonic() + 0.05
        slow_client = FakeMultiPageFindingsClient([[{"v": 1}], [{"v": 2}]])
        seen: list[dict] = []
        aws._scan_findings(slow_client, {}, seen.append, deadline=deadline)
        time.sleep(0.1)  # push past the shared deadline before the 2nd scan
        second_client = FakeMultiPageFindingsClient([[{"v": 3}], [{"v": 4}]])
        truncated = aws._scan_findings(second_client, {}, seen.append, deadline=deadline)
        self.assertTrue(truncated)
        self.assertEqual(seen, [{"v": 1}, {"v": 2}, {"v": 3}])  # the 2nd scan's page 2 never ran


class SecurityHubTests(unittest.TestCase):
    def test_pass_rate_and_active_findings(self):
        fake = FakeSecurityHubClient(passed=80, failed=20, by_sev={"CRITICAL": 1, "HIGH": 2, "MEDIUM": 3, "LOW": 4})
        with mock.patch.object(aws, "REGIONS", ("us-east-2",)), mock.patch.object(
            aws, "_client", return_value=fake
        ):
            result = aws.securityhub()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["fsbpPassRatePercent"], 80.0)
        self.assertEqual(result["data"]["fsbpControlsEvaluated"], 100)
        self.assertEqual(result["data"]["activeCriticalHigh"], 3)
        self.assertFalse(result["data"]["truncated"])

    def test_hitting_the_page_cap_sets_truncated_true(self):
        fake = FakeSecurityHubClient(
            passed=1, failed=1, by_sev={"CRITICAL": 1, "HIGH": 1, "MEDIUM": 1, "LOW": 1}, always_more=True
        )
        with mock.patch.object(aws, "REGIONS", ("us-east-2",)), mock.patch.object(
            aws, "_client", return_value=fake
        ):
            result = aws.securityhub()
        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["data"]["truncated"])


class IamCredentialReportTests(unittest.TestCase):
    def test_counts_only_no_usernames(self):
        with mock.patch.object(aws, "_client", return_value=FakeIamClient(IAM_CSV)):
            result = aws.iam_credential_report()
        self.assertEqual(result["status"], "ok")
        data = result["data"]
        self.assertEqual(data["usersTotal"], 2)
        self.assertEqual(data["consoleUsersWithoutMfa"], 1)  # user1
        self.assertEqual(data["activeKeysOver90d"], 1)  # user2's key1
        self.assertFalse(data["rootMfaEnabled"])
        self.assertTrue(data["rootAccessKeysPresent"])
        self.assertNotIn("user1", str(data))
        self.assertNotIn("user2", str(data))


class RdsTests(unittest.TestCase):
    def test_publicly_accessible_count_with_no_watch_list_configured(self):
        instances = [
            {"DBInstanceIdentifier": "example-instance-a", "PubliclyAccessible": True},
            {"DBInstanceIdentifier": "example-instance-b", "PubliclyAccessible": False},
        ]
        env = dict(os.environ)
        env.pop("SECURITY_WATCH_RDS_IDS", None)
        with mock.patch.object(aws, "REGIONS", ("us-east-2",)), mock.patch.object(
            aws, "_client", return_value=FakeRdsClient(instances)
        ), mock.patch.dict(os.environ, env, clear=True):
            result = aws.rds()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["instancesTotal"], 2)
        self.assertEqual(result["data"]["publiclyAccessibleCount"], 1)
        self.assertNotIn("watchedPubliclyAccessibleCount", result["data"])

    def test_watch_list_from_env_counts_only_the_named_instances(self):
        instances = [
            {"DBInstanceIdentifier": "example-instance-a", "PubliclyAccessible": True},
            {"DBInstanceIdentifier": "example-instance-b", "PubliclyAccessible": True},
        ]
        env = dict(os.environ)
        env["SECURITY_WATCH_RDS_IDS"] = "example-instance-a"
        with mock.patch.object(aws, "REGIONS", ("us-east-2",)), mock.patch.object(
            aws, "_client", return_value=FakeRdsClient(instances)
        ), mock.patch.dict(os.environ, env, clear=True):
            result = aws.rds()
        self.assertEqual(result["data"]["publiclyAccessibleCount"], 2)
        self.assertEqual(result["data"]["watchedInstancesConfigured"], 1)
        self.assertEqual(result["data"]["watchedPubliclyAccessibleCount"], 1)


class BackupTests(unittest.TestCase):
    def test_success_percent(self):
        jobs = [{"State": "COMPLETED"}] * 9 + [{"State": "FAILED"}]
        with mock.patch.object(aws, "REGIONS", ("us-east-2",)), mock.patch.object(
            aws, "_client", return_value=FakeBackupClient(jobs)
        ):
            result = aws.backup()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["jobsTotal"], 10)
        self.assertEqual(result["data"]["successPercent"], 90.0)


class VpnTests(unittest.TestCase):
    def test_tunnels_down_counts(self):
        connections = [
            {"VgwTelemetry": [{"Status": "UP"}, {"Status": "DOWN"}]},
        ]
        with mock.patch.object(aws, "REGIONS", ("us-east-2",)), mock.patch.object(
            aws, "_client", return_value=FakeEc2Client(connections)
        ):
            result = aws.vpn()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data"]["tunnelsUp"], 1)
        self.assertEqual(result["data"]["tunnelsTotal"], 2)
        self.assertEqual(result["data"]["tunnelsDown"], 1)


class CollectIsolationTests(unittest.TestCase):
    def test_one_source_failing_does_not_affect_others(self):
        with mock.patch.object(aws, "securityhub", return_value={"status": "ok", "data": {"x": 1}}), mock.patch.object(
            aws, "guardduty", return_value={"status": "error", "error": "AccessDenied: AccessDenied"}
        ), mock.patch.object(aws, "inspector2", return_value={"status": "not_licensed"}), mock.patch.object(
            aws, "iam_credential_report", return_value={"status": "ok", "data": {}}
        ), mock.patch.object(aws, "cloudtrail", return_value={"status": "ok", "data": {}}), mock.patch.object(
            aws, "backup", return_value={"status": "ok", "data": {}}
        ), mock.patch.object(aws, "rds", return_value={"status": "ok", "data": {}}), mock.patch.object(
            aws, "acm", return_value={"status": "ok", "data": {}}
        ), mock.patch.object(aws, "vpn", return_value={"status": "ok", "data": {}}):
            result = aws.collect()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["subStatus"]["guardduty"], "error")
        self.assertEqual(result["subStatus"]["inspector2"], "not_licensed")
        self.assertEqual(result["subStatus"]["securityhub"], "ok")
        self.assertEqual(result["data"]["guardduty"]["status"], "error")


if __name__ == "__main__":
    unittest.main()
