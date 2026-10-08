"""Unit tests for the AWS source module. No network, no real AWS calls:
boto3 client construction (aws._client) is monkeypatched to hand-rolled fake
clients, the same style the repo's other publishers use for SQL Server
fakes (see common/test_mssql.py).

Run: PYTHONPATH=services/publishers python -m unittest discover
     -s services/publishers/security -t services/publishers/security
"""
from __future__ import annotations

import os
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


class WrapTests(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(aws._wrap("x", lambda: {"n": 1}), {"status": "ok", "data": {"n": 1}})

    def test_exception_never_propagates(self):
        def boom():
            raise _client_error("AccessDenied")

        result = aws._wrap("x", boom)
        self.assertEqual(result["status"], "error")
        self.assertIn("error", result)


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
    def __init__(self, passed: int, failed: int, by_sev: dict[str, int]):
        self.passed = passed
        self.failed = failed
        self.by_sev = by_sev

    def get_enabled_standards(self):
        return {
            "StandardsSubscriptions": [
                {"StandardsArn": "arn:aws:securityhub:::standards/aws-foundational-security-best-practices/v/1.0.0"}
            ]
        }

    def get_findings(self, Filters, MaxResults=100, NextToken=None):  # noqa: N803
        compliance = Filters.get("ComplianceStatus")
        severity = Filters.get("SeverityLabel")
        if compliance:
            count = self.passed if compliance[0]["Value"] == "PASSED" else self.failed
        elif severity:
            count = self.by_sev.get(severity[0]["Value"], 0)
        else:
            count = 0
        return {"Findings": [{}] * count}


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
