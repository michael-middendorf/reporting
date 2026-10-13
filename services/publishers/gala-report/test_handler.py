"""Unit tests for the gala report publisher (no network, no AWS).

Run: PYTHONPATH=services/publishers python -m unittest discover -s services/publishers/gala-report -t services/publishers/gala-report
"""
from __future__ import annotations

import copy
import datetime as dt
import io
import json
import unittest
import urllib.error
from pathlib import Path

import handler as h

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "gala-feed-fixture.json").read_text())
NOW = dt.datetime(2026, 10, 13, 14, 5, tzinfo=dt.timezone.utc)


class MemStore:
    def __init__(self, data=None):
        self.data = dict(data or {})
        self.writes: list[str] = []

    def get_json(self, key):
        return copy.deepcopy(self.data.get(key))

    def put_json(self, key, payload):
        self.writes.append(key)
        self.data[key] = copy.deepcopy(payload)
        return f"mem://{key}"


class ValidationTests(unittest.TestCase):

    def mutate(self, fn):
        doc = copy.deepcopy(FIXTURE)
        fn(doc)
        return doc

    def test_rejects_bad_payloads(self):
        bad = [
            None,
            [],
            self.mutate(lambda d: d.update(schemaVersion=2)),
            self.mutate(lambda d: d.update(schemaVersion=True)),
            self.mutate(lambda d: d.pop("schemaVersion")),
            self.mutate(lambda d: d.update(asOf="yesterday")),
            self.mutate(lambda d: d["categories"].pop("match")),
            self.mutate(lambda d: d["categories"]["tickets"].update(actual="1")),
            self.mutate(lambda d: d["gross"].update(actual=None)),
            self.mutate(lambda d: d["gross"].update(actual=float("nan"))),
            self.mutate(lambda d: d["expenses"].update(byCategory={})),
            self.mutate(lambda d: d.pop("netAfterExpenses")),
            self.mutate(lambda d: d["seats"].pop("comp")),
            self.mutate(lambda d: d.update(dataQuality="none")),
            self.mutate(lambda d: d["dataQuality"].append({"code": 1})),
        ]
        for payload in bad:
            with self.assertRaises(h.InvalidFeed):
                h.validate_feed(payload)


class PublishTests(unittest.TestCase):
    def test_writes_latest_snapshot_and_index(self):
        store = MemStore()
        out = h.publish(copy.deepcopy(FIXTURE), store, NOW)
        self.assertEqual(out["date"], "2026-10-13")
        self.assertEqual(set(store.data), {h.LATEST_KEY, "gala/snapshots/2026-10-13.json", h.INDEX_KEY})
        latest = store.data[h.LATEST_KEY]
        self.assertEqual(latest["publishedAt"], "2026-10-13T14:05:00Z")
        self.assertEqual(latest["gross"], FIXTURE["gross"])
        self.assertEqual(store.data["gala/snapshots/2026-10-13.json"], latest)
        self.assertEqual(
            store.data[h.INDEX_KEY],
            [
                {
                    "date": "2026-10-13",
                    "gross": {"actual": 508703.58, "actualPlusCommitment": 1233933.91},
                    "expenses": {"committed": 0},
                    "netAfterExpenses": {"actual": 508703.58, "actualPlusCommitment": 1233933.91},
                }
            ],
        )

    def test_date_is_eastern_not_utc(self):
        late = dt.datetime(2026, 10, 14, 2, 30, tzinfo=dt.timezone.utc)  # 10:30pm Oct 13 Eastern
        self.assertEqual(h.eastern_date(late), "2026-10-13")

    def test_upsert_replaces_same_day_and_sorts(self):
        older = {"date": "2026-10-01", "gross": {"actual": 1, "actualPlusCommitment": 2}, "expenses": {"committed": 0}, "netAfterExpenses": {"actual": 1, "actualPlusCommitment": 2}}
        stale_today = copy.deepcopy(older)
        stale_today["date"] = "2026-10-13"
        newer = copy.deepcopy(older)
        newer["date"] = "2026-10-20"
        store = MemStore({h.INDEX_KEY: [newer, stale_today, older]})
        h.publish(copy.deepcopy(FIXTURE), store, NOW)
        rows = store.data[h.INDEX_KEY]
        self.assertEqual([r["date"] for r in rows], ["2026-10-01", "2026-10-13", "2026-10-20"])
        self.assertEqual(rows[1]["gross"]["actual"], 508703.58)

    def test_second_run_same_day_overwrites_snapshot(self):
        store = MemStore()
        h.publish(copy.deepcopy(FIXTURE), store, NOW)
        later = copy.deepcopy(FIXTURE)
        later["gross"]["actual"] = 600000
        h.publish(later, store, NOW + dt.timedelta(hours=2))
        self.assertEqual(store.data["gala/snapshots/2026-10-13.json"]["gross"]["actual"], 600000)
        self.assertEqual(len(store.data[h.INDEX_KEY]), 1)
        self.assertEqual(store.data[h.INDEX_KEY][0]["gross"]["actual"], 600000)

    def test_invalid_payload_writes_nothing_and_keeps_latest(self):
        store = MemStore({h.LATEST_KEY: {"keep": True}})
        bad = copy.deepcopy(FIXTURE)
        bad["schemaVersion"] = 2
        with self.assertRaises(h.InvalidFeed):
            h.publish(bad, store, NOW)
        self.assertEqual(store.writes, [])
        self.assertEqual(store.data[h.LATEST_KEY], {"keep": True})


