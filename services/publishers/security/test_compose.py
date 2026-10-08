"""Unit tests for KPI/RAG/status composition against the web app's CyberKpi
contract (apps/web-next/src/lib/cyber/shape.ts), history-based deltas, and
guard-violation redaction. Fixture source dicts only; S3 behavior is
exercised through fake clients, never real AWS.

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

# Hardcoded from apps/web-next/src/lib/cyber/shape.ts. If shape.ts changes
# these, this test (and compose.py) must change with it.
SHAPE_TS_SECTIONS = {"identity", "endpoints", "cloud", "resilience", "program"}  # excludes "overview" on purpose
SHAPE_TS_RAGS = {"red", "amber", "green", "grey"}
SHAPE_TS_STATUSES = {"ok", "not_licensed", "stale", "missing"}
# CyberKpi's exact field set (required + optional), from shape.ts.
SHAPE_TS_KPI_FIELDS = {
    "id", "label", "section", "headline", "value", "unit", "target", "rag",
    "delta", "lowerIsBetter", "source", "asOf", "status", "note",
}


def _aws_source(**sub) -> dict:
    return {"status": "ok", "subStatus": {k: v["status"] for k, v in sub.items()}, "data": sub}


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
    "github": {"status": "ok", "data": {"criticalHighOverSla": 0, "secretScanningOpenCount": 0}},
    "graph": {"status": "not_configured"},
    "ad": {
        "status": "ok",
        "data": {"domainAdminsCount": 4, "passwordNotRequiredCount": 0, "unconstrainedDelegationCount": 0},
    },
}


class RagTests(unittest.TestCase):
    def test_lower_is_better_boundaries(self):
        self.assertEqual(compose._rag(0, True, 0, 5), "green")
        self.assertEqual(compose._rag(3, True, 0, 5), "amber")
        self.assertEqual(compose._rag(6, True, 0, 5), "red")

    def test_higher_is_better_boundaries(self):
        self.assertEqual(compose._rag(95, False, 95, 85), "green")
        self.assertEqual(compose._rag(90, False, 95, 85), "amber")
        self.assertEqual(compose._rag(80, False, 95, 85), "red")

    def test_missing_value_is_grey_never_a_fake_color(self):
        self.assertEqual(compose._rag(None, True, 0, 5), "grey")

    def test_non_numeric_value_is_grey(self):
        self.assertEqual(compose._rag("not-a-number", True, 0, 5), "grey")

    def test_every_rag_value_this_function_can_return_is_in_shape_ts_rags(self):
        for value, lower_is_better in ((None, True), (0, True), (999, True), ("x", False)):
            self.assertIn(compose._rag(value, lower_is_better, 0, 5), SHAPE_TS_RAGS)


class KpiStatusTests(unittest.TestCase):
    def test_known_statuses_pass_through(self):
        self.assertEqual(compose._kpi_status("ok"), "ok")
        self.assertEqual(compose._kpi_status("stale"), "stale")
        self.assertEqual(compose._kpi_status("not_licensed"), "not_licensed")

    def test_error_and_not_configured_become_missing(self):
        self.assertEqual(compose._kpi_status("error"), "missing")
        self.assertEqual(compose._kpi_status("not_configured"), "missing")

    def test_anything_unrecognized_becomes_missing_not_a_new_enum_value(self):
        self.assertEqual(compose._kpi_status("whatever"), "missing")


class ContractTests(unittest.TestCase):
    """Every KPI compose.py emits must satisfy the shape the page reads."""

    def test_kpi_defs_shape_is_valid(self):
        for d in compose.KPI_DEFS:
            self.assertIn(d.section, SHAPE_TS_SECTIONS, f"{d.id}: section {d.section!r} not in shape.ts CYBER_SECTIONS")

    def test_at_most_10_headline_kpis(self):
        self.assertLessEqual(sum(1 for d in compose.KPI_DEFS if d.headline), 10)

    def test_every_built_kpi_matches_the_cyberkpi_contract(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        self.assertGreater(len(doc["kpis"]), 0)
        for kpi in doc["kpis"]:
            self.assertEqual(set(kpi.keys()), SHAPE_TS_KPI_FIELDS, kpi["id"])
            self.assertIsInstance(kpi["id"], str)
            self.assertIsInstance(kpi["label"], str)
            self.assertIn(kpi["section"], SHAPE_TS_SECTIONS)
            self.assertIsInstance(kpi["headline"], bool)
            self.assertIsInstance(kpi["lowerIsBetter"], bool)
            self.assertIsInstance(kpi["source"], str)
            self.assertIn(kpi["status"], SHAPE_TS_STATUSES)
            self.assertIn(kpi["rag"], SHAPE_TS_RAGS)
            self.assertTrue(kpi["value"] is None or isinstance(kpi["value"], (int, float, str)))
            self.assertTrue(kpi["delta"] is None or isinstance(kpi["delta"], (int, float)))

    def test_at_most_10_kpis_in_the_built_document_are_headline(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        self.assertLessEqual(sum(1 for k in doc["kpis"] if k["headline"]), 10)

    def test_no_built_kpi_ever_uses_section_overview(self):
        # "overview" is assembled client-side from headline=True; shape.ts's
        # kpisForSection would silently return [] for any KPI actually
        # tagged with it.
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        self.assertNotIn("overview", {k["section"] for k in doc["kpis"]})


class BuildDocumentTests(unittest.TestCase):
    def test_all_ok_yields_ok_status_and_a_colored_rag(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        by_id = {k["id"]: k for k in doc["kpis"]}
        self.assertEqual(by_id["fsbp_pass_rate"]["status"], "ok")
        self.assertEqual(by_id["fsbp_pass_rate"]["rag"], "amber")  # 92 is below the 95 green bar
        self.assertEqual(by_id["guardduty_critical_high"]["rag"], "green")
        self.assertEqual(by_id["root_mfa_enabled"]["rag"], "green")
        self.assertEqual(by_id["rds_publicly_accessible_instances"]["rag"], "green")

    def test_graph_not_configured_has_no_kpis_sourced_from_it_yet(self):
        doc = compose.build_document(SOURCES_ALL_OK, now=NOW)
        self.assertEqual(doc["sources"]["graph"]["status"], "not_configured")
        self.assertFalse(any(k["source"] == "Graph" for k in doc["kpis"]))

    def test_source_error_status_yields_missing_status_and_grey_rag(self):
        sources = dict(SOURCES_ALL_OK)
        sources["aws"] = _aws_source(
            securityhub={"status": "error", "error": "AccessDenied"},
            guardduty={"status": "ok", "data": {"criticalHigh": 0}},
            inspector2={"status": "not_licensed"},
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
        )
        doc = compose.build_document(sources, now=NOW)
        by_id = {k["id"]: k for k in doc["kpis"]}
        self.assertEqual(by_id["fsbp_pass_rate"]["status"], "missing")
        self.assertEqual(by_id["fsbp_pass_rate"]["rag"], "grey")
        self.assertIsNone(by_id["fsbp_pass_rate"]["value"])
        self.assertEqual(by_id["inspector_critical_high_over_sla"]["status"], "not_licensed")
        self.assertEqual(by_id["inspector_critical_high_over_sla"]["rag"], "grey")
        self.assertEqual(by_id["guardduty_critical_high"]["status"], "ok")  # unaffected by securityhub failing
        self.assertEqual(by_id["guardduty_critical_high"]["rag"], "green")

    def test_ad_stale_status_still_surfaces_the_value_with_grey_rag(self):
        sources = dict(SOURCES_ALL_OK)
        sources["ad"] = {"status": "stale", "data": {"domainAdminsCount": 4}, "asOf": "2026-10-01T00:00:00Z"}
        doc = compose.build_document(sources, now=NOW)
        kpi = next(k for k in doc["kpis"] if k["id"] == "ad_domain_admins")
        self.assertEqual(kpi["status"], "stale")
        self.assertEqual(kpi["value"], 4)  # the page shows the value with a "STALE" prefix, not Missing
        self.assertEqual(kpi["rag"], "grey")

    def test_ad_error_status_yields_missing(self):
        sources = dict(SOURCES_ALL_OK)
        sources["ad"] = {"status": "error", "error": "boom"}
        doc = compose.build_document(sources, now=NOW)
        kpi = next(k for k in doc["kpis"] if k["id"] == "ad_domain_admins")
        self.assertIsNone(kpi["value"])
        self.assertEqual(kpi["status"], "missing")
        self.assertEqual(kpi["rag"], "grey")

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


# ---------------------------------------------------------------------------
# History delta lookup: closest snapshot to 30 days before `now`
# ---------------------------------------------------------------------------


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


class LoadPreviousForDeltaTests(unittest.TestCase):
    def test_picks_the_snapshot_closest_to_30_days_before_now(self):
        # NOW is 2026-10-08; 30 days before is 2026-09-08. 09-09 is 1 day
        # away, 08-01 is 38 days away: 09-09 must win.
        client = FakeHistoryS3(
            {
                "cybersecurity/history/2026-08-01.json": {"kpis": [{"id": "x", "value": 1}]},
                "cybersecurity/history/2026-09-09.json": {"kpis": [{"id": "x", "value": 2}]},
                "cybersecurity/history/2026-10-07.json": {"kpis": [{"id": "x", "value": 3}]},
            }
        )
        result = compose.load_previous_for_delta(now=NOW, bucket="fake", client=client)
        self.assertEqual(result["kpis"][0]["value"], 2)

    def test_falls_back_to_the_oldest_available_when_everything_is_newer_than_30_days(self):
        # Only 3 and 1 days old: both newer than the 30-day target, so the
        # oldest of the two (3 days old) is the closest available.
        client = FakeHistoryS3(
            {
                "cybersecurity/history/2026-10-05.json": {"kpis": [{"id": "x", "value": 10}]},
                "cybersecurity/history/2026-10-07.json": {"kpis": [{"id": "x", "value": 20}]},
            }
        )
        result = compose.load_previous_for_delta(now=NOW, bucket="fake", client=client)
        self.assertEqual(result["kpis"][0]["value"], 10)

    def test_empty_history_returns_none(self):
        self.assertIsNone(compose.load_previous_for_delta(now=NOW, bucket="fake", client=FakeHistoryS3({})))

    def test_broken_s3_returns_none_rather_than_raising(self):
        class ExplodingClient:
            def get_paginator(self, _name):
                raise RuntimeError("s3 down")

        self.assertIsNone(compose.load_previous_for_delta(now=NOW, bucket="fake", client=ExplodingClient()))


# ---------------------------------------------------------------------------
# Guard redaction: a poisoned source is dropped, not the whole write
# ---------------------------------------------------------------------------


class OffendingTopLevelSourcesTests(unittest.TestCase):
    def test_matches_a_sources_rooted_path(self):
        violations = [("$.sources.github.error", "email"), ("$.sources.aws.data.iam.note", "ipv4")]
        self.assertEqual(compose._offending_top_level_sources(violations), {"github", "aws"})

    def test_ignores_a_path_outside_sources(self):
        violations = [("$.kpis[0].label", "email")]
        self.assertEqual(compose._offending_top_level_sources(violations), set())


class BuildAndPublishTests(unittest.TestCase):
    def test_dry_run_does_not_write(self):
        with mock.patch.object(compose, "load_previous_for_delta", return_value=None):
            with mock.patch("common.s3util.put_json") as put_json:
                doc = compose.build_and_publish(SOURCES_ALL_OK, write=False, now=NOW, bucket="fake")
        put_json.assert_not_called()
        self.assertEqual(doc["generatedAt"], "2026-10-08T05:00:00Z")

    def test_write_true_writes_latest_and_history(self):
        with mock.patch.object(compose, "load_previous_for_delta", return_value=None):
            with mock.patch("common.s3util.put_json") as put_json:
                compose.build_and_publish(SOURCES_ALL_OK, write=True, now=NOW, bucket="fake")
        written_keys = [call.args[0] for call in put_json.call_args_list]
        self.assertIn("cybersecurity/latest.json", written_keys)
        self.assertIn("cybersecurity/history/2026-10-08.json", written_keys)

    def test_an_arn_bearing_source_is_redacted_and_the_write_still_happens(self):
        # Regression for the bug where a raw botocore error message (which
        # can carry an ARN/account id) landed in sources.*.error, the guard
        # correctly refused to write it, and nothing was written at all.
        poisoned = dict(SOURCES_ALL_OK)
        poisoned["github"] = {
            "status": "error",
            "error": "role arn:aws:iam::111122223333:role/ExampleRole denied",
        }
        with mock.patch.object(compose, "load_previous_for_delta", return_value=None):
            with mock.patch("common.s3util.put_json") as put_json:
                doc = compose.build_and_publish(poisoned, write=True, now=NOW, bucket="fake")
        self.assertEqual(put_json.call_count, 2)  # latest.json + history/<date>.json: the write happened
        self.assertEqual(doc["sources"]["github"], {"status": "error", "error": "redacted"})
        github_kpi = next(k for k in doc["kpis"] if k["id"] == "github_critical_high_over_sla")
        self.assertEqual(github_kpi["status"], "missing")
        self.assertEqual(github_kpi["rag"], "grey")
        self.assertIsNone(github_kpi["value"])
        guard.assert_clean(doc)  # the written document itself is clean

    def test_redaction_leaves_other_sources_untouched(self):
        poisoned = dict(SOURCES_ALL_OK)
        poisoned["ad"] = {"status": "error", "error": "contact jane.doe@example.com for details"}
        with mock.patch.object(compose, "load_previous_for_delta", return_value=None):
            with mock.patch("common.s3util.put_json"):
                doc = compose.build_and_publish(poisoned, write=True, now=NOW, bucket="fake")
        self.assertEqual(doc["sources"]["ad"], {"status": "error", "error": "redacted"})
        # aws/github were never touched by the ad.* violation.
        self.assertEqual(doc["sources"]["github"]["status"], "ok")

    def test_raises_and_does_not_write_when_redaction_cannot_fix_it(self):
        # Simulates a violation the redaction pass cannot resolve (e.g. a
        # future bug that puts a sensitive value somewhere other than
        # sources.*): guard.scan keeps "finding" the same violation even
        # after the offending source is redacted and rebuilt.
        with mock.patch.object(compose, "load_previous_for_delta", return_value=None):
            with mock.patch.object(guard, "scan", return_value=[("$.kpis[0].note", "email")]):
                with mock.patch("common.s3util.put_json") as put_json:
                    with self.assertRaises(guard.GuardViolation):
                        compose.build_and_publish(SOURCES_ALL_OK, write=True, now=NOW, bucket="fake")
        put_json.assert_not_called()


if __name__ == "__main__":
    unittest.main()
