"""Unit tests for KPI/RAG composition and history deltas. Fixture source
dicts only; no network, no S3 (load_latest_previous is monkeypatched or
given a fake client where S3 behavior matters).

Run: PYTHONPATH=services/publishers python -m unittest discover
     -s services/publishers/security -t services/publishers/security
"""
from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from unittest import mock

import compose
import guard

NOW = datetime(2026, 10, 8, 5, 0, tzinfo=timezone.utc)


def _aws_source(**sub) -> dict:
    return {"status": "ok", "subStatus": {k: v["status"] for k, v in sub.items()}, "data": sub}


class RagTests(unittest.TestCase):
    def test_higher_is_better_boundaries(self):
        self.assertEqual(compose._rag(95, "higher_is_better", 95, 85), "green")
        self.assertEqual(compose._rag(90, "higher_is_better", 95, 85), "amber")
        self.assertEqual(compose._rag(80, "higher_is_better", 95, 85), "red")

    def test_lower_is_better_boundaries(self):
        self.assertEqual(compose._rag(0, "lower_is_better", 0, 5), "green")
        self.assertEqual(compose._rag(3, "lower_is_better", 0, 5), "amber")
        self.assertEqual(compose._rag(6, "lower_is_better", 0, 5), "red")

    def test_missing_value_is_unknown_never_a_fake_zero(self):
        self.assertEqual(compose._rag(None, "lower_is_better", 0, 5), "unknown")

    def test_non_numeric_value_is_unknown(self):
        self.assertEqual(compose._rag("not-a-number", "lower_is_better", 0, 5), "unknown")


SOURCES_ALL_OK = {
    "aws": _aws_source(
        securityhub={"status": "ok", "data": {"fsbpPassRatePercent": 92.0, "activeCriticalHigh": 1}},
        guardduty={"status": "ok", "data": {"criticalHigh": 0}},
        inspector2={"status": "ok", "data": {"criticalHighOverSla": 0}},
        iam={
            "status": "ok",
            "data": {
                "consoleUsersWithoutMfa": 0,
                "activeKeysOver90d": 0,
                "rootMfaEnabledValue": 1,
                "rootAccessKeysPresentValue": 0,
            },
        },
        cloudtrail={"status": "ok", "data": {"multiRegionTrailsNotLogging": 0}},
        backup={"status": "ok", "data": {"successPercent": 100.0}},
        rds={"status": "ok", "data": {"publiclyAccessibleCount": 0}},
        acm={"status": "ok", "data": {"expiring30": 0}},
        vpn={"status": "ok", "data": {"tunnelsDown": 0}},
    ),
    "github": {
        "status": "ok",
        "data": {"criticalHighOverSla": 0, "secretScanningOpenCount": 0},
    },
    "graph": {"status": "not_configured"},
    "ad": {"status": "ok", "data": {"domainAdminsCount": 4, "passwordNotRequiredCount": 0, "unconstrainedDelegationCount": 0}},
}