class FetchTests(unittest.TestCase):
    class Resp:
        def __init__(self, body):
            self.body = body

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def test_sends_bearer_and_parses(self):
        seen = {}

        def opener(req, timeout):
            seen["auth"] = req.get_header("Authorization")
            seen["feed_token"] = req.get_header("X-gala-feed-token")
            seen["timeout"] = timeout
            return self.Resp(json.dumps(FIXTURE).encode())

        out = h.fetch_feed("https://example.test/x", "tok", urlopen=opener, sleep=lambda s: None)
        self.assertEqual(out["schemaVersion"], 1)
        self.assertEqual(seen, {"auth": "Bearer tok", "feed_token": "tok", "timeout": 30})

    def test_retries_5xx_then_succeeds(self):
        calls = []

        def opener(req, timeout):
            calls.append(1)
            if len(calls) < 3:
                raise urllib.error.HTTPError("u", 503, "x", {}, io.BytesIO(b""))
            return self.Resp(b"{}")

        self.assertEqual(h.fetch_feed("https://u.test", "t", urlopen=opener, sleep=lambda s: None), {})
        self.assertEqual(len(calls), 3)

    def test_gives_up_after_three_timeouts(self):
        calls = []

        def opener(req, timeout):
            calls.append(1)
            raise TimeoutError()

        with self.assertRaises(RuntimeError):
            h.fetch_feed("https://u.test", "t", urlopen=opener, sleep=lambda s: None)
        self.assertEqual(len(calls), 3)

    def test_4xx_fails_without_retry_or_token_in_message(self):
        calls = []

        def opener(req, timeout):
            calls.append(1)
            raise urllib.error.HTTPError("u", 401, "x", {}, io.BytesIO(b""))

        with self.assertRaises(RuntimeError) as ctx:
            h.fetch_feed("https://u.test", "secret-token", urlopen=opener, sleep=lambda s: None)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("secret-token", str(ctx.exception))


class TokenTests(unittest.TestCase):
    def test_raw_and_json_tokens(self):
        self.assertEqual(h.parse_token("abc\n"), "abc")
        self.assertEqual(h.parse_token('{"token": " xyz "}'), "xyz")
        with self.assertRaises(RuntimeError):
            h.parse_token("  ")
        with self.assertRaises(RuntimeError):
            h.parse_token('{"other": "x"}')


if __name__ == "__main__":
    unittest.main()
