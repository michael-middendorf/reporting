"""Unit tests for the GitHub App publisher. No network and no `cryptography`
dependency: RS256 signing is exercised through an injected fake signer, and
HTTP is exercised through an injected fake transport. CI installs only
boto3, so this file must never import cryptography at module scope.

Run: PYTHONPATH=services/publishers python -m unittest discover
     -s services/publishers/security -t services/publishers/security
"""
from __future__ import annotations

import base64
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import github
from github import (
    GithubClient,
    GithubHttpError,
    app_jwt_payload,
    collect,
    count_by_severity,
    encode_jwt_rs256,
    installation_token,
    mean_days_to_fix,
    over_sla_count,
    severity_of_code_scanning,
    severity_of_dependabot,
)

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


def _b64url_decode(segment: str) -> bytes:
    padded = segment + "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(padded)


class JwtConstructionTests(unittest.TestCase):
    def test_app_jwt_payload_math(self):
        payload = app_jwt_payload("12345", now=1_000_000)
        self.assertEqual(payload, {"iat": 1_000_000 - 60, "exp": 1_000_000 + 540, "iss": "12345"})

    def test_encode_jwt_rs256_uses_a_fake_signer_and_is_well_formed(self):
        calls: list[bytes] = []

        def fake_signer(signing_input: bytes, private_key_pem: str) -> bytes:
            calls.append(signing_input)
            self.assertEqual(private_key_pem, "fake-pem")
            return b"fake-signature"

        token = encode_jwt_rs256({"iat": 1, "exp": 2, "iss": "99"}, "fake-pem", signer=fake_signer)
        header_seg, payload_seg, sig_seg = token.split(".")
        self.assertEqual(json.loads(_b64url_decode(header_seg)), {"alg": "RS256", "typ": "JWT"})
        self.assertEqual(json.loads(_b64url_decode(payload_seg)), {"iat": 1, "exp": 2, "iss": "99"})
        self.assertEqual(_b64url_decode(sig_seg), b"fake-signature")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], f"{header_seg}.{payload_seg}".encode("ascii"))

    def test_installation_token_signs_and_posts(self):
        posted: dict[str, str] = {}

        def fake_post(url: str, jwt_token: str) -> dict[str, str]:
            posted["url"] = url
            posted["jwt"] = jwt_token
            return {"token": "ghs_fake"}

        token = installation_token(
            "12345", "67890", "fake-pem", now=1_000_000, signer=lambda *_: b"sig", post_json=fake_post
        )
        self.assertEqual(token, "ghs_fake")
        self.assertEqual(posted["url"], "https://api.github.com/app/installations/67890/access_tokens")
        header_seg = posted["jwt"].split(".")[0]
        self.assertEqual(json.loads(_b64url_decode(header_seg))["alg"], "RS256")

    def test_installation_token_raises_when_no_token_in_response(self):
        with self.assertRaises(GithubHttpError):
            installation_token(
                "1", "2", "pem", now=1, signer=lambda *_: b"sig", post_json=lambda *_: {"unexpected": "shape"}
            )


class GithubClientPaginationTests(unittest.TestCase):
    def test_follows_link_header_until_no_next(self):
        pages = [
            ([{"id": 1}, {"id": 2}], "https://api.github.com/orgs/AMU-Marketing/dependabot/alerts?page=2"),
            ([{"id": 3}], None),
        ]
        calls: list[str] = []

        def fake_get_page(url, _token):
            calls.append(url)
            return pages.pop(0)

        client = GithubClient("tok", get_page=fake_get_page)
        rows = client.paged_get("/orgs/AMU-Marketing/dependabot/alerts", {"state": "open"})
        self.assertEqual([r["id"] for r in rows], [1, 2, 3])
        self.assertEqual(len(calls), 2)

    def test_stops_at_max_pages_without_raising(self):
        def fake_get_page(url, _token):
            return [{"id": 1}], "https://api.github.com/next"

        client = GithubClient("tok", get_page=fake_get_page, max_pages=3)
        rows = client.paged_get("/orgs/AMU-Marketing/dependabot/alerts")
        self.assertEqual(len(rows), 3)


class SeverityClassificationTests(unittest.TestCase):
    def test_dependabot_severity_from_advisory(self):
        self.assertEqual(severity_of_dependabot({"security_advisory": {"severity": "CRITICAL"}}), "critical")

    def test_dependabot_severity_falls_back_to_vulnerability(self):
        self.assertEqual(severity_of_dependabot({"security_vulnerability": {"severity": "high"}}), "high")

    def test_dependabot_severity_unknown_when_absent(self):
        self.assertEqual(severity_of_dependabot({}), "unknown")

    def test_code_scanning_severity_from_rule(self):
        self.assertEqual(severity_of_code_scanning({"rule": {"security_severity_level": "high"}}), "high")

    def test_count_by_severity(self):
        alerts = [{"security_advisory": {"severity": "high"}}, {"security_advisory": {"severity": "high"}}, {}]
        self.assertEqual(count_by_severity(alerts, severity_of_dependabot), {"high": 2, "unknown": 1})


