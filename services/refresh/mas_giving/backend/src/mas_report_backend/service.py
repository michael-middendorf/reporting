from __future__ import annotations

import json
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import boto3

from mas_follow_up_report.config import AppConfig
from mas_follow_up_report.pipeline import MAFollowUpPipeline
from mas_follow_up_report.virtuous import VirtuousClient

from .runtime import RuntimeConfig, load_runtime_config, resolve_api_key
from .storage import LocalArtifactTarget, PublishSummary, S3ArtifactTarget


@dataclass(frozen=True)
class RefreshResult:
    metadata: dict[str, Any]
    publishers: list[PublishSummary]
    workspace_dir: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "metadata": self.metadata,
            "publishers": [asdict(item) for item in self.publishers],
            "workspace_dir": self.workspace_dir,
        }


class ReportRefreshService:
    def __init__(self, runtime_config: RuntimeConfig | None = None) -> None:
        self.runtime_config = runtime_config or load_runtime_config()

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "aws_region": self.runtime_config.aws_region,
            "report_bucket": self.runtime_config.report_bucket,
            "cache_bucket": self.runtime_config.cache_bucket,
            "local_report_dir": str(self.runtime_config.local_report_dir) if self.runtime_config.local_report_dir else None,
            "local_cache_dir": str(self.runtime_config.local_cache_dir) if self.runtime_config.local_cache_dir else None,
        }

    def refresh(self) -> RefreshResult:
        secrets_client = None
        if self.runtime_config.virtuous_secret_id:
            session = boto3.Session(region_name=self.runtime_config.aws_region)
            secrets_client = session.client("secretsmanager", region_name=self.runtime_config.aws_region)
        api_key = resolve_api_key(self.runtime_config, secrets_client=secrets_client)

        with tempfile.TemporaryDirectory(prefix="mas-report-refresh-") as tempdir:
            workspace = Path(tempdir)
            pipeline_config = self._build_pipeline_config(workspace, api_key)
            client = VirtuousClient(
                base_url=pipeline_config.base_url,
                api_key=pipeline_config.api_key,
                timeout_seconds=pipeline_config.timeout_seconds,
            )
            pipeline = MAFollowUpPipeline(pipeline_config, client)
            metadata = pipeline.run(self.runtime_config.mode)
            publishers = self._publish_outputs(workspace, metadata)
            return RefreshResult(metadata=metadata, publishers=publishers, workspace_dir=str(workspace))

    def _build_pipeline_config(self, workspace: Path, api_key: str) -> AppConfig:
        data_dir = workspace / "data"
        return AppConfig(
            root_dir=workspace,
            base_url=self.runtime_config.virtuous_base_url,
            api_key=api_key,
            data_dir=data_dir,
            raw_dir=data_dir / "raw",
            derived_dir=data_dir / "derived",
            state_dir=data_dir / "state",
            exports_dir=data_dir / "exports",
            publish_dir=workspace / "publish" / "data",
            page_size=self.runtime_config.page_size,
            contact_chunk_size=self.runtime_config.contact_chunk_size,
            gift_window_days=self.runtime_config.gift_window_days,
            note_window_days=self.runtime_config.note_window_days,
            activity_default_days=self.runtime_config.activity_default_days,
            recent_gift_window_days=self.runtime_config.recent_gift_window_days,
            timeout_seconds=self.runtime_config.timeout_seconds,
        )

    def _publish_outputs(self, workspace: Path, metadata: dict[str, Any]) -> list[PublishSummary]:
        publishers: list[PublishSummary] = []
        report_source = workspace / "publish" / "data"
        raw_source = workspace / "data" / "raw"
        derived_source = workspace / "data" / "derived"
        state_source = workspace / "data" / "state"
        generated_at = str(metadata.get("generated_at") or "")

        if self.runtime_config.should_publish_local:
            publishers.append(
                LocalArtifactTarget(
                    report_dir=self.runtime_config.local_report_dir,
                    cache_dir=self.runtime_config.local_cache_dir,
                ).publish(
                    report_source=report_source,
                    raw_source=raw_source,
                    derived_source=derived_source,
                    state_source=state_source,
                    generated_at=generated_at,
                )
            )

        if self.runtime_config.should_publish_s3:
            session = boto3.Session(region_name=self.runtime_config.aws_region)
            publishers.append(
                S3ArtifactTarget(
                    session.client("s3", region_name=self.runtime_config.aws_region),
                    report_bucket=self.runtime_config.report_bucket,
                    report_prefix=self.runtime_config.report_prefix,
                    cache_bucket=self.runtime_config.cache_bucket,
                    cache_prefix=self.runtime_config.cache_prefix,
                ).publish(
                    report_source=report_source,
                    raw_source=raw_source,
                    derived_source=derived_source,
                    state_source=state_source,
                    generated_at=generated_at,
                )
            )
        return publishers


def dumps_result(result: RefreshResult) -> str:
    return json.dumps(result.as_dict(), indent=2, sort_keys=False)
