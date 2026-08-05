from __future__ import annotations

import mimetypes
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mas_follow_up_report.utils import ensure_dir


@dataclass(frozen=True)
class PublishSummary:
    target: str
    report_files: int
    cache_files: int
    report_location: str | None
    cache_location: str | None


def build_snapshot_label(generated_at: str) -> str:
    date_part, _, time_part = generated_at.partition("T")
    date_bits = date_part.split("-")
    if len(date_bits) != 3:
        return generated_at.replace(":", "").replace("-", "").replace("T", "/")
    time_bits = time_part.split("+", 1)[0].split(".", 1)[0].replace(":", "")
    return f"{date_bits[0]}/{date_bits[1]}/{date_bits[2]}/{time_bits or '000000'}"


def iter_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file())


def content_type_for(path: Path) -> str:
    if path.suffix == ".js":
        return "text/javascript; charset=utf-8"
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed:
        if guessed.startswith("text/") or guessed == "application/json":
            return f"{guessed}; charset=utf-8"
        return guessed
    return "application/octet-stream"


class LocalArtifactTarget:
    def __init__(self, report_dir: Path | None = None, cache_dir: Path | None = None) -> None:
        self.report_dir = report_dir
        self.cache_dir = cache_dir

    def publish(
        self,
        *,
        report_source: Path,
        raw_source: Path,
        derived_source: Path,
        state_source: Path,
        generated_at: str,
    ) -> PublishSummary:
        report_files = self._copy_tree(report_source, self.report_dir) if self.report_dir else 0
        cache_files = 0
        cache_location = None
        if self.cache_dir:
            snapshot_label = build_snapshot_label(generated_at)
            cache_files += self._copy_tree(raw_source, self.cache_dir / "raw" / snapshot_label)
            cache_files += self._copy_tree(derived_source, self.cache_dir / "derived" / snapshot_label)
            cache_files += self._copy_tree(state_source, self.cache_dir / "state" / snapshot_label)
            manifest = state_source / "manifest.json"
            if manifest.exists():
                ensure_dir(self.cache_dir / "state")
                shutil.copy2(manifest, self.cache_dir / "state" / "manifest.json")
                cache_files += 1
            cache_location = str(self.cache_dir)
        return PublishSummary(
            target="local",
            report_files=report_files,
            cache_files=cache_files,
            report_location=str(self.report_dir) if self.report_dir else None,
            cache_location=cache_location,
        )

    def _copy_tree(self, source_dir: Path, target_dir: Path) -> int:
        if not source_dir.exists():
            return 0
        count = 0
        for source in iter_files(source_dir):
            relative = source.relative_to(source_dir)
            target = target_dir / relative
            ensure_dir(target.parent)
            shutil.copy2(source, target)
            count += 1
        return count


class S3ArtifactTarget:
    def __init__(
        self,
        s3_client: Any,
        *,
        report_bucket: str | None,
        report_prefix: str = "",
        cache_bucket: str | None,
        cache_prefix: str = "",
    ) -> None:
        self.s3_client = s3_client
        self.report_bucket = report_bucket
        self.report_prefix = report_prefix.strip("/")
        self.cache_bucket = cache_bucket
        self.cache_prefix = cache_prefix.strip("/")

    def publish(
        self,
        *,
        report_source: Path,
        raw_source: Path,
        derived_source: Path,
        state_source: Path,
        generated_at: str,
    ) -> PublishSummary:
        report_files = 0
        cache_files = 0
        if self.report_bucket:
            report_files += self._upload_tree(
                source_dir=report_source,
                bucket=self.report_bucket,
                key_prefix=self.report_prefix,
                cache_control="no-cache",
            )
        if self.cache_bucket:
            snapshot_label = build_snapshot_label(generated_at)
            cache_files += self._upload_tree(
                source_dir=raw_source,
                bucket=self.cache_bucket,
                key_prefix=self._join(self.cache_prefix, "raw", snapshot_label),
                cache_control="private, no-store",
            )
            cache_files += self._upload_tree(
                source_dir=derived_source,
                bucket=self.cache_bucket,
                key_prefix=self._join(self.cache_prefix, "derived", snapshot_label),
                cache_control="private, no-store",
            )
            cache_files += self._upload_tree(
                source_dir=state_source,
                bucket=self.cache_bucket,
                key_prefix=self._join(self.cache_prefix, "state", snapshot_label),
                cache_control="private, no-store",
            )
            manifest = state_source / "manifest.json"
            if manifest.exists():
                self._upload_file(
                    source=manifest,
                    bucket=self.cache_bucket,
                    key=self._join(self.cache_prefix, "state", "manifest.json"),
                    cache_control="private, no-store",
                )
                cache_files += 1
        return PublishSummary(
            target="s3",
            report_files=report_files,
            cache_files=cache_files,
            report_location=self._location(self.report_bucket, self.report_prefix),
            cache_location=self._location(self.cache_bucket, self.cache_prefix),
        )

    def _upload_tree(self, *, source_dir: Path, bucket: str, key_prefix: str, cache_control: str) -> int:
        if not source_dir.exists():
            return 0
        count = 0
        for source in iter_files(source_dir):
            key = self._join(key_prefix, source.relative_to(source_dir).as_posix())
            self._upload_file(source=source, bucket=bucket, key=key, cache_control=cache_control)
            count += 1
        return count

    def _upload_file(self, *, source: Path, bucket: str, key: str, cache_control: str) -> None:
        extra_args = {
            "ContentType": content_type_for(source),
            "CacheControl": cache_control,
        }
        self.s3_client.upload_file(str(source), bucket, key, ExtraArgs=extra_args)

    def _join(self, *parts: str) -> str:
        return "/".join(part.strip("/") for part in parts if part and part.strip("/"))

    def _location(self, bucket: str | None, prefix: str) -> str | None:
        if not bucket:
            return None
        if prefix:
            return f"s3://{bucket}/{prefix}"
        return f"s3://{bucket}"
