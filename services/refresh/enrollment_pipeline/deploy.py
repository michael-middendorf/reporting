#!/usr/bin/env python3
"""Deploy the cached Slate dashboard Lambda, S3 cache bucket, and refresh schedule."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError


AWS_REGION = "us-east-2"
FUNCTION_NAME = "enrollment-pipeline-slate-dashboard-cache"
ROLE_NAME = "enrollment-pipeline-slate-dashboard-cache-role"
POLICY_NAME = "enrollment-pipeline-slate-dashboard-cache-s3"
BUCKET_NAME = "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2"
CACHE_KEY = "dashboard/slate-report-cache.json"
EVENT_RULE_NAME = "enrollment-pipeline-slate-dashboard-cache-refresh-15min"
EVENT_RULE_DESCRIPTION = "Refresh cached Slate dashboard data every 15 minutes"
EVENT_SCHEDULE_EXPRESSION = "rate(15 minutes)"
LAMBDA_PERMISSION_STATEMENT_ID = "AllowEventBridgeRefreshInvoke"
RUNTIME = "python3.12"
HANDLER = "slate_dashboard_cache_lambda.lambda_handler"
TIMEOUT_SECONDS = 900
MEMORY_SIZE = 1024
BUILD_DIR = Path(".build")
PACKAGE_DIR = BUILD_DIR / "package"
ZIP_PATH = BUILD_DIR / "lambda.zip"
REPO_DIR = Path(__file__).resolve().parent
_SESSION = None


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def session() -> boto3.Session:
    global _SESSION
    if _SESSION is not None:
        return _SESSION

    default_session = boto3.Session(region_name=AWS_REGION)
    credentials = default_session.get_credentials()
    if credentials and credentials.access_key:
        _SESSION = default_session
        return _SESSION

    exported = subprocess.run(
        ["aws", "configure", "export-credentials", "--format", "process"],
        check=True,
        capture_output=True,
        text=True,
    )
    exported_credentials = json.loads(exported.stdout)
    _SESSION = boto3.Session(
        aws_access_key_id=exported_credentials["AccessKeyId"],
        aws_secret_access_key=exported_credentials["SecretAccessKey"],
        aws_session_token=exported_credentials.get("SessionToken"),
        region_name=AWS_REGION,
    )
    return _SESSION


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def iam_client() -> Any:
    return session().client("iam", region_name=AWS_REGION)


def lambda_client() -> Any:
    return session().client("lambda", region_name=AWS_REGION)


def s3_client() -> Any:
    return session().client("s3", region_name=AWS_REGION)


def events_client() -> Any:
    return session().client("events", region_name=AWS_REGION)


def account_id() -> str:
    sts = session().client("sts", region_name=AWS_REGION)
    return sts.get_caller_identity()["Account"]


def ensure_bucket() -> None:
    client = s3_client()
    try:
        client.head_bucket(Bucket=BUCKET_NAME)
        print(json.dumps({"bucket": BUCKET_NAME, "status": "exists"}))
        return
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code")
        if error_code not in {"404", "400", "403"}:
            raise

    client.create_bucket(
        Bucket=BUCKET_NAME,
        CreateBucketConfiguration={"LocationConstraint": AWS_REGION},
    )
    print(json.dumps({"bucket": BUCKET_NAME, "status": "created"}))


def ensure_role() -> str:
    client = iam_client()
    assume_role_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }
        ],
    }
    role_arn: str
    try:
        role_arn = client.get_role(RoleName=ROLE_NAME)["Role"]["Arn"]
        print(json.dumps({"role": ROLE_NAME, "status": "exists"}))
    except client.exceptions.NoSuchEntityException:
        role_arn = client.create_role(
            RoleName=ROLE_NAME,
            AssumeRolePolicyDocument=json.dumps(assume_role_policy),
            Description="Execution role for cached Slate dashboard Lambda",
        )["Role"]["Arn"]
        print(json.dumps({"role": ROLE_NAME, "status": "created"}))

    client.attach_role_policy(
        RoleName=ROLE_NAME,
        PolicyArn="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    )

    bucket_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["s3:ListBucket"],
                "Resource": [f"arn:aws:s3:::{BUCKET_NAME}"],
            },
            {
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:PutObject"],
                "Resource": [f"arn:aws:s3:::{BUCKET_NAME}/*"],
            },
        ],
    }
    client.put_role_policy(
        RoleName=ROLE_NAME,
        PolicyName=POLICY_NAME,
        PolicyDocument=json.dumps(bucket_policy),
    )

    # IAM propagation for fresh roles.
    time.sleep(10)
    return role_arn


def build_zip() -> None:
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    PACKAGE_DIR.mkdir(parents=True)

    shutil.copy2(REPO_DIR / "slate_dashboard_cache_lambda.py", PACKAGE_DIR / "slate_dashboard_cache_lambda.py")
    shutil.copy2(REPO_DIR / "real-query-links.json", PACKAGE_DIR / "real-query-links.json")

    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(PACKAGE_DIR.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(PACKAGE_DIR))

    print(json.dumps({"zip_path": str(ZIP_PATH), "status": "built"}))


def function_exists() -> bool:
    client = lambda_client()
    try:
        client.get_function(FunctionName=FUNCTION_NAME)
        return True
    except client.exceptions.ResourceNotFoundException:
        return False


def deploy_lambda(role_arn: str) -> None:
    client = lambda_client()
    env = {
        "CACHE_BUCKET": BUCKET_NAME,
        "CACHE_KEY": CACHE_KEY,
        "QUERY_LINKS_FILE": "real-query-links.json",
        "FETCH_TIMEOUT_SECONDS": os.getenv("FETCH_TIMEOUT_SECONDS", "900"),
        "MAX_INLINE_RESPONSE_BYTES": os.getenv("MAX_INLINE_RESPONSE_BYTES", "5500000"),
        "PRESIGN_EXPIRATION_SECONDS": os.getenv("PRESIGN_EXPIRATION_SECONDS", "3600"),
    }
    zip_bytes = ZIP_PATH.read_bytes()

    if function_exists():
        client.update_function_code(FunctionName=FUNCTION_NAME, ZipFile=zip_bytes, Publish=False)
        waiter = client.get_waiter("function_updated")
        waiter.wait(FunctionName=FUNCTION_NAME)
        client.update_function_configuration(
            FunctionName=FUNCTION_NAME,
            Role=role_arn,
            Handler=HANDLER,
            Runtime=RUNTIME,
            Timeout=TIMEOUT_SECONDS,
            MemorySize=MEMORY_SIZE,
            Environment={"Variables": env},
        )
        waiter.wait(FunctionName=FUNCTION_NAME)
        client.put_function_concurrency(FunctionName=FUNCTION_NAME, ReservedConcurrentExecutions=1)
        print(json.dumps({"function": FUNCTION_NAME, "status": "updated"}))
    else:
        client.create_function(
            FunctionName=FUNCTION_NAME,
            Role=role_arn,
            Runtime=RUNTIME,
            Handler=HANDLER,
            Code={"ZipFile": zip_bytes},
            Timeout=TIMEOUT_SECONDS,
            MemorySize=MEMORY_SIZE,
            Publish=False,
            Environment={"Variables": env},
            Description="Cached Slate dashboard Lambda backed by S3 JSON cache",
        )
        waiter = client.get_waiter("function_active_v2")
        waiter.wait(FunctionName=FUNCTION_NAME)
        client.put_function_concurrency(FunctionName=FUNCTION_NAME, ReservedConcurrentExecutions=1)
        print(json.dumps({"function": FUNCTION_NAME, "status": "created"}))


def ensure_eventbridge_schedule() -> None:
    events = events_client()
    lambda_api = lambda_client()
    function_arn = lambda_api.get_function(FunctionName=FUNCTION_NAME)["Configuration"]["FunctionArn"]

    rule_arn = events.put_rule(
        Name=EVENT_RULE_NAME,
        ScheduleExpression=EVENT_SCHEDULE_EXPRESSION,
        State="ENABLED",
        Description=EVENT_RULE_DESCRIPTION,
    )["RuleArn"]

    try:
        lambda_api.add_permission(
            FunctionName=FUNCTION_NAME,
            StatementId=LAMBDA_PERMISSION_STATEMENT_ID,
            Action="lambda:InvokeFunction",
            Principal="events.amazonaws.com",
            SourceArn=rule_arn,
        )
    except lambda_api.exceptions.ResourceConflictException:
        pass

    events.put_targets(
        Rule=EVENT_RULE_NAME,
        Targets=[
            {
                "Id": "refresh",
                "Arn": function_arn,
                "Input": json.dumps({"mode": "refresh"}),
            }
        ],
    )
    print(json.dumps({"event_rule": EVENT_RULE_NAME, "status": "configured"}))


def verify_deployment() -> Dict[str, Any]:
    client = lambda_client()
    response = client.get_function(FunctionName=FUNCTION_NAME)
    config = response["Configuration"]
    return {
        "function_name": config["FunctionName"],
        "function_arn": config["FunctionArn"],
        "runtime": config["Runtime"],
        "handler": config["Handler"],
        "timeout": config["Timeout"],
        "memory_size": config["MemorySize"],
        "bucket": BUCKET_NAME,
        "cache_key": CACHE_KEY,
        "event_rule": EVENT_RULE_NAME,
        "aws_region": AWS_REGION,
        "account_id": account_id(),
    }


def main() -> int:
    ensure_bucket()
    role_arn = ensure_role()
    build_zip()
    deploy_lambda(role_arn)
    ensure_eventbridge_schedule()
    print(json.dumps(verify_deployment(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
