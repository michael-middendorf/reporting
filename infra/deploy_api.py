#!/usr/bin/env python3
"""Package and deploy the unified reporting API Lambda + Function URL + daily magic links."""

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

AWS_REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
FUNCTION_NAME = os.getenv("API_FUNCTION_NAME", "amu-reporting-api")
ROLE_NAME = os.getenv("API_ROLE_NAME", "amu-reporting-api-role")
RUNTIME = "python3.12"
HANDLER = "reporting_api.handler.lambda_handler"
TIMEOUT = int(os.getenv("API_TIMEOUT", "120"))
MEMORY = int(os.getenv("API_MEMORY", "1024"))
REPO = Path(__file__).resolve().parent.parent
API_DIR = REPO / "services" / "api"
BUILD = REPO / ".build" / "api"
ZIP_PATH = BUILD / "api.zip"
STATE_FILE = Path(__file__).resolve().parent / "deploy_state.json"
EVENT_RULE = "amu-reporting-api-daily-magic-links"

_SESSION = None


def session() -> boto3.Session:
    global _SESSION
    if _SESSION is not None:
        return _SESSION
    default = boto3.Session(region_name=AWS_REGION)
    creds = default.get_credentials()
    if creds and creds.access_key:
        _SESSION = default
        return _SESSION
    exported = subprocess.run(
        ["aws", "configure", "export-credentials", "--format", "process"],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(exported.stdout)
    _SESSION = boto3.Session(
        aws_access_key_id=payload["AccessKeyId"],
        aws_secret_access_key=payload["SecretAccessKey"],
        aws_session_token=payload.get("SessionToken"),
        region_name=AWS_REGION,
    )
    return _SESSION


def load_state() -> Dict[str, Any]:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: Dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def package() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    pkg = BUILD / "package"
    pkg.mkdir(parents=True)
    shutil.copytree(API_DIR / "reporting_api", pkg / "reporting_api")
    req = API_DIR / "requirements.txt"
    if req.exists():
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", str(req), "-t", str(pkg), "--quiet"],
            check=True,
        )
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in pkg.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(pkg).as_posix())
    print(json.dumps({"zip": str(ZIP_PATH), "bytes": ZIP_PATH.stat().st_size}))


def env_vars() -> Dict[str, str]:
    state = load_state()
    return {
        "AUTH_SECRET": os.getenv("AUTH_SECRET", ""),
        "RESEND_API_KEY": os.getenv("RESEND_API_KEY", ""),
        "APP_BASE_URL": os.getenv("APP_BASE_URL", state.get("app_base_url", "")),
        "ALLOWED_EMAILS": os.getenv(
            "ALLOWED_EMAILS",
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu",
        ),
        "DATA_BUCKET": os.getenv("DATA_BUCKET", state.get("data_bucket", "amu-reporting-data-us-east-2")),
        "ENROLLMENT_CACHE_BUCKET": os.getenv(
            "ENROLLMENT_CACHE_BUCKET",
            "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
        ),
        "CACHE_BUCKET": os.getenv(
            "CACHE_BUCKET",
            "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
        ),
        "CACHE_KEY": "dashboard/slate-report-cache.json",
        "AWS_REGION": AWS_REGION,
        "QLIK_API_KEY": os.getenv("QLIK_API_KEY", ""),
        "QLIK_TENANT": os.getenv("QLIK_TENANT", ""),
        "SLATE_QUERY_URL": os.getenv("SLATE_QUERY_URL", ""),
        "SLATE_DEPOSITS_URL": os.getenv("SLATE_DEPOSITS_URL", ""),
        "SITE_URL": os.getenv("SITE_URL", "https://avemaria.erezlife.com/"),
        "API_KEY": os.getenv("API_KEY", os.getenv("EREZLIFE_API_KEY", "")),
        "TARGET_SESSION": os.getenv("TARGET_SESSION", "2026FALL01"),
        "DATA_DIR": "/tmp",
    }


