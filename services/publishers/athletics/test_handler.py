"""Unit tests for AthleticsSlateQueries parsing (no network, no tokens logged)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

sys.modules.setdefault("common", MagicMock())
sys.modules.setdefault("common.sources", MagicMock())

from handler import (  # noqa: E402
    ConfigError,
    OPTIONAL_DATASETS,
    REQUIRED_DATASETS,
    _load_queries,
    _log_skipped_optional,
    _safe_error,
)


def secret(*names: str) -> str:
    queries = []
    for name in names:
        queries.append(
            {
                "name": name,
                "query_id": f"00000000-0000-0000-0000-{name[:12].ljust(12, '0')}",
                "token": "redacted",
                "auth": "bearer" if name == "applications" else "query",
            }
        )
    return json.dumps({"queries": queries})


class LoadQueriesTests(unittest.TestCase):
    def test_applications_and_prospects_are_required(self):
        loaded = _load_queries(secret("applications", "prospects"))
        self.assertEqual(set(loaded), REQUIRED_DATASETS)
        self.assertNotIn("roster", loaded)

    def test_roster_is_optional_and_skipped_when_absent(self):
        loaded = _load_queries(secret("applications", "prospects"))
        skipped = _log_skipped_optional(loaded)
        self.assertEqual(skipped, ["roster"])
        self.assertEqual(OPTIONAL_DATASETS, {"roster"})

    def test_roster_is_loaded_when_secret_has_query_id_and_token(self):
        loaded = _load_queries(secret("applications", "prospects", "roster"))
        self.assertIn("roster", loaded)
        query_id, token, timeout, auth = loaded["roster"]
        self.assertTrue(query_id)
        self.assertEqual(token, "redacted")
        self.assertEqual(auth, "query")
        self.assertEqual(timeout, 900)
        self.assertEqual(_log_skipped_optional(loaded), [])

    def test_roster_without_token_is_treated_as_missing(self):
        payload = json.loads(secret("applications", "prospects"))
        payload["queries"].append({"name": "roster", "query_id": "abc", "token": ""})
        loaded = _load_queries(json.dumps(payload))
        self.assertNotIn("roster", loaded)
        self.assertEqual(_log_skipped_optional(loaded), ["roster"])

    def test_missing_applications_still_fails(self):
        with self.assertRaises(ConfigError) as ctx:
            _load_queries(secret("prospects", "roster"))
        self.assertIn("applications", str(ctx.exception))

    def test_blank_secret_fails(self):
        with self.assertRaises(ConfigError):
            _load_queries("")

    def test_safe_error_strips_slate_h_token(self):
        text = _safe_error(
            RuntimeError("https://apply.avemaria.edu/manage/query/run?id=abc&h=super-secret&cmd=service")
        )
        self.assertIn("h=[redacted]", text)
        self.assertNotIn("super-secret", text)


if __name__ == "__main__":
    unittest.main()
