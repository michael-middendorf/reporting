"""Tests for SSE-KMS writes and catalog behavior in common.sources / s3util. Fake S3 only."""
from __future__ import annotations

import io
import json
import unittest
from unittest import mock

from botocore.exceptions import ClientError

from common import s3util, sources

KMS = "arn:aws:kms:us-east-2:000000000000:key/22222222-2222-2222-2222-222222222222"
SSE = {"ServerSideEncryption": "aws:kms", "SSEKMSKeyId": KMS, "BucketKeyEnabled": True}


class FakePaginator:
    def __init__(self, client):
        self.client = client

    def paginate(self, Bucket, Prefix, Delimiter=None):  # noqa: N803
        keys = sorted(k for k in self.client.objects if k.startswith(Prefix))
        if Delimiter:
            prefixes = sorted({Prefix + k[len(Prefix):].split(Delimiter)[0] + Delimiter for k in keys if Delimiter in k[len(Prefix):]})
            yield {"CommonPrefixes": [{"Prefix": p} for p in prefixes]}
        else:
            yield {"Contents": [{"Key": k} for k in keys]}


class FakeS3:
    def __init__(self, objects=None, denied=None):
        self.objects: dict[str, bytes] = dict(objects or {})
        self.denied: dict[str, str] = dict(denied or {})  # key -> error code
        self.puts: list[dict] = []
        self.deleted: list[str] = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)
        self.objects[kwargs["Key"]] = kwargs["Body"]

    def get_object(self, Bucket, Key):  # noqa: N803
        if Key in self.denied:
            raise ClientError({"Error": {"Code": self.denied[Key], "Message": "denied"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[Key])}

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return FakePaginator(self)

    def delete_objects(self, Bucket, Delete):  # noqa: N803
        for o in Delete["Objects"]:
            self.deleted.append(o["Key"])
            self.objects.pop(o["Key"], None)


def _latest(source, dataset):
    return json.dumps({"source": source, "dataset": dataset, "dt": "2026-09-28", "record_count": 1}).encode()


class PutHelperTests(unittest.TestCase):
    def test_put_json_and_bytes_default_unchanged(self):
        fake = FakeS3()
        with mock.patch.object(s3util, "s3", return_value=fake):
            s3util.put_json("k.json", {"a": 1}, bucket="b")
            s3util.put_bytes("k.gz", b"x", content_type="application/gzip", bucket="b")
        for put in fake.puts:
            self.assertNotIn("ServerSideEncryption", put)
            self.assertNotIn("SSEKMSKeyId", put)
            self.assertNotIn("BucketKeyEnabled", put)

    def test_put_json_and_bytes_with_kms(self):
        fake = FakeS3()
        with mock.patch.object(s3util, "s3", return_value=fake):
            s3util.put_json("k.json", {"a": 1}, bucket="b", kms_key_id=KMS)
            s3util.put_bytes("k.gz", b"x", content_type="application/gzip", bucket="b", kms_key_id=KMS)
        for put in fake.puts:
            self.assertEqual({k: put[k] for k in SSE}, SSE)


class PublishDatasetTests(unittest.TestCase):
    def publish(self, fake, **kwargs):
        with mock.patch.object(s3util, "s3", return_value=fake), mock.patch.object(sources, "s3", return_value=fake):
            return sources.publish_dataset(source="pf", dataset="awards", rows=[{"a": 1}], bucket="b", dt="2026-10-01", **kwargs)

    def test_kms_on_every_object_and_no_catalog(self):
        fake = FakeS3()
        with mock.patch.object(sources, "refresh_catalog") as cat:
            latest = self.publish(fake, kms_key_id=KMS, refresh_catalog=False)
        cat.assert_not_called()
        self.assertEqual(latest["record_count"], 1)
        keys = [p["Key"] for p in fake.puts]
        self.assertEqual(
            keys,
            ["sources/pf/awards/dt=2026-10-01/data.jsonl.gz", "sources/pf/awards/dt=2026-10-01/meta.json", "sources/pf/awards/_latest.json"],
        )
        for put in fake.puts:
            self.assertEqual({k: put[k] for k in SSE}, SSE, put["Key"])
        self.assertNotIn("sources/_catalog.json", fake.objects)

    def test_default_behavior_unchanged(self):
        fake = FakeS3()
        latest = self.publish(fake)
        self.assertEqual(latest["dataset"], "awards")
        self.assertIn("sources/_catalog.json", fake.objects)
        for put in fake.puts:
            self.assertNotIn("ServerSideEncryption", put)

    def test_prune_still_runs_without_catalog(self):
        old = {f"sources/pf/awards/dt=2026-09-{d:02d}/data.jsonl.gz": b"x" for d in (25, 26, 27, 28)}
        fake = FakeS3(objects=old)
        self.publish(fake, kms_key_id=KMS, refresh_catalog=False, retain_days=3)
        self.assertEqual(
            sorted(fake.deleted),
            ["sources/pf/awards/dt=2026-09-25/data.jsonl.gz", "sources/pf/awards/dt=2026-09-26/data.jsonl.gz"],
        )


class RefreshCatalogTests(unittest.TestCase):
    def test_skips_kms_and_access_denied_latest(self):
        objects = {
            "sources/slate/apps/_latest.json": _latest("slate", "apps"),
            "sources/pf/awards/_latest.json": b"encrypted",
            "sources/gp/gl/_latest.json": b"encrypted",
            "sources/gp/ap/_latest.json": b"encrypted",
            "sources/x/y/_latest.json": b"encrypted",
        }
        denied = {
            "sources/pf/awards/_latest.json": "AccessDenied",
            "sources/gp/gl/_latest.json": "KMS.AccessDeniedException",
            "sources/gp/ap/_latest.json": "KMS.DisabledException",
            "sources/x/y/_latest.json": "AccessDeniedException",
        }
        fake = FakeS3(objects=objects, denied=denied)
        with mock.patch.object(s3util, "s3", return_value=fake), mock.patch.object(sources, "s3", return_value=fake):
            catalog = sources.refresh_catalog(bucket="b")
        self.assertEqual([e["latest_key"] for e in catalog["datasets"]], ["sources/slate/apps/_latest.json"])
        written = json.loads(fake.objects["sources/_catalog.json"])
        self.assertEqual(len(written["datasets"]), 1)

    def test_other_errors_still_recorded(self):
        objects = {"sources/a/b/_latest.json": b"not json", "sources/c/d/_latest.json": b"x"}
        fake = FakeS3(objects=objects, denied={"sources/c/d/_latest.json": "NoSuchKey"})
        with mock.patch.object(s3util, "s3", return_value=fake), mock.patch.object(sources, "s3", return_value=fake):
            catalog = sources.refresh_catalog(bucket="b")
        self.assertEqual(len(catalog["datasets"]), 2)
        self.assertTrue(all("error" in e for e in catalog["datasets"]))


if __name__ == "__main__":
    unittest.main()