class SlaAndMeanFixTests(unittest.TestCase):
    def test_critical_over_7_days_counts(self):
        alerts = [{"security_advisory": {"severity": "critical"}, "created_at": "2026-09-30T00:00:00Z"}]
        self.assertEqual(over_sla_count(alerts, severity_of_dependabot, now=NOW), 1)

    def test_critical_within_7_days_does_not_count(self):
        alerts = [{"security_advisory": {"severity": "critical"}, "created_at": "2026-10-05T00:00:00Z"}]
        self.assertEqual(over_sla_count(alerts, severity_of_dependabot, now=NOW), 0)

    def test_high_uses_30_day_sla_not_7(self):
        alerts = [{"security_advisory": {"severity": "high"}, "created_at": "2026-09-20T00:00:00Z"}]
        # 18 days old: over the 7-day critical SLA but under the 30-day high SLA.
        self.assertEqual(over_sla_count(alerts, severity_of_dependabot, now=NOW), 0)

    def test_medium_severity_never_counts_toward_sla(self):
        alerts = [{"security_advisory": {"severity": "medium"}, "created_at": "2026-01-01T00:00:00Z"}]
        self.assertEqual(over_sla_count(alerts, severity_of_dependabot, now=NOW), 0)

    def test_mean_days_to_fix_only_counts_recently_fixed(self):
        alerts = [
            {"created_at": "2026-10-01T00:00:00Z", "fixed_at": "2026-10-05T00:00:00Z"},  # 4 days, in window
            {"created_at": "2025-01-01T00:00:00Z", "fixed_at": "2025-01-10T00:00:00Z"},  # fixed >90d ago: excluded
            {"created_at": "2026-10-01T00:00:00Z", "fixed_at": None},  # never fixed: excluded
        ]
        self.assertEqual(mean_days_to_fix(alerts, now=NOW), 4.0)

    def test_mean_days_to_fix_is_none_when_nothing_qualifies(self):
        self.assertIsNone(mean_days_to_fix([], now=NOW))


class CollectTests(unittest.TestCase):
    def test_not_configured_when_no_secret_env(self):
        with mock.patch.object(github, "load_secret", return_value=None):
            self.assertEqual(collect(), {"status": "not_configured"})

    def test_secret_load_failure_is_isolated(self):
        with mock.patch.object(github, "load_secret", side_effect=RuntimeError("secretsmanager down")):
            result = collect()
            self.assertEqual(result["status"], "error")
            self.assertIn("RuntimeError", result["error"])

    def test_missing_secret_keys_is_an_error_not_a_crash(self):
        with mock.patch.object(github, "load_secret", return_value={"app_id": "1"}):
            result = collect()
            self.assertEqual(result["status"], "error")
            self.assertIn("installation_id", result["error"])

    def test_api_error_during_collection_is_isolated(self):
        secret = {"app_id": "1", "installation_id": "2", "private_key_pem": "pem"}
        with mock.patch.object(github, "load_secret", return_value=secret), mock.patch.object(
            github, "installation_token", side_effect=GithubHttpError("url", 403, "forbidden")
        ):
            result = collect()
            self.assertEqual(result["status"], "error")
            self.assertIn("403", result["error"])

    def test_ok_path_aggregates_counts_only(self):
        secret = {"app_id": "1", "installation_id": "2", "private_key_pem": "pem"}
        dependabot_open = [
            {"security_advisory": {"severity": "critical"}, "created_at": "2026-09-01T00:00:00Z"},
            {"security_advisory": {"severity": "low"}, "created_at": "2026-10-01T00:00:00Z"},
        ]
        code_scanning_open = [{"rule": {"security_severity_level": "high"}, "created_at": "2026-08-01T00:00:00Z"}]
        secret_scanning_open = [{"number": 1}, {"number": 2}]
        dependabot_fixed = [{"created_at": "2026-10-01T00:00:00Z", "fixed_at": "2026-10-03T00:00:00Z"}]
        responses = [dependabot_open, code_scanning_open, secret_scanning_open, dependabot_fixed]

        def fake_paged_get(self, path, params=None):
            return responses.pop(0)

        with mock.patch.object(github, "load_secret", return_value=secret), mock.patch.object(
            github, "installation_token", return_value="tok"
        ), mock.patch.object(GithubClient, "paged_get", fake_paged_get):
            result = collect()
        self.assertEqual(result["status"], "ok")
        data = result["data"]
        self.assertEqual(data["dependabotOpenBySeverity"], {"critical": 1, "low": 1})
        self.assertEqual(data["codeScanningOpenBySeverity"], {"high": 1})
        self.assertEqual(data["secretScanningOpenCount"], 2)
        self.assertEqual(data["criticalHighOverSla"], 2)  # the critical dependabot alert + the high code scanning one
        self.assertEqual(data["meanDaysToFixLast90d"], 2.0)
        # Counts only: no alert numbers, titles, or repo names in the output.
        self.assertNotIn("number", json.dumps(data))


if __name__ == "__main__":
    unittest.main()
