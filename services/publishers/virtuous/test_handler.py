"""Retry behavior for the Virtuous raw refresh client (no network)."""
from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