class BuildDocumentTests(unittest.TestCase):
    def test_all_green_when_everything_is_within_target(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        self.assertEqual(doc["generatedAt"], "2026-10-08T05:00:00Z")
        rags = {k["id"]: k["rag"] for k in doc["kpis"]}
        self.assertEqual(rags["fsbp_pass_rate"], "amber")  # 92 is below the 95 green bar
        self.assertEqual(rags["securityhub_active_critical_high"], "amber")  # 1 active, green bar is 0
        self.assertEqual(rags["guardduty_critical_high"], "green")
        self.assertEqual(rags["root_mfa_enabled"], "green")
        self.assertEqual(rags["rds_publicly_accessible_instances"], "green")

    def test_graph_not_configured_yields_unknown_not_a_fake_zero(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        # No KPI in PR 2 currently sources from graph (PR 3 adds them), but
        # confirm the source itself is carried through untouched for the
        # frontend to render as "not configured" rather than silently 0.
        self.assertEqual(doc["sources"]["graph"]["status"], "not_configured")

    def test_source_in_error_status_yields_unknown_kpis(self):
        sources = dict(SOURCES_ALL_OK)
        sources["aws"] = _aws_source(
            securityhub={"status": "error", "error": "AccessDenied: AccessDenied"},
            guardduty={"status": "ok", "data": {"criticalHigh": 0}},
            inspector2={"status": "not_licensed"},
            iam={"status": "ok", "data": {"consoleUsersWithoutMfa": 0, "activeKeysOver90d": 0, "rootMfaEnabledValue": 1, "rootAccessKeysPresentValue": 0}},
            cloudtrail={"status": "ok", "data": {"multiRegionTrailsNotLogging": 0}},
            backup={"status": "ok", "data": {"successPercent": 100.0}},
            rds={"status": "ok", "data": {"publiclyAccessibleCount": 0}},
            acm={"status": "ok", "data": {"expiring30": 0}},
            vpn={"status": "ok", "data": {"tunnelsDown": 0}},
        )
        doc = compose.build_document(sources, now=NOW)
        rags = {k["id"]: k["rag"] for k in doc["kpis"]}
        self.assertEqual(rags["fsbp_pass_rate"], "unknown")
        self.assertEqual(rags["securityhub_active_critical_high"], "unknown")
        self.assertEqual(rags["guardduty_critical_high"], "green")  # unaffected by securityhub failing

    def test_ad_stale_status_still_surfaces_data_but_forces_red(self):
        sources = dict(SOURCES_ALL_OK)
        sources["ad"] = {"status": "stale", "data": {"domainAdminsCount": 4}, "asOf": "2026-10-01T00:00:00Z"}
        doc = compose.build_document(sources, now=NOW)
        kpi = next(k for k in doc["kpis"] if k["id"] == "ad_domain_admins")
        self.assertEqual(kpi["value"], 4)
        self.assertEqual(kpi["rag"], "red")  # forced red by staleness even though 4 <= green threshold

    def test_ad_error_status_yields_unknown(self):
        sources = dict(SOURCES_ALL_OK)
        sources["ad"] = {"status": "error", "error": "boom"}
        doc = compose.build_document(sources, now=NOW)
        kpi = next(k for k in doc["kpis"] if k["id"] == "ad_domain_admins")
        self.assertIsNone(kpi["value"])
        self.assertEqual(kpi["rag"], "unknown")

    def test_delta_against_previous_history(self):
        previous = {"kpis": [{"id": "fsbp_pass_rate", "value": 85.0}]}
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW, previous=previous)
        kpi = next(k for k in doc["kpis"] if k["id"] == "fsbp_pass_rate")
        self.assertEqual(kpi["delta"], 7.0)

    def test_delta_is_none_without_previous_history(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW, previous=None)
        kpi = next(k for k in doc["kpis"] if k["id"] == "fsbp_pass_rate")
        self.assertIsNone(kpi["delta"])

    def test_document_passes_the_guard(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        guard.assert_clean(doc)  # must not raise


class FakeHistoryS3:
    def __init__(self, keys_to_bodies: dict[str, dict]):
        self._bodies = keys_to_bodies

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        contents = [{"Key": k} for k in self._bodies]
        return _OnePage(contents)

    def get_object(self, Bucket, Key):  # noqa: N803
        return {"Body": _Body(self._bodies[Key])}


class _OnePage:
    def __init__(self, contents):
        self._contents = contents

    def paginate(self, **_kwargs):
        return iter([{"Contents": self._contents}])


class _Body:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode("utf-8")


class LoadLatestPreviousTests(unittest.TestCase):
    def test_picks_lexicographically_newest_date_key(self):
        client = FakeHistoryS3(
            {
                "cybersecurity/history/2026-10-06.json": {"kpis": [{"id": "x", "value": 1}]},
                "cybersecurity/history/2026-10-07.json": {"kpis": [{"id": "x", "value": 2}]},
            }
        )
        result = compose.load_latest_previous(bucket="fake", client=client)
        self.assertEqual(result["kpis"][0]["value"], 2)

    def test_empty_history_returns_none(self):
        client = FakeHistoryS3({})
        self.assertIsNone(compose.load_latest_previous(bucket="fake", client=client))

    def test_broken_s3_returns_none_rather_than_raising(self):
        class ExplodingClient:
            def get_paginator(self, _name):
                raise RuntimeError("s3 down")

        self.assertIsNone(compose.load_latest_previous(bucket="fake", client=ExplodingClient()))


class BuildAndPublishTests(unittest.TestCase):
    def test_dry_run_does_not_write(self):
        with mock.patch.object(compose, "load_latest_previous", return_value=None):
            with mock.patch("common.s3util.put_json") as put_json:
                doc = compose.build_and_publish(SOURCES_ALL_OK, write=False, now=NOW, bucket="fake")
        put_json.assert_not_called()
        self.assertEqual(doc["generatedAt"], "2026-10-08T05:00:00Z")

    def test_write_true_writes_latest_and_history(self):
        with mock.patch.object(compose, "load_latest_previous", return_value=None):
            with mock.patch("common.s3util.put_json") as put_json:
                compose.build_and_publish(SOURCES_ALL_OK, write=True, now=NOW, bucket="fake")
        written_keys = [call.args[0] for call in put_json.call_args_list]
        self.assertIn("cybersecurity/latest.json", written_keys)
        self.assertIn("cybersecurity/history/2026-10-08.json", written_keys)

    def test_guard_violation_blocks_the_write(self):
        poisoned = dict(SOURCES_ALL_OK)
        poisoned["ad"] = {"status": "error", "error": "contact jane.doe@example.com for details"}
        with mock.patch.object(compose, "load_latest_previous", return_value=None):
            with mock.patch("common.s3util.put_json") as put_json:
                with self.assertRaises(guard.GuardViolation):
                    compose.build_and_publish(poisoned, write=True, now=NOW, bucket="fake")
        put_json.assert_not_called()


if __name__ == "__main__":
    unittest.main()