def deploy_lambda(role_arn: str) -> str:
    client = session().client("lambda", region_name=AWS_REGION)
    zip_bytes = ZIP_PATH.read_bytes()
    # Drop empty secrets from env so we don't overwrite with blanks unintentionally
    variables = {k: v for k, v in env_vars().items() if v}

    try:
        client.get_function(FunctionName=FUNCTION_NAME)
        client.update_function_code(FunctionName=FUNCTION_NAME, ZipFile=zip_bytes)
        waiter = client.get_waiter("function_updated")
        waiter.wait(FunctionName=FUNCTION_NAME)
        # Merge env with existing so secrets aren't wiped if not in local env
        conf = client.get_function_configuration(FunctionName=FUNCTION_NAME)
        existing = dict((conf.get("Environment") or {}).get("Variables") or {})
        existing.update(variables)
        client.update_function_configuration(
            FunctionName=FUNCTION_NAME,
            Runtime=RUNTIME,
            Handler=HANDLER,
            Role=role_arn,
            Timeout=TIMEOUT,
            MemorySize=MEMORY,
            Environment={"Variables": existing},
        )
        print(json.dumps({"lambda": FUNCTION_NAME, "status": "updated"}))
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ResourceNotFoundException":
            raise
        if not variables.get("AUTH_SECRET"):
            raise SystemExit("AUTH_SECRET required for first deploy")
        client.create_function(
            FunctionName=FUNCTION_NAME,
            Runtime=RUNTIME,
            Role=role_arn,
            Handler=HANDLER,
            Code={"ZipFile": zip_bytes},
            Timeout=TIMEOUT,
            MemorySize=MEMORY,
            Environment={"Variables": variables},
            Description="AMU unified reporting API",
        )
        print(json.dumps({"lambda": FUNCTION_NAME, "status": "created"}))
        time.sleep(5)

    # Function URL
    try:
        url_conf = client.get_function_url_config(FunctionName=FUNCTION_NAME)
        url = url_conf["FunctionUrl"].rstrip("/")
    except ClientError:
        app_base = variables.get("APP_BASE_URL") or "http://127.0.0.1:5173"
        resp = client.create_function_url_config(
            FunctionName=FUNCTION_NAME,
            AuthType="NONE",
            Cors={
                "AllowCredentials": True,
                "AllowHeaders": ["content-type", "authorization"],
                "AllowMethods": ["*"],
                "AllowOrigins": [
                    app_base,
                    "http://127.0.0.1:5173",
                    "http://localhost:5173",
                ],
                "MaxAge": 86400,
            },
        )
        url = resp["FunctionUrl"].rstrip("/")
        try:
            client.add_permission(
                FunctionName=FUNCTION_NAME,
                StatementId="FunctionURLAllowPublicAccess",
                Action="lambda:InvokeFunctionUrl",
                Principal="*",
                FunctionUrlAuthType="NONE",
            )
        except ClientError:
            pass
        print(json.dumps({"function_url": url, "status": "created"}))
    return url


def ensure_daily_schedule() -> None:
    events = session().client("events", region_name=AWS_REGION)
    lam = session().client("lambda", region_name=AWS_REGION)
    expr = os.getenv("EVENT_SCHEDULE_EXPRESSION", "cron(0 12 * * ? *)")
    fn_arn = lam.get_function(FunctionName=FUNCTION_NAME)["Configuration"]["FunctionArn"]
    events.put_rule(
        Name=EVENT_RULE,
        ScheduleExpression=expr,
        State="ENABLED",
        Description="Daily AMU reporting magic-link blast",
    )
    events.put_targets(
        Rule=EVENT_RULE,
        Targets=[{"Id": "1", "Arn": fn_arn, "Input": json.dumps({"mode": "send_daily_links"})}],
    )
    try:
        lam.add_permission(
            FunctionName=FUNCTION_NAME,
            StatementId="AllowEventBridgeDailyMagic",
            Action="lambda:InvokeFunction",
            Principal="events.amazonaws.com",
            SourceArn=f"arn:aws:events:{AWS_REGION}:{session().client('sts').get_caller_identity()['Account']}:rule/{EVENT_RULE}",
        )
    except ClientError:
        pass
    print(json.dumps({"event_rule": EVENT_RULE, "schedule": expr}))


def main() -> None:
    state = load_state()
    role_arn = state.get("api_role_arn") or os.getenv("API_ROLE_ARN")
    if not role_arn:
        account = session().client("sts").get_caller_identity()["Account"]
        role_arn = f"arn:aws:iam::{account}:role/{ROLE_NAME}"
    package()
    url = deploy_lambda(role_arn)
    ensure_daily_schedule()
    state["api_function_url"] = url
    state["api_function_name"] = FUNCTION_NAME
    save_state(state)
    print(json.dumps({"deploy_api": "ok", "function_url": url}))


if __name__ == "__main__":
    main()
