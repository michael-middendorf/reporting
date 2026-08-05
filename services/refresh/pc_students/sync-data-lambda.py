#!/usr/bin/env python3
"""Sync Qlik data-product datasets into S3 Tables via Athena MERGE upsert.

Flow (designed to finish within a 15-minute Lambda timeout):
  1. Extract each Qlik dataset to local Parquet (OData, with engine fallback).
  2. Overwrite a staging Iceberg table (`stg_<table>`) in the S3 Table bucket.
  3. Run Athena `MERGE INTO` using proven per-table business keys.
  4. Source rows without a match are inserted as new target records.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from pyiceberg.catalog import MetastoreCatalog, PropertiesUpdateSummary
from pyiceberg.exceptions import NoSuchTableError
from pyiceberg.io import AWS_REGION, PY_IO_IMPL, FSSPEC_FILE_IO
from pyiceberg.io.pyarrow import pyarrow_to_schema
from pyiceberg.partitioning import UNPARTITIONED_PARTITION_SPEC
from pyiceberg.schema import Schema
from pyiceberg.serializers import FromInputFile, ToOutputFile
from pyiceberg.table import CommitTableResponse, Table
from pyiceberg.table.metadata import new_table_metadata
from pyiceberg.table.snapshots import TOTAL_RECORDS
from pyiceberg.table.sorting import UNSORTED_SORT_ORDER
from pyiceberg.table.update import TableRequirement, TableUpdate
from pyiceberg.typedef import EMPTY_DICT, Identifier, Properties
import websockets

DEFAULT_PRODUCT_ID = "6a58e8f0c5e7d7843cb3136f"
DEFAULT_BUCKET = "pc-table-bucket"
DEFAULT_NAMESPACE = "pc_data"
DEFAULT_REGION = "us-east-2"
DEFAULT_BATCH_SIZE = 1000
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_MAX_RETRIES = 8
DEFAULT_ENGINE_CONNECTION_NAME = "Digital Strategy Team:AMU_ODS"
DEFAULT_ENGINE_SQL_SCHEMA = "rpt"
DEFAULT_ENGINE_PAGE_SIZE = 1000
DEFAULT_STAGING_PREFIX = "stg_"
DEFAULT_ATHENA_CATALOG = "s3tablescatalog/pc-table-bucket"
DEFAULT_ATHENA_WORKGROUP = "primary"
DEFAULT_ATHENA_POLL_SECONDS = 2.0
DEFAULT_ATHENA_TIMEOUT_SECONDS = 600
DEFAULT_WRITE_MODE = "merge"  # merge | overwrite
DEFAULT_EXPECTED_DATASETS = (
    "vwAlumniDegreeHistory.csv",
    "vwAlumniProfile.csv",
    "vwStudentContactPoints.csv",
    "vwStudentAcademicPlans.csv",
    "vwCurrentStudentProfile.csv",
    "vwStudentAssociations.csv",
    "vwPersonDemographicsRestricted.csv",
    "vwStudentAthleticParticipation.csv",
    "vwStudentAcademicHistory.csv",
    "vwStudentParentContacts.csv",
    "vwIncomingStudentProfile.csv",
)
DEFAULT_MERGE_KEYS: Dict[str, List[str]] = {
    "vw_alumni_degree_history": ["persondegreeid"],
    "vw_alumni_profile": ["pcid"],
    "vw_current_student_profile": ["pcid"],
    "vw_incoming_student_profile": ["pcid"],
    "vw_person_demographics_restricted": ["pcid", "termcode"],
    "vw_student_academic_history": ["pcid", "termcode", "academicsession"],
    "vw_student_academic_plans": ["studentacademicplanid"],
    "vw_student_associations": ["pcid", "termcode", "associationcode", "officeheldcode"],
    "vw_student_athletic_participation": ["pcid", "termcode", "sportcode"],
    "vw_student_contact_points": ["pcid", "contactpointtypecode", "contactpointsubtypecode", "contactvalue"],
    # This dataset exposes StudentPCID rather than PCID.
    "vw_student_parent_contacts": ["studentpcid", "relatedpersonid", "relationshiptypecode", "contactsourcetype"],
}
QLIK_INTEGER_TYPES = {"INT", "INTEGER", "BIGINT", "SMALLINT", "LONG"}
QLIK_FLOAT_TYPES = {"FLOAT", "DOUBLE", "NUMBER", "NUMERIC", "REAL"}
QLIK_BOOLEAN_TYPES = {"BOOL", "BOOLEAN"}
QLIK_DATE_TYPES = {"DATE"}
QLIK_TIMESTAMP_TYPES = {"DATETIME", "TIMESTAMP"}


class SyncError(RuntimeError):
    """Expected runtime error for the sync flow."""


class QlikRateLimitError(SyncError):
    """Raised when Qlik rate-limits a request that should switch strategies immediately."""


@dataclass
class Config:
    qlik_api_key: str
    qlik_tenant: str
    aws_region: str
    aws_profile: Optional[str]
    qlik_timeout_seconds: int
    batch_size: int
    qlik_engine_connection_name: str
    qlik_engine_sql_schema: str
    product_id: str
    bucket: str
    namespace: str
    write_mode: str
    staging_prefix: str
    athena_catalog: str
    athena_workgroup: str
    athena_output_location: str
    athena_poll_seconds: float
    athena_timeout_seconds: int
    merge_keys: Dict[str, List[str]]
    merge_delete_missing: bool
    merge_fallback_to_overwrite: bool


@dataclass
class ColumnSpec:
    source_name: str
    target_name: str
    qlik_type: str
    arrow_type: pa.DataType
    nullable: bool


@dataclass
class DatasetPlan:
    dataset_id: str
    dataset_name: str
    table_name: str
    source_space_id: Optional[str]
    connection_id: Optional[str]
    columns: List[ColumnSpec]
    source_row_count: Optional[int]
    metadata: Dict[str, Any]
    normalized_schema: pa.Schema


@dataclass
class DatasetResult:
    dataset_id: str
    dataset_name: str
    table_name: str
    source_row_count: Optional[int]
    extracted_row_count: int
    target_row_count: Optional[int]
    schema_match: bool
    success: bool
    validation_status: str
    target_location: Optional[str] = None
    message: Optional[str] = None
    merge_keys: List[str] = field(default_factory=list)
    athena_query_ids: List[str] = field(default_factory=list)
    staged_parquet_paths: List[str] = field(default_factory=list)


def log(message: str, **metadata: Any) -> None:
    payload = {"message": message, **metadata}
    print(json.dumps(payload, sort_keys=True), flush=True)


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def load_merge_keys() -> Dict[str, List[str]]:
    keys = {table: list(cols) for table, cols in DEFAULT_MERGE_KEYS.items()}
    raw = os.getenv("MERGE_KEYS_JSON")
    if not raw:
        return keys
    try:
        override = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SyncError(f"MERGE_KEYS_JSON is not valid JSON: {exc}") from exc
    if not isinstance(override, dict):
        raise SyncError("MERGE_KEYS_JSON must be a JSON object of table_name -> [key, ...]")
    for table_name, columns in override.items():
        if not isinstance(columns, list) or not all(isinstance(col, str) for col in columns):
            raise SyncError(f"MERGE_KEYS_JSON[{table_name!r}] must be a list of strings")
        keys[str(table_name)] = [col.strip().lower() for col in columns]
    return keys


def load_config() -> Config:
    env_path = Path(__file__).resolve().parent / ".env.local"
    if env_path.exists():
        load_dotenv(env_path)

    qlik_api_key = os.getenv("QLIK_API_KEY")
    qlik_tenant = os.getenv("QLIK_TENANT")
    if not qlik_api_key or not qlik_tenant:
        raise SyncError("QLIK_API_KEY and QLIK_TENANT are required in back/.env.local or the environment")

    write_mode = (os.getenv("WRITE_MODE") or DEFAULT_WRITE_MODE).strip().lower()
    if write_mode not in {"merge", "overwrite"}:
        raise SyncError("WRITE_MODE must be 'merge' or 'overwrite'")

    athena_output = (os.getenv("ATHENA_OUTPUT_LOCATION") or "").strip()
    if athena_output and not athena_output.startswith("s3://"):
        raise SyncError("ATHENA_OUTPUT_LOCATION must be an s3:// URI")

    return Config(
        qlik_api_key=qlik_api_key,
        qlik_tenant=qlik_tenant,
        aws_region=os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or DEFAULT_REGION,
        aws_profile=os.getenv("AWS_PROFILE"),
        qlik_timeout_seconds=int(os.getenv("QLIK_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)),
        batch_size=int(os.getenv("QLIK_BATCH_SIZE", DEFAULT_BATCH_SIZE)),
        qlik_engine_connection_name=os.getenv("QLIK_ENGINE_CONNECTION_NAME") or DEFAULT_ENGINE_CONNECTION_NAME,
        qlik_engine_sql_schema=os.getenv("QLIK_ENGINE_SQL_SCHEMA") or DEFAULT_ENGINE_SQL_SCHEMA,
        product_id=os.getenv("QLIK_PRODUCT_ID") or DEFAULT_PRODUCT_ID,
        bucket=os.getenv("S3_TABLE_BUCKET") or DEFAULT_BUCKET,
        namespace=os.getenv("S3_TABLE_NAMESPACE") or DEFAULT_NAMESPACE,
        write_mode=write_mode,
        staging_prefix=os.getenv("STAGING_TABLE_PREFIX") or DEFAULT_STAGING_PREFIX,
        athena_catalog=os.getenv("ATHENA_CATALOG") or DEFAULT_ATHENA_CATALOG,
        athena_workgroup=os.getenv("ATHENA_WORKGROUP") or DEFAULT_ATHENA_WORKGROUP,
        athena_output_location=athena_output.rstrip("/") + "/" if athena_output else "",
        athena_poll_seconds=float(os.getenv("ATHENA_POLL_SECONDS", DEFAULT_ATHENA_POLL_SECONDS)),
        athena_timeout_seconds=int(os.getenv("ATHENA_TIMEOUT_SECONDS", DEFAULT_ATHENA_TIMEOUT_SECONDS)),
        merge_keys=load_merge_keys(),
        merge_delete_missing=env_bool("MERGE_DELETE_MISSING", False),
        merge_fallback_to_overwrite=env_bool("MERGE_FALLBACK_TO_OVERWRITE", True),
    )


def build_session(config: Config) -> boto3.Session:
    kwargs: Dict[str, Any] = {"region_name": config.aws_region}
    if config.aws_profile:
        kwargs["profile_name"] = config.aws_profile
    return boto3.Session(**kwargs)


def qlik_base_url(config: Config) -> str:
    tenant = config.qlik_tenant.strip()
    if tenant.startswith("http://") or tenant.startswith("https://"):
        return tenant.rstrip("/")
    return f"https://{tenant.rstrip('/')}"


def qlik_request(
    config: Config,
    path: str,
    *,
    method: str = "GET",
    payload: Optional[Dict[str, Any]] = None,
    accept: str = "application/json",
) -> Tuple[bytes, Dict[str, str], int]:
    url = urljoin(f"{qlik_base_url(config)}/", path.lstrip("/"))
    headers = {
        "Authorization": f"Bearer {config.qlik_api_key}",
        "Accept": accept,
    }
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    return qlik_request_bytes(config, url, method=method, data=data, headers=headers, request_label=path)


def retry_delay_seconds(attempt: int, retry_after_header: Optional[str]) -> float:
    if retry_after_header:
        try:
            return max(float(retry_after_header), 1.0)
        except ValueError:
            pass
    return min(2**attempt, 30)


def is_dataset_rows_request(request_label: str) -> bool:
    return (
        "/api/data-governance/data-access/data-products/" in request_label
        and "/datasets/" in request_label
        and "/connections/" in request_label
    )


def qlik_request_bytes(
    config: Config,
    url: str,
    *,
    method: str,
    data: Optional[bytes],
    headers: Dict[str, str],
    request_label: str,
) -> Tuple[bytes, Dict[str, str], int]:
    last_error: Optional[Exception] = None
    for attempt in range(DEFAULT_MAX_RETRIES):
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=config.qlik_timeout_seconds) as response:
                return response.read(), dict(response.headers), response.status
        except HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            if exc.code == 429 and is_dataset_rows_request(request_label):
                raise QlikRateLimitError(
                    f"Qlik request rate-limited: {method} {request_label} -> 429 {body[:300]}"
                ) from exc
            retryable = exc.code == 429 or 500 <= exc.code < 600
            if retryable and attempt + 1 < DEFAULT_MAX_RETRIES:
                delay = retry_delay_seconds(attempt, exc.headers.get("Retry-After"))
                log(
                    "qlik_retry",
                    request=request_label,
                    status=exc.code,
                    attempt=attempt + 1,
                    sleep_seconds=delay,
                )
                time.sleep(delay)
                last_error = exc
                continue
            raise SyncError(f"Qlik request failed: {method} {request_label} -> {exc.code} {body[:300]}") from exc
        except URLError as exc:
            if attempt + 1 < DEFAULT_MAX_RETRIES:
                delay = retry_delay_seconds(attempt, None)
                log(
                    "qlik_retry",
                    request=request_label,
                    status="urlerror",
                    attempt=attempt + 1,
                    sleep_seconds=delay,
                )
                time.sleep(delay)
                last_error = exc
                continue
            raise SyncError(f"Qlik request failed: {method} {request_label} -> {exc}") from exc

    raise SyncError(f"Qlik request exhausted retries: {method} {request_label} -> {last_error}")


def qlik_request_json(
    config: Config,
    path: str,
    *,
    method: str = "GET",
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    raw, _, _ = qlik_request(config, path, method=method, payload=payload)
    return json.loads(raw.decode("utf-8"))


def qlik_request_json_url(config: Config, url: str) -> Dict[str, Any]:
    raw, _, _ = qlik_request_bytes(
        config,
        url,
        method="GET",
        data=None,
        headers={
            "Authorization": f"Bearer {config.qlik_api_key}",
            "Accept": "application/json",
        },
        request_label=url,
    )
    return json.loads(raw.decode("utf-8"))


def get_data_product(config: Config, product_id: str) -> Dict[str, Any]:
    return qlik_request_json(config, f"/api/v1/data-products/{product_id}")


def get_dataset_metadata(config: Config, dataset_id: str) -> Dict[str, Any]:
    return qlik_request_json(config, f"/api/v1/data-sets/{dataset_id}")


def get_data_file_connections(config: Config) -> Dict[str, str]:
    response = qlik_request_json(config, "/api/v1/data-files/connections?limit=1000")
    return {
        str(item["spaceId"]): str(item["id"])
        for item in response.get("data", [])
        if item.get("spaceId")
    }


def strip_csv_suffix(name: str) -> str:
    return name[:-4] if name.lower().endswith(".csv") else name


def normalize_table_name(name: str) -> str:
    stem = strip_csv_suffix(name)
    stem = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", stem)
    stem = re.sub(r"[^A-Za-z0-9_]+", "_", stem)
    stem = stem.strip("_").lower()
    if not stem:
        raise SyncError(f"Unable to normalize a table name from {name!r}")
    if stem[0].isdigit():
        stem = f"t_{stem}"
    return stem


def normalize_column_name(name: str, seen: set[str]) -> str:
    candidate = re.sub(r"[^A-Za-z0-9_]+", "_", name).strip("_").lower() or "column"
    if candidate[0].isdigit():
        candidate = f"c_{candidate}"
    unique = candidate
    index = 2
    while unique in seen:
        unique = f"{candidate}_{index}"
        index += 1
    seen.add(unique)
    return unique


def qlik_type_to_arrow(data_type: str) -> pa.DataType:
    normalized = (data_type or "").strip().upper()
    if normalized in QLIK_INTEGER_TYPES:
        return pa.int64()
    if normalized in QLIK_FLOAT_TYPES:
        return pa.float64()
    if normalized in QLIK_BOOLEAN_TYPES:
        return pa.bool_()
    if normalized in QLIK_DATE_TYPES:
        return pa.date32()
    if normalized in QLIK_TIMESTAMP_TYPES:
        return pa.timestamp("us")
    if normalized.startswith("DECIMAL"):
        return pa.decimal128(38, 10)
    return pa.string()


def arrow_type_to_athena_type(arrow_type: pa.DataType) -> str:
    if pa.types.is_int64(arrow_type):
        return "bigint"
    if pa.types.is_float64(arrow_type):
        return "double"
    if pa.types.is_boolean(arrow_type):
        return "boolean"
    if pa.types.is_date32(arrow_type):
        return "date"
    if pa.types.is_timestamp(arrow_type):
        return "timestamp"
    if pa.types.is_decimal(arrow_type):
        return f"decimal({arrow_type.precision},{arrow_type.scale})"
    return "string"


def canonical_athena_type(data_type: str) -> str:
    normalized = data_type.strip().lower()
    if normalized in {"string", "varchar", "char"}:
        return "string"
    if normalized in {"int", "integer", "bigint"}:
        return "bigint" if normalized == "bigint" else "integer"
    if normalized in {"float", "real", "double"}:
        return "double" if normalized == "double" else "float"
    return normalized


def extract_qlik_type_name(value: Any) -> str:
    if isinstance(value, dict):
        nested = value.get("type") or value.get("qType")
        if nested:
            return str(nested).strip().upper()
        return "STRING"
    if value is None:
        return "STRING"
    return str(value).strip().upper() or "STRING"


def field_data_type(field: Dict[str, Any]) -> str:
    if "dataType" in field:
        return extract_qlik_type_name(field.get("dataType"))
    if "type" in field:
        return extract_qlik_type_name(field.get("type"))
    return "STRING"


def should_force_string_column(source_name: str, qlik_type: str) -> bool:
    normalized_name = source_name.strip().lower()
    if not normalized_name:
        return False
    # Preserve identifier semantics even when Qlik exposes them as integers.
    return normalized_name.endswith("id") and qlik_type in QLIK_INTEGER_TYPES


def logical_arrow_type(source_name: str, qlik_type: str) -> pa.DataType:
    if should_force_string_column(source_name, qlik_type):
        return pa.string()
    return qlik_type_to_arrow(qlik_type)


def build_dataset_plan(dataset_metadata: Dict[str, Any], connection_by_space: Dict[str, str]) -> DatasetPlan:
    field_defs = ((dataset_metadata.get("schema") or {}).get("dataFields") or [])
    if not field_defs:
        raise SyncError(f"Dataset {dataset_metadata.get('id')} has no schema.dataFields")

    seen: set[str] = set()
    columns: List[ColumnSpec] = []
    arrow_fields: List[pa.Field] = []
    for field_def in field_defs:
        source_name = str(field_def["name"])
        target_name = normalize_column_name(source_name, seen)
        qlik_type = field_data_type(field_def)
        arrow_type = logical_arrow_type(source_name, qlik_type)
        nullable = True
        columns.append(
            ColumnSpec(
                source_name=source_name,
                target_name=target_name,
                qlik_type=qlik_type,
                arrow_type=arrow_type,
                nullable=nullable,
            )
        )
        arrow_fields.append(pa.field(target_name, arrow_type, nullable=nullable))

    row_count = None
    row_count_candidates = (
        dataset_metadata.get("rowCount"),
        (dataset_metadata.get("dataAssetInfo") or {}).get("rowCount"),
        (dataset_metadata.get("properties") or {}).get("rowCount"),
    )
    for candidate in row_count_candidates:
        if isinstance(candidate, int):
            row_count = candidate
            break
        if isinstance(candidate, str) and candidate.isdigit():
            row_count = int(candidate)
            break

    return DatasetPlan(
        dataset_id=str(dataset_metadata["id"]),
        dataset_name=str(dataset_metadata["name"]),
        table_name=normalize_table_name(str(dataset_metadata["name"])),
        source_space_id=dataset_metadata.get("spaceId"),
        connection_id=connection_by_space.get(str(dataset_metadata.get("spaceId"))),
        columns=columns,
        source_row_count=row_count,
        metadata=dataset_metadata,
        normalized_schema=pa.schema(arrow_fields),
    )


def expected_dataset_order(dataset_plans: Sequence[DatasetPlan]) -> List[DatasetPlan]:
    expected_names = list(DEFAULT_EXPECTED_DATASETS)
    indexed = {plan.dataset_name: plan for plan in dataset_plans}
    ordered = [indexed[name] for name in expected_names if name in indexed]
    remaining = [plan for plan in dataset_plans if plan.dataset_name not in expected_names]
    remaining.sort(key=lambda plan: plan.dataset_name)
    return ordered + remaining


def discover_product_datasets(
    config: Config,
    product: Dict[str, Any],
    dataset_id_filter: Optional[str] = None,
    table_name_override: Optional[str] = None,
) -> List[DatasetPlan]:
    dataset_ids = list(product.get("datasetIds") or [])
    if not dataset_ids:
        raise SyncError(f"Data product {product.get('id')} has no datasetIds")

    connection_by_space = get_data_file_connections(config)
    plans: List[DatasetPlan] = []
    for dataset_id in dataset_ids:
        if dataset_id_filter and dataset_id != dataset_id_filter:
            continue
        metadata = get_dataset_metadata(config, dataset_id)
        plan = build_dataset_plan(metadata, connection_by_space)
        if table_name_override:
            plan.table_name = normalize_table_name(table_name_override)
        plans.append(plan)

    if dataset_id_filter and not plans:
        raise SyncError(f"Dataset id {dataset_id_filter} was not found under product {product.get('id')}")

    return expected_dataset_order(plans)


def build_column_lookup(columns: Sequence[ColumnSpec]) -> Dict[str, ColumnSpec]:
    return {column.source_name: column for column in columns}


def parse_datetime_value(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    for candidate in (text, text.replace(" ", "T")):
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo:
                return parsed.astimezone().replace(tzinfo=None)
            return parsed
        except ValueError:
            continue
    return None


def normalize_value(value: Any, column: ColumnSpec) -> Any:
    if value is None or value == "":
        return None

    arrow_type = column.arrow_type
    if pa.types.is_string(arrow_type):
        if isinstance(value, (dict, list)):
            return json.dumps(value, separators=(",", ":"), sort_keys=True)
        return str(value)
    if pa.types.is_int64(arrow_type):
        if isinstance(value, bool):
            return int(value)
        try:
            return int(str(value))
        except (TypeError, ValueError):
            return None
    if pa.types.is_float64(arrow_type):
        try:
            numeric = float(value)
            return None if math.isnan(numeric) else numeric
        except (TypeError, ValueError):
            return None
    if pa.types.is_boolean(arrow_type):
        if isinstance(value, bool):
            return value
        lowered = str(value).strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n"}:
            return False
        return None
    if pa.types.is_date32(arrow_type):
        parsed = parse_datetime_value(value)
        return parsed.date() if parsed else None
    if pa.types.is_timestamp(arrow_type):
        return parse_datetime_value(value)
    if pa.types.is_decimal(arrow_type):
        try:
            return Decimal(str(value))
        except Exception:
            return None
    return value


def normalize_rows(rows: Sequence[Dict[str, Any]], plan: DatasetPlan) -> List[Dict[str, Any]]:
    lookup = build_column_lookup(plan.columns)
    normalized: List[Dict[str, Any]] = []
    for row in rows:
        normalized_row: Dict[str, Any] = {}
        for column in plan.columns:
            normalized_row[column.target_name] = normalize_value(row.get(column.source_name), column)
        extra_keys = set(row) - set(lookup)
        if extra_keys:
            for extra_key in sorted(extra_keys):
                if extra_key in lookup:
                    continue
                normalized_row[normalize_column_name(extra_key, set(normalized_row))] = str(row[extra_key])
        normalized.append(normalized_row)
    return normalized


def rows_to_arrow(rows: Sequence[Dict[str, Any]], plan: DatasetPlan) -> pa.Table:
    normalized_rows = normalize_rows(rows, plan)
    if not normalized_rows:
        arrays = [pa.array([], type=field.type) for field in plan.normalized_schema]
        return pa.Table.from_arrays(arrays, schema=plan.normalized_schema)
    return pa.Table.from_pylist(normalized_rows, schema=plan.normalized_schema)


def write_parquet_batch(table: pa.Table, dataset_name: str, batch_number: int, tmpdir: Path) -> str:
    filename = f"{normalize_table_name(dataset_name)}-batch-{batch_number:05d}.parquet"
    path = tmpdir / filename
    pq.write_table(table, path)
    return str(path)


def create_temp_app(config: Config, space_id: Optional[str]) -> str:
    if not space_id:
        raise SyncError("Cannot create a temp Qlik app without a source space id")
    payload = {
        "attributes": {
            "name": f"codex-sync-{uuid.uuid4().hex[:12]}",
            "spaceId": space_id,
        }
    }
    response = qlik_request_json(config, "/api/v1/apps", method="POST", payload=payload)
    app_id = (((response.get("attributes") or {}).get("id")) or "").strip()
    if not app_id:
        raise SyncError("Qlik temp app creation did not return an app id")
    return app_id


def delete_temp_app(config: Config, app_id: str) -> None:
    try:
        qlik_request(config, f"/api/v1/apps/{app_id}", method="DELETE", accept="application/json")
    except Exception as exc:
        log("temp_app_delete_failed", app_id=app_id, error=str(exc))


def qlik_sql_identifier(identifier: str) -> str:
    return f"[{identifier.replace(']', ']]')}]"


def engine_cell_value(cell: Dict[str, Any]) -> Any:
    if cell.get("qIsNull"):
        return None
    text = cell.get("qText")
    if text not in {None, ""}:
        return text
    num = cell.get("qNum")
    if isinstance(num, (int, float)) and not math.isnan(num):
        return num
    return None


async def extract_dataset_rows_via_engine_async(
    config: Config,
    plan: DatasetPlan,
    app_id: str,
    tmpdir: Path,
) -> Tuple[List[str], int, int]:
    websocket_url = f"wss://{config.qlik_tenant}/app/{app_id}"
    fields = [column.source_name for column in plan.columns]
    select_columns = ", ".join(qlik_sql_identifier(field) for field in fields)
    source_object = f"{qlik_sql_identifier(config.qlik_engine_sql_schema)}.{qlik_sql_identifier(strip_csv_suffix(plan.dataset_name))}"
    script = "\n".join(
        [
            f"LIB CONNECT TO '{config.qlik_engine_connection_name}';",
            "ExtractTable:",
            "LOAD *;",
            f"SQL SELECT {select_columns} FROM {source_object};",
        ]
    )

    async def rpc(ws: Any, request_id: int, handle: int, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = {"jsonrpc": "2.0", "id": request_id, "handle": handle, "method": method}
        if params is not None:
            payload["params"] = params
        await ws.send(json.dumps(payload))
        while True:
            message = json.loads(await ws.recv())
            if message.get("id") != request_id:
                continue
            if "error" in message:
                raise SyncError(f"Qlik engine {method} failed: {json.dumps(message['error'])}")
            return message

    async def fetch_page(
        ws: Any,
        request_id: int,
        object_handle: int,
        top: int,
        height: int,
    ) -> List[List[Dict[str, Any]]]:
        try:
            response = await rpc(
                ws,
                request_id,
                object_handle,
                "GetHyperCubeData",
                {
                    "qPath": "/qHyperCubeDef",
                    "qPages": [
                        {
                            "qTop": top,
                            "qLeft": 0,
                            "qHeight": height,
                            "qWidth": len(fields),
                        }
                    ],
                },
            )
            return response["result"]["qDataPages"][0]["qMatrix"]
        except SyncError as exc:
            if "Result too large" in str(exc) and height > 1:
                reduced_height = max(1, height // 2)
                log(
                    "engine_page_reduce",
                    dataset_id=plan.dataset_id,
                    dataset_name=plan.dataset_name,
                    top=top,
                    previous_height=height,
                    next_height=reduced_height,
                )
                return await fetch_page(ws, request_id + 1000000, object_handle, top, reduced_height)
            raise

    async with websockets.connect(
        websocket_url,
        additional_headers={"Authorization": f"Bearer {config.qlik_api_key}"},
        max_size=None,
    ) as ws:
        doc_handle = (
            await rpc(ws, 1, -1, "OpenDoc", {"qDocName": app_id})
        )["result"]["qReturn"]["qHandle"]
        await rpc(ws, 2, doc_handle, "SetScript", {"qScript": script})
        reload_response = await rpc(
            ws,
            3,
            doc_handle,
            "DoReload",
            {"qMode": 0, "qPartial": False, "qDebug": False},
        )
        if not reload_response["result"].get("qReturn"):
            raise SyncError(f"Qlik engine reload failed for dataset {plan.dataset_name}")

        object_handle = (
            await rpc(
                ws,
                4,
                doc_handle,
                "CreateSessionObject",
                {
                    "qProp": {
                        "qInfo": {"qType": "extract-cube"},
                        "qHyperCubeDef": {
                            "qDimensions": [{"qDef": {"qFieldDefs": [field]}} for field in fields],
                            "qMeasures": [],
                            "qInitialDataFetch": [{"qTop": 0, "qLeft": 0, "qHeight": 1, "qWidth": len(fields)}],
                        },
                    }
                },
            )
        )["result"]["qReturn"]["qHandle"]
        layout = await rpc(ws, 5, object_handle, "GetLayout", {})
        hypercube = layout["result"]["qLayout"]["qHyperCube"]
        row_total = int(hypercube["qSize"]["qcy"])
        page_size = min(max(config.batch_size, 1), DEFAULT_ENGINE_PAGE_SIZE)

        if row_total == 0:
            empty_table = rows_to_arrow([], plan)
            return [write_parquet_batch(empty_table, plan.dataset_name, 0, tmpdir)], 0, 0

        parquet_paths: List[str] = []
        request_id = 6
        batch_number = 0
        extracted_rows = 0

        top = 0
        while top < row_total:
            current_height = min(page_size, row_total - top)
            matrix = await fetch_page(ws, request_id, object_handle, top, current_height)
            request_id += 1
            rows = [
                {
                    fields[index]: engine_cell_value(cell)
                    for index, cell in enumerate(row_cells)
                }
                for row_cells in matrix
            ]
            arrow_table = rows_to_arrow(rows, plan)
            parquet_paths.append(write_parquet_batch(arrow_table, plan.dataset_name, batch_number, tmpdir))
            batch_number += 1
            extracted_rows += len(rows)
            top += len(rows)

        return parquet_paths, extracted_rows, row_total


def extract_dataset_rows_via_engine(
    config: Config,
    plan: DatasetPlan,
    tmpdir: Path,
) -> Tuple[List[str], int, int]:
    app_id = create_temp_app(config, plan.source_space_id)
    log(
        "engine_fallback_start",
        dataset_id=plan.dataset_id,
        dataset_name=plan.dataset_name,
        app_id=app_id,
        connection_name=config.qlik_engine_connection_name,
    )
    try:
        result = asyncio.run(extract_dataset_rows_via_engine_async(config, plan, app_id, tmpdir))
        log(
            "engine_fallback_complete",
            dataset_id=plan.dataset_id,
            dataset_name=plan.dataset_name,
            app_id=app_id,
            extracted_row_count=result[1],
        )
        return result
    finally:
        delete_temp_app(config, app_id)


def should_use_engine_fallback(exc: Exception) -> bool:
    if isinstance(exc, QlikRateLimitError):
        return True
    text = str(exc).lower()
    return (
        "dataset profile is required" in text
        or "-> 424" in text
        or "rate-limited:" in text
    )


def extract_dataset_rows(
    config: Config,
    product_id: str,
    plan: DatasetPlan,
    tmpdir: Path,
) -> Tuple[List[str], int, Optional[int]]:
    if not plan.connection_id:
        raise SyncError(f"No data-files connection found for dataset space {plan.source_space_id}")
    try:
        page_size = min(config.batch_size, 1000)
        next_url = (
            f"{qlik_base_url(config)}/api/data-governance/data-access/data-products/"
            f"{product_id}/datasets/{plan.dataset_id}/connections/{plan.connection_id}"
            f"?$count=true&$top={page_size}"
        )

        row_count = 0
        batch_number = 0
        parquet_paths: List[str] = []
        source_total: Optional[int] = None

        while next_url:
            payload = qlik_request_json_url(config, next_url)
            if source_total is None and payload.get("@odata.count") is not None:
                source_total = int(payload["@odata.count"])
            rows = payload.get("value") or []
            if not rows:
                if row_count == 0:
                    empty_table = rows_to_arrow([], plan)
                    parquet_paths.append(write_parquet_batch(empty_table, plan.dataset_name, batch_number, tmpdir))
                break

            arrow_table = rows_to_arrow(rows, plan)
            parquet_paths.append(write_parquet_batch(arrow_table, plan.dataset_name, batch_number, tmpdir))
            batch_number += 1
            row_count += len(rows)
            next_url = payload.get("@odata.nextLink")

            if source_total is not None and row_count >= source_total:
                break

        return parquet_paths, row_count, source_total
    except Exception as exc:
        log(
            "odata_extract_failed",
            dataset_id=plan.dataset_id,
            dataset_name=plan.dataset_name,
            error=str(exc),
        )
        if should_use_engine_fallback(exc):
            log(
                "odata_extract_switch_to_engine",
                dataset_id=plan.dataset_id,
                dataset_name=plan.dataset_name,
                reason=str(exc),
            )
            return extract_dataset_rows_via_engine(config, plan, tmpdir)
        raise


def resolve_table_bucket_arn(session: boto3.Session, bucket_name_or_arn: str) -> str:
    if bucket_name_or_arn.startswith("arn:aws:s3tables:"):
        return bucket_name_or_arn
    client = session.client("s3tables")
    continuation_token: Optional[str] = None
    while True:
        kwargs: Dict[str, Any] = {}
        if continuation_token:
            kwargs["continuationToken"] = continuation_token
        response = client.list_table_buckets(**kwargs)
        for bucket in response.get("tableBuckets", []):
            if bucket.get("name") == bucket_name_or_arn:
                return str(bucket["arn"])
        continuation_token = response.get("continuationToken")
        if not continuation_token:
            break
    raise SyncError(f"S3 Table bucket {bucket_name_or_arn!r} was not found")


def client_error_code(exc: ClientError) -> str:
    return str(exc.response.get("Error", {}).get("Code", "Unknown"))


def ensure_namespace(client: Any, table_bucket_arn: str, namespace: str, dry_run: bool) -> None:
    try:
        client.get_namespace(tableBucketARN=table_bucket_arn, namespace=namespace)
        log("namespace_ready", namespace=namespace, table_bucket_arn=table_bucket_arn)
        return
    except ClientError as exc:
        if client_error_code(exc) not in {"NotFoundException", "ResourceNotFoundException"}:
            raise

    log("namespace_missing", namespace=namespace, table_bucket_arn=table_bucket_arn)
    if dry_run:
        return
    client.create_namespace(tableBucketARN=table_bucket_arn, namespace=[namespace])
    log("namespace_created", namespace=namespace, table_bucket_arn=table_bucket_arn)


def arrow_type_to_s3tables_type(arrow_type: pa.DataType) -> str:
    if pa.types.is_int64(arrow_type):
        return "long"
    if pa.types.is_float64(arrow_type):
        return "double"
    if pa.types.is_boolean(arrow_type):
        return "boolean"
    if pa.types.is_date32(arrow_type):
        return "date"
    if pa.types.is_timestamp(arrow_type):
        return "timestamp"
    if pa.types.is_decimal(arrow_type):
        return f"decimal({arrow_type.precision},{arrow_type.scale})"
    return "string"


def s3tables_schema_metadata(plan: DatasetPlan) -> Dict[str, Any]:
    return {
        "iceberg": {
            "schema": {
                "fields": [
                    {
                        "name": column.target_name,
                        "type": arrow_type_to_s3tables_type(column.arrow_type),
                        "required": False,
                    }
                    for column in plan.columns
                ]
            }
        }
    }


def ensure_table(
    client: Any,
    table_bucket_arn: str,
    namespace: str,
    plan: DatasetPlan,
    dry_run: bool,
    *,
    replace_existing: bool = False,
) -> None:
    try:
        client.get_table(tableBucketARN=table_bucket_arn, namespace=namespace, name=plan.table_name)
        if replace_existing and not dry_run:
            client.delete_table(tableBucketARN=table_bucket_arn, namespace=namespace, name=plan.table_name)
            log("table_deleted", namespace=namespace, table_name=plan.table_name, dataset_id=plan.dataset_id)
        else:
            log("table_ready", namespace=namespace, table_name=plan.table_name, dataset_id=plan.dataset_id, column_count=len(plan.columns))
            return
    except ClientError as exc:
        if client_error_code(exc) not in {"NotFoundException", "ResourceNotFoundException"}:
            raise

    log("table_missing", namespace=namespace, table_name=plan.table_name, dataset_id=plan.dataset_id, column_count=len(plan.columns))
    if dry_run:
        return
    client.create_table(
        tableBucketARN=table_bucket_arn,
        namespace=namespace,
        name=plan.table_name,
        format="ICEBERG",
        metadata=s3tables_schema_metadata(plan),
    )
    log("table_created", namespace=namespace, table_name=plan.table_name, dataset_id=plan.dataset_id, column_count=len(plan.columns))


def delete_table_if_exists(
    client: Any,
    table_bucket_arn: str,
    namespace: str,
    table_name: str,
) -> None:
    try:
        client.delete_table(tableBucketARN=table_bucket_arn, namespace=namespace, name=table_name)
        log("table_deleted", namespace=namespace, table_name=table_name, table_bucket_arn=table_bucket_arn)
    except ClientError as exc:
        if client_error_code(exc) not in {"NotFoundException", "ResourceNotFoundException"}:
            raise


class S3TablesIcebergCatalog(MetastoreCatalog):
    def __init__(self, name: str, s3tables_client: Any, table_bucket_arn: str, **properties: str):
        super().__init__(name, **properties)
        self._s3tables_client = s3tables_client
        self._table_bucket_arn = table_bucket_arn

    def create_table(self, *args: Any, **kwargs: Any) -> Table:
        raise NotImplementedError

    def register_table(self, identifier: str, metadata_location: str) -> Table:
        raise NotImplementedError

    def drop_table(self, identifier: str) -> None:
        raise NotImplementedError

    def purge_table(self, identifier: str) -> None:
        raise NotImplementedError

    def rename_table(self, from_identifier: str, to_identifier: str) -> Table:
        raise NotImplementedError

    def create_namespace(self, namespace: str, properties: Properties = EMPTY_DICT) -> None:
        raise NotImplementedError

    def drop_namespace(self, namespace: str) -> None:
        raise NotImplementedError

    def list_tables(self, namespace: str) -> List[Identifier]:
        response = self._s3tables_client.list_tables(tableBucketARN=self._table_bucket_arn, namespace=namespace)
        return [(namespace, table["name"]) for table in response.get("tables", [])]

    def list_namespaces(self, namespace: str = ()) -> List[Identifier]:
        response = self._s3tables_client.list_namespaces(tableBucketARN=self._table_bucket_arn)
        return [tuple(item["namespace"]) for item in response.get("namespaces", [])]

    def list_views(self, namespace: str) -> List[Identifier]:
        return []

    def view_exists(self, identifier: str | Identifier) -> bool:
        return False

    def load_namespace_properties(self, namespace: str) -> Properties:
        return {}

    def update_namespace_properties(
        self,
        namespace: str,
        removals: Optional[set[str]] = None,
        updates: Properties = EMPTY_DICT,
    ) -> PropertiesUpdateSummary:
        raise NotImplementedError

    def drop_view(self, identifier: str) -> None:
        raise NotImplementedError

    def _get_table_state(self, identifier: Identifier) -> Dict[str, Any]:
        namespace, table_name = identifier
        response = self._s3tables_client.get_table(tableBucketARN=self._table_bucket_arn, namespace=namespace, name=table_name)
        metadata_response = self._s3tables_client.get_table_metadata_location(tableBucketARN=self._table_bucket_arn, namespace=namespace, name=table_name)
        return {
            "metadata_location": metadata_response.get("metadataLocation") or response.get("metadataLocation") or "",
            "warehouse_location": metadata_response["warehouseLocation"],
            "version_token": metadata_response["versionToken"],
        }

    def load_table(self, identifier: str | Identifier) -> Table:
        identifier_tuple = self.identifier_to_tuple(identifier)
        state = self._get_table_state(identifier_tuple)
        metadata_location = state["metadata_location"]
        if not metadata_location:
            raise NoSuchTableError(f"Table {'.'.join(identifier_tuple)} exists but does not yet have an Iceberg metadata location")
        io_impl = self._load_file_io(properties=self.properties, location=metadata_location)
        metadata = FromInputFile.table_metadata(io_impl.new_input(metadata_location))
        return Table(
            identifier=identifier_tuple,
            metadata=metadata,
            metadata_location=metadata_location,
            io=io_impl,
            catalog=self,
            config={"version_token": state["version_token"]},
        )

    def build_bootstrap_table(self, identifier: Identifier, schema: Schema, warehouse_location: str) -> Table:
        metadata = new_table_metadata(
            schema=schema,
            partition_spec=UNPARTITIONED_PARTITION_SPEC,
            sort_order=UNSORTED_SORT_ORDER,
            location=warehouse_location,
            properties={},
        )
        io_impl = self._load_file_io(properties=self.properties, location=warehouse_location)
        return Table(
            identifier=identifier,
            metadata=metadata,
            metadata_location="",
            io=io_impl,
            catalog=self,
            config={},
        )

    def commit_table(
        self,
        table: Table,
        requirements: Tuple[TableRequirement, ...],
        updates: Tuple[TableUpdate, ...],
    ) -> CommitTableResponse:
        identifier = table.name()
        state = self._get_table_state(identifier)
        current_table = self.load_table(identifier) if state["metadata_location"] else table
        for requirement in requirements:
            requirement.validate(current_table.metadata if current_table else None)
        updated_metadata = self._update_and_stage_table(current_table, identifier, requirements, updates).metadata
        next_version = self._parse_metadata_version(current_table.metadata_location) + 1
        from pyiceberg.table.locations import load_location_provider
        provider = load_location_provider(updated_metadata.location, updated_metadata.properties)
        next_metadata_location = provider.new_table_metadata_file_location(next_version)
        io_impl = self._load_file_io(properties=updated_metadata.properties, location=next_metadata_location)
        ToOutputFile.table_metadata(updated_metadata, io_impl.new_output(next_metadata_location), overwrite=True)
        self._s3tables_client.update_table_metadata_location(
            tableBucketARN=self._table_bucket_arn,
            namespace=identifier[0],
            name=identifier[1],
            versionToken=state["version_token"],
            metadataLocation=next_metadata_location,
        )
        return CommitTableResponse(metadata=updated_metadata, **{"metadata-location": next_metadata_location})


def read_parquet_tables(paths: Sequence[str]) -> pa.Table:
    tables = [pq.read_table(path) for path in paths]
    if not tables:
        raise SyncError("No Parquet staging files were produced")
    return pa.concat_tables(tables)


def load_table_data(
    catalog: S3TablesIcebergCatalog,
    namespace: str,
    plan: DatasetPlan,
    parquet_paths: Sequence[str],
) -> None:
    identifier = (namespace, plan.table_name)
    state = catalog._get_table_state(identifier)  # noqa: SLF001
    try:
        table = catalog.load_table(identifier)
    except NoSuchTableError:
        schema = pyarrow_to_schema(plan.normalized_schema)
        table = catalog.build_bootstrap_table(identifier, schema, state["warehouse_location"])
    table.overwrite(read_parquet_tables(parquet_paths))


def staging_dataset_plan(plan: DatasetPlan, staging_prefix: str) -> DatasetPlan:
    return replace(plan, table_name=f"{staging_prefix}{plan.table_name}")


def merge_keys_for_plan(config: Config, plan: DatasetPlan) -> List[str]:
    keys = config.merge_keys.get(plan.table_name)
    if not keys:
        raise SyncError(
            f"No merge keys configured for table {plan.table_name!r}. "
            "Set MERGE_KEYS_JSON or add an entry to DEFAULT_MERGE_KEYS."
        )
    column_names = {column.target_name for column in plan.columns}
    missing = [key for key in keys if key not in column_names]
    if missing:
        raise SyncError(f"Merge keys {missing} are not present on {plan.table_name}")
    return keys


def quote_ident(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def qualified_table_ref(catalog: str, namespace: str, table_name: str) -> str:
    return ".".join(
        [
            quote_ident(catalog),
            quote_ident(namespace),
            quote_ident(table_name),
        ]
    )


def merge_key_predicate(left_alias: str, right_alias: str, key: str) -> str:
    # Compare keys null-safely so nullable business-key parts still match on reruns.
    left = f"CAST({left_alias}.{quote_ident(key)} AS varchar)"
    right = f"CAST({right_alias}.{quote_ident(key)} AS varchar)"
    return f"coalesce({left}, '__NULL__') = coalesce({right}, '__NULL__')"


def build_merge_sql(
    catalog: str,
    namespace: str,
    target_table: str,
    staging_table: str,
    columns: Sequence[str],
    keys: Sequence[str],
) -> str:
    target_ref = qualified_table_ref(catalog, namespace, target_table)
    staging_ref = qualified_table_ref(catalog, namespace, staging_table)
    on_clause = " AND ".join(
        merge_key_predicate("t", "s", key) for key in keys
    )
    update_assignments = ", ".join(
        f"{quote_ident(col)} = s.{quote_ident(col)}" for col in columns
    )
    insert_columns = ", ".join(quote_ident(col) for col in columns)
    insert_values = ", ".join(f"s.{quote_ident(col)}" for col in columns)
    return "\n".join(
        [
            f"MERGE INTO {target_ref} t",
            f"USING {staging_ref} s",
            f"ON {on_clause}",
            f"WHEN MATCHED THEN UPDATE SET {update_assignments}",
            f"WHEN NOT MATCHED THEN INSERT ({insert_columns}) VALUES ({insert_values})",
        ]
    )


def duplicate_key_summary(rows: Sequence[Tuple[Any, ...]]) -> Tuple[int, int]:
    counts: Dict[Tuple[Any, ...], int] = {}
    for row in rows:
        if any(value in (None, "") for value in row):
            continue
        counts[row] = counts.get(row, 0) + 1
    duplicate_keys = sum(1 for count in counts.values() if count > 1)
    max_rows_per_key = max(counts.values()) if counts else 0
    return duplicate_keys, max_rows_per_key


def parquet_duplicate_key_summary(parquet_paths: Sequence[str], keys: Sequence[str]) -> Tuple[int, int]:
    rows: List[Tuple[Any, ...]] = []
    for path in parquet_paths:
        table = pq.read_table(path, columns=list(keys))
        columns = [table.column(key).to_pylist() for key in keys]
        for index in range(table.num_rows):
            rows.append(tuple(column[index] for column in columns))
    return duplicate_key_summary(rows)


def target_duplicate_key_summary(
    catalog: S3TablesIcebergCatalog,
    namespace: str,
    table_name: str,
    keys: Sequence[str],
) -> Tuple[int, int]:
    table = catalog.load_table((namespace, table_name))
    arrow = table.scan(selected_fields=tuple(keys)).to_arrow()
    columns = [arrow.column(key).to_pylist() for key in keys]
    rows = [tuple(column[index] for column in columns) for index in range(arrow.num_rows)]
    return duplicate_key_summary(rows)


def build_delete_missing_sql(
    catalog: str,
    namespace: str,
    target_table: str,
    staging_table: str,
    keys: Sequence[str],
) -> str:
    # S3 Tables Athena rejects DELETE aliases (`DELETE FROM t AS x`); qualify target cols instead.
    target_ref = qualified_table_ref(catalog, namespace, target_table)
    staging_ref = qualified_table_ref(catalog, namespace, staging_table)
    join_predicate = " AND ".join(
        merge_key_predicate(target_ref, "s", key) for key in keys
    )
    return "\n".join(
        [
            f"DELETE FROM {target_ref}",
            "WHERE NOT EXISTS (",
            f"  SELECT 1 FROM {staging_ref} s",
            f"  WHERE {join_predicate}",
            ")",
        ]
    )


def run_athena_query(
    athena_client: Any,
    config: Config,
    sql: str,
    *,
    label: str,
) -> str:
    log("athena_start", label=label, sql=sql[:500])
    response = athena_client.start_query_execution(
        QueryString=sql,
        QueryExecutionContext={
            "Catalog": config.athena_catalog,
            "Database": config.namespace,
        },
        ResultConfiguration={"OutputLocation": config.athena_output_location},
        WorkGroup=config.athena_workgroup,
    )
    query_id = response["QueryExecutionId"]
    deadline = time.time() + config.athena_timeout_seconds
    while True:
        execution = athena_client.get_query_execution(QueryExecutionId=query_id)
        status = execution["QueryExecution"]["Status"]
        state = status["State"]
        if state == "SUCCEEDED":
            log("athena_succeeded", label=label, query_execution_id=query_id)
            return query_id
        if state in {"FAILED", "CANCELLED"}:
            reason = status.get("StateChangeReason") or state
            raise SyncError(f"Athena query {label} {state}: {reason} (id={query_id})")
        if time.time() >= deadline:
            try:
                athena_client.stop_query_execution(QueryExecutionId=query_id)
            except Exception:
                pass
            raise SyncError(
                f"Athena query {label} timed out after {config.athena_timeout_seconds}s "
                f"(id={query_id})"
            )
        time.sleep(config.athena_poll_seconds)


def athena_table_count(athena_client: Any, config: Config, table_name: str) -> Optional[int]:
    query_id = run_athena_query(
        athena_client,
        config,
        f"SELECT COUNT(*) AS n FROM {qualified_table_ref(config.athena_catalog, config.namespace, table_name)}",
        label=f"count:{table_name}",
    )
    result = athena_client.get_query_results(QueryExecutionId=query_id, MaxResults=2)
    rows = result.get("ResultSet", {}).get("Rows") or []
    if len(rows) < 2:
        return None
    value = rows[1]["Data"][0].get("VarCharValue")
    return int(value) if value is not None else None


def merge_table_data(
    *,
    catalog: S3TablesIcebergCatalog,
    s3tables_client: Any,
    athena_client: Any,
    config: Config,
    table_bucket_arn: str,
    plan: DatasetPlan,
    parquet_paths: Sequence[str],
    dry_run: bool,
) -> List[str]:
    keys = merge_keys_for_plan(config, plan)
    staging_plan = staging_dataset_plan(plan, config.staging_prefix)
    column_names = [column.target_name for column in plan.columns]
    merge_sql = build_merge_sql(
        config.athena_catalog,
        config.namespace,
        plan.table_name,
        staging_plan.table_name,
        column_names,
        keys,
    )
    delete_sql = (
        build_delete_missing_sql(
            config.athena_catalog,
            config.namespace,
            plan.table_name,
            staging_plan.table_name,
            keys,
        )
        if config.merge_delete_missing
        else None
    )

    if dry_run:
        log(
            "merge_dry_run",
            table_name=plan.table_name,
            staging_table=staging_plan.table_name,
            merge_keys=keys,
            merge_sql=merge_sql,
            delete_sql=delete_sql,
        )
        return []

    ensure_table(s3tables_client, table_bucket_arn, config.namespace, plan, dry_run=False)
    ensure_table(
        s3tables_client,
        table_bucket_arn,
        config.namespace,
        staging_plan,
        dry_run=False,
        replace_existing=False,
    )

    source_duplicate_keys, source_max_rows = parquet_duplicate_key_summary(parquet_paths, keys)
    try:
        target_duplicate_keys, target_max_rows = target_duplicate_key_summary(
            catalog,
            config.namespace,
            plan.table_name,
            keys,
        )
    except (ClientError, NoSuchTableError):
        target_duplicate_keys, target_max_rows = 0, 0
    if source_duplicate_keys or target_duplicate_keys:
        raise SyncError(
            "Configured merge key is not unique enough for Athena MERGE on "
            f"{plan.table_name}: source duplicate keys={source_duplicate_keys} "
            f"(max rows per key={source_max_rows}), target duplicate keys={target_duplicate_keys} "
            f"(max rows per key={target_max_rows})"
        )

    load_table_data(catalog, config.namespace, staging_plan, parquet_paths)

    query_ids = [
        run_athena_query(
            athena_client,
            config,
            merge_sql,
            label=f"merge:{plan.table_name}",
        )
    ]
    if delete_sql:
        # Avoid wiping the target when the extract produced zero rows unexpectedly.
        extracted = sum(pq.read_metadata(path).num_rows for path in parquet_paths)
        if extracted > 0:
            query_ids.append(
                run_athena_query(
                    athena_client,
                    config,
                    delete_sql,
                    label=f"delete_missing:{plan.table_name}",
                )
            )
        else:
            log(
                "delete_missing_skipped_empty_extract",
                table_name=plan.table_name,
                staging_table=staging_plan.table_name,
            )
    return query_ids


def should_fallback_merge_to_overwrite(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        ("table" in message and "not found in database" in message)
        or ("insufficient permissions" in message and "glue:updatetable" in message)
    )


def target_row_count(table: Table) -> Optional[int]:
    snapshot = table.current_snapshot()
    if snapshot and snapshot.summary:
        value = snapshot.summary.get(TOTAL_RECORDS)
        if value is not None:
            return int(value)
    return 0


def source_schema_pairs(plan: DatasetPlan) -> List[Tuple[str, str]]:
    return [(column.target_name, arrow_type_to_s3tables_type(column.arrow_type)) for column in plan.columns]


def target_schema_pairs(table: Table) -> List[Tuple[str, str]]:
    return [(field.name, str(field.field_type)) for field in table.schema().fields]


def validate_table(
    catalog: S3TablesIcebergCatalog,
    namespace: str,
    plan: DatasetPlan,
    source_row_count: int,
    *,
    require_exact_count: bool = True,
) -> Tuple[bool, Optional[int], str]:
    table = catalog.load_table((namespace, plan.table_name))
    schema_match = source_schema_pairs(plan) == target_schema_pairs(table)
    table_rows = target_row_count(table)
    if require_exact_count:
        row_match = table_rows == source_row_count
        return schema_match, table_rows, "ok" if schema_match and row_match else "mismatch"
    return schema_match, table_rows, "ok" if schema_match else "schema-mismatch"


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync a Qlik data product into Amazon S3 Tables (Athena MERGE upsert by default)"
    )
    parser.add_argument("--product-id", default=None)
    parser.add_argument("--bucket", default=None)
    parser.add_argument("--namespace", default=None)
    parser.add_argument("--dataset-id")
    parser.add_argument("--table-name")
    parser.add_argument("--write-mode", choices=["merge", "overwrite"], default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def summarize(
    product: Dict[str, Any],
    discovered_count: int,
    dataset_results: Sequence[DatasetResult],
    success: bool,
) -> Dict[str, Any]:
    return {
        "product": {
            "id": product.get("id"),
            "name": product.get("name"),
        },
        "discovered_dataset_count": discovered_count,
        "datasets": [
            {
                "dataset_id": result.dataset_id,
                "dataset_name": result.dataset_name,
                "table_name": result.table_name,
                "target_location": result.target_location,
                "source_row_count": result.source_row_count,
                "extracted_row_count": result.extracted_row_count,
                "target_row_count": result.target_row_count,
                "schema_match": result.schema_match,
                "validation_status": result.validation_status,
                "merge_keys": result.merge_keys,
                "athena_query_ids": result.athena_query_ids,
                "success": result.success,
                "message": result.message,
            }
            for result in dataset_results
        ],
        "success": success,
    }


def run_sync(
    *,
    config: Config,
    product_id: Optional[str] = None,
    bucket: Optional[str] = None,
    namespace: Optional[str] = None,
    dataset_id: Optional[str] = None,
    table_name: Optional[str] = None,
    write_mode: Optional[str] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    product_id = product_id or config.product_id
    bucket = bucket or config.bucket
    namespace = namespace or config.namespace
    write_mode = (write_mode or config.write_mode).strip().lower()
    if write_mode not in {"merge", "overwrite"}:
        raise SyncError("write_mode must be 'merge' or 'overwrite'")
    if write_mode == "merge" and not dry_run and not config.athena_output_location:
        raise SyncError("ATHENA_OUTPUT_LOCATION is required for merge mode")

    # Allow CLI/event overrides without mutating the shared Config unexpectedly.
    config = replace(
        config,
        product_id=product_id,
        bucket=bucket,
        namespace=namespace,
        write_mode=write_mode,
    )

    session = build_session(config)
    s3tables_client = session.client("s3tables")
    athena_client = session.client("athena") if write_mode == "merge" else None

    start_time = time.time()
    product = get_data_product(config, product_id)
    plans = discover_product_datasets(config, product, dataset_id, table_name)

    log(
        "product_discovered",
        product_id=product.get("id"),
        product_name=product.get("name"),
        dataset_count=len(plans),
        write_mode=write_mode,
    )
    table_bucket_arn = resolve_table_bucket_arn(session, bucket)
    log("table_bucket_resolved", bucket=bucket, table_bucket_arn=table_bucket_arn)
    ensure_namespace(s3tables_client, table_bucket_arn, namespace, dry_run)

    catalog = S3TablesIcebergCatalog(
        "s3tables",
        s3tables_client=s3tables_client,
        table_bucket_arn=table_bucket_arn,
        **{AWS_REGION: config.aws_region, PY_IO_IMPL: FSSPEC_FILE_IO},
    )

    dataset_results: List[DatasetResult] = []
    success = True
    with tempfile.TemporaryDirectory(prefix="qlik-s3tables-sync-") as tmpdir_name:
        tmpdir = Path(tmpdir_name)

        for plan in plans:
            target_location = f"s3tables://{bucket}/{namespace}/{plan.table_name}"
            merge_keys = config.merge_keys.get(plan.table_name, [])
            staging_table_name = f"{config.staging_prefix}{plan.table_name}"
            log(
                "dataset_start",
                dataset_id=plan.dataset_id,
                dataset_name=plan.dataset_name,
                table_name=plan.table_name,
                column_count=len(plan.columns),
                source_row_count=plan.source_row_count,
                table_bucket_arn=table_bucket_arn,
                write_mode=write_mode,
                merge_keys=merge_keys,
            )
            try:
                if dry_run:
                    if write_mode == "merge":
                        merge_table_data(
                            catalog=catalog,
                            s3tables_client=s3tables_client,
                            athena_client=athena_client,
                            config=config,
                            table_bucket_arn=table_bucket_arn,
                            plan=plan,
                            parquet_paths=[],
                            dry_run=True,
                        )
                    dataset_results.append(
                        DatasetResult(
                            dataset_id=plan.dataset_id,
                            dataset_name=plan.dataset_name,
                            table_name=plan.table_name,
                            source_row_count=plan.source_row_count,
                            extracted_row_count=0,
                            target_row_count=None,
                            schema_match=False,
                            success=True,
                            validation_status="dry-run",
                            target_location=target_location,
                            merge_keys=merge_keys,
                        )
                    )
                    continue

                parquet_paths, extracted_row_count, discovered_source_row_count = extract_dataset_rows(
                    config,
                    product_id,
                    plan,
                    tmpdir,
                )
                if discovered_source_row_count is not None:
                    plan.source_row_count = discovered_source_row_count

                query_ids: List[str] = []
                if write_mode == "merge":
                    merge_fallback_message: Optional[str] = None
                    try:
                        query_ids = merge_table_data(
                            catalog=catalog,
                            s3tables_client=s3tables_client,
                            athena_client=athena_client,
                            config=config,
                            table_bucket_arn=table_bucket_arn,
                            plan=plan,
                            parquet_paths=parquet_paths,
                            dry_run=False,
                        )
                        # Iceberg merge-on-read can leave snapshot TOTAL_RECORDS stale after
                        # MERGE/DELETE; prefer Athena COUNT when validating merge mode.
                        schema_match, target_rows, validation_status = validate_table(
                            catalog,
                            namespace,
                            plan,
                            extracted_row_count,
                            require_exact_count=False,
                        )
                        live_count = athena_table_count(athena_client, config, plan.table_name)
                        if live_count is not None:
                            target_rows = live_count
                        if config.merge_delete_missing and target_rows != extracted_row_count:
                            validation_status = "mismatch"
                        elif schema_match:
                            validation_status = "ok"
                        else:
                            validation_status = "schema-mismatch"
                    except SyncError as exc:
                        if not config.merge_fallback_to_overwrite or not should_fallback_merge_to_overwrite(exc):
                            raise
                        merge_fallback_message = str(exc)
                        log(
                            "merge_fallback_overwrite",
                            dataset_id=plan.dataset_id,
                            dataset_name=plan.dataset_name,
                            table_name=plan.table_name,
                            reason=merge_fallback_message,
                        )
                        ensure_table(
                            s3tables_client,
                            table_bucket_arn,
                            namespace,
                            plan,
                            dry_run=False,
                            replace_existing=True,
                        )
                        load_table_data(catalog, namespace, plan, parquet_paths)
                        schema_match, target_rows, validation_status = validate_table(
                            catalog,
                            namespace,
                            plan,
                            extracted_row_count,
                            require_exact_count=True,
                        )
                        if validation_status == "ok":
                            validation_status = "overwrite-fallback-ok"
                        else:
                            validation_status = f"overwrite-fallback-{validation_status}"
                else:
                    ensure_table(
                        s3tables_client,
                        table_bucket_arn,
                        namespace,
                        plan,
                        dry_run=False,
                        replace_existing=True,
                    )
                    load_table_data(catalog, namespace, plan, parquet_paths)
                    schema_match, target_rows, validation_status = validate_table(
                        catalog,
                        namespace,
                        plan,
                        extracted_row_count,
                        require_exact_count=True,
                    )

                if plan.source_row_count is not None and extracted_row_count != plan.source_row_count:
                    validation_status = "source-count-mismatch"
                    success = False

                if write_mode == "merge" and not config.merge_delete_missing:
                    dataset_success = schema_match
                else:
                    dataset_success = schema_match and target_rows == extracted_row_count
                success = success and dataset_success
                result = DatasetResult(
                    dataset_id=plan.dataset_id,
                    dataset_name=plan.dataset_name,
                    table_name=plan.table_name,
                    target_location=target_location,
                    source_row_count=plan.source_row_count,
                    extracted_row_count=extracted_row_count,
                    target_row_count=target_rows,
                    schema_match=schema_match,
                    success=dataset_success,
                    validation_status=validation_status,
                    merge_keys=merge_keys,
                    athena_query_ids=query_ids,
                    staged_parquet_paths=list(parquet_paths),
                    message=merge_fallback_message if write_mode == "merge" else None,
                )
                dataset_results.append(result)
                log(
                    "dataset_complete",
                    dataset_id=plan.dataset_id,
                    dataset_name=plan.dataset_name,
                    table_name=plan.table_name,
                    table_bucket_arn=table_bucket_arn,
                    source_row_count=plan.source_row_count,
                    extracted_row_count=extracted_row_count,
                    target_row_count=target_rows,
                    schema_match=schema_match,
                    validation_status=validation_status,
                    write_mode=write_mode,
                    athena_query_ids=query_ids,
                )

                # Free /tmp space between datasets so Lambda ephemeral storage stays bounded.
                for path in parquet_paths:
                    try:
                        Path(path).unlink(missing_ok=True)
                    except OSError:
                        pass
            except Exception as exc:
                success = False
                dataset_results.append(
                    DatasetResult(
                        dataset_id=plan.dataset_id,
                        dataset_name=plan.dataset_name,
                        table_name=plan.table_name,
                        source_row_count=plan.source_row_count,
                        extracted_row_count=0,
                        target_row_count=None,
                        schema_match=False,
                        success=False,
                        validation_status="error",
                        target_location=target_location,
                        message=str(exc),
                        merge_keys=merge_keys,
                    )
                )
                log(
                    "dataset_error",
                    dataset_id=plan.dataset_id,
                    dataset_name=plan.dataset_name,
                    table_name=plan.table_name,
                    error=str(exc),
                )
            finally:
                if write_mode == "merge" and not dry_run:
                    try:
                        delete_table_if_exists(
                            s3tables_client,
                            table_bucket_arn,
                            namespace,
                            staging_table_name,
                        )
                    except Exception as exc:
                        log(
                            "staging_table_cleanup_failed",
                            dataset_id=plan.dataset_id,
                            dataset_name=plan.dataset_name,
                            table_name=plan.table_name,
                            staging_table_name=staging_table_name,
                            error=str(exc),
                        )

    summary = summarize(product, len(plans), dataset_results, success)
    summary["duration_seconds"] = round(time.time() - start_time, 2)
    summary["write_mode"] = write_mode
    summary["bucket"] = bucket
    summary["namespace"] = namespace
    return summary


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    config = load_config()
    summary = run_sync(
        config=config,
        product_id=args.product_id,
        bucket=args.bucket,
        namespace=args.namespace,
        dataset_id=args.dataset_id,
        table_name=args.table_name,
        write_mode=args.write_mode,
        dry_run=args.dry_run,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary.get("success") else 1


def lambda_handler(event: Optional[Dict[str, Any]], context: Any) -> Dict[str, Any]:
    """AWS Lambda entrypoint.

    Optional event overrides (all optional):
      product_id, bucket, namespace, dataset_id, table_name, write_mode, dry_run
    """
    event = event or {}
    config = load_config()
    summary = run_sync(
        config=config,
        product_id=event.get("product_id"),
        bucket=event.get("bucket"),
        namespace=event.get("namespace"),
        dataset_id=event.get("dataset_id"),
        table_name=event.get("table_name"),
        write_mode=event.get("write_mode"),
        dry_run=bool(event.get("dry_run", False)),
    )
    log("lambda_complete", success=summary.get("success"), duration_seconds=summary.get("duration_seconds"))
    if not summary.get("success"):
        # Surface failure to Lambda metrics/alarms while still returning the summary body.
        raise SyncError(json.dumps({"success": False, "summary": summary}))
    return summary


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as exc:
        print(json.dumps({"success": False, "error": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
