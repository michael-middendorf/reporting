#!/usr/bin/env python3
"""Bootstrap shared AWS resources for unified AMU reporting."""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

import boto3
from botocore.exceptions import ClientError

AWS_REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
ACCOUNT = None
STATE_FILE = Path(__file__).resolve().parent / "deploy_state.json"
FRONTEND_BUCKET = os.getenv("FRONTEND_BUCKET", "amu-reporting-frontend-us-east-2")
DATA_BUCKET = os.getenv("DATA_BUCKET", "amu-reporting-data-us-east-2")
API_FUNCTION_NAME = os.getenv("API_FUNCTION_NAME", "amu-reporting-api")
API_ROLE_NAME = os.getenv("API_ROLE_NAME", "amu-reporting-api-role")
OIDC_ROLE_NAME = os.getenv("OIDC_ROLE_NAME", "amu-reporting-github-deploy")
GITHUB_REPO = os.getenv("GITHUB_REPO", "colecantu904/reporting")

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


def account_id() -> str:
    global ACCOUNT
    if ACCOUNT:
        return ACCOUNT
    ACCOUNT = session().client("sts").get_caller_identity()["Account"]
    return ACCOUNT


def load_state() -> Dict[str, Any]:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: Dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"state_file": str(STATE_FILE), "status": "written"}))


def ensure_bucket(name: str) -> None:
    client = session().client("s3", region_name=AWS_REGION)
    try:
        client.head_bucket(Bucket=name)
        print(json.dumps({"bucket": name, "status": "exists"}))
    except ClientError:
        params: Dict[str, Any] = {"Bucket": name}
        if AWS_REGION != "us-east-1":
            params["CreateBucketConfiguration"] = {"LocationConstraint": AWS_REGION}
        client.create_bucket(**params)
        print(json.dumps({"bucket": name, "status": "created"}))
    client.put_public_access_block(
        Bucket=name,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )
    client.put_bucket_ownership_controls(
        Bucket=name,
        OwnershipControls={"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
    )


def ensure_secret(secret_id: str, placeholder: str) -> None:
    client = session().client("secretsmanager", region_name=AWS_REGION)
    try:
        client.describe_secret(SecretId=secret_id)
        print(json.dumps({"secret": secret_id, "status": "exists"}))
    except ClientError:
        client.create_secret(Name=secret_id, SecretString=placeholder)
        print(json.dumps({"secret": secret_id, "status": "created", "note": "update value in console"}))


def ensure_api_role() -> str:
    iam = session().client("iam")
    role_arn = f"arn:aws:iam::{account_id()}:role/{API_ROLE_NAME}"
    trust = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }
        ],
    }
    try:
        iam.get_role(RoleName=API_ROLE_NAME)
        print(json.dumps({"role": API_ROLE_NAME, "status": "exists"}))
    except ClientError:
        iam.create_role(
            RoleName=API_ROLE_NAME,
            AssumeRolePolicyDocument=json.dumps(trust),
            Description="AMU unified reporting API Lambda",
        )
        print(json.dumps({"role": API_ROLE_NAME, "status": "created"}))
        time.sleep(8)

    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                "Resource": "arn:aws:logs:*:*:*",
            },
            {
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:ListBucket"],
                "Resource": [
                    f"arn:aws:s3:::{DATA_BUCKET}",
                    f"arn:aws:s3:::{DATA_BUCKET}/*",
                    "arn:aws:s3:::amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
                    "arn:aws:s3:::amu-enrollment-pipeline-slate-dashboard-cache-us-east-2/*",
                    "arn:aws:s3:::mas-report-report-905418447941-us-east-2",
                    "arn:aws:s3:::mas-report-report-905418447941-us-east-2/*",
                    "arn:aws:s3:::mas-report-cache-905418447941-us-east-2",
                    "arn:aws:s3:::mas-report-cache-905418447941-us-east-2/*",
                ],
            },
            {
                "Effect": "Allow",
                "Action": ["secretsmanager:GetSecretValue"],
                "Resource": f"arn:aws:secretsmanager:{AWS_REGION}:{account_id()}:secret:amu-reporting/*",
            },
        ],
    }
    iam.put_role_policy(
        RoleName=API_ROLE_NAME,
        PolicyName="amu-reporting-api-inline",
        PolicyDocument=json.dumps(policy),
    )
    return role_arn


def ensure_oidc_deploy_role() -> Optional[str]:
    """GitHub Actions OIDC deploy role (optional bootstrap)."""
    iam = session().client("iam")
    oidc_arn = f"arn:aws:iam::{account_id()}:oidc-provider/token.actions.githubusercontent.com"
    try:
        iam.get_open_id_connect_provider(OpenIDConnectProviderArn=oidc_arn)
    except ClientError:
        print(json.dumps({
            "oidc": "missing",
            "hint": "Create GitHub OIDC provider in IAM, then re-run",
        }))
        return None

    trust = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Federated": oidc_arn},
                "Action": "sts:AssumeRoleWithWebIdentity",
                "Condition": {
                    "StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                    },
                    "StringLike": {
                        "token.actions.githubusercontent.com:sub": f"repo:{GITHUB_REPO}:*",
                    },
                },
            }
        ],
    }
    try:
        iam.get_role(RoleName=OIDC_ROLE_NAME)
        iam.update_assume_role_policy(RoleName=OIDC_ROLE_NAME, PolicyDocument=json.dumps(trust))
        print(json.dumps({"oidc_role": OIDC_ROLE_NAME, "status": "updated"}))
    except ClientError:
        iam.create_role(
            RoleName=OIDC_ROLE_NAME,
            AssumeRolePolicyDocument=json.dumps(trust),
            Description="GitHub Actions deploy for amu reporting",
        )
        print(json.dumps({"oidc_role": OIDC_ROLE_NAME, "status": "created"}))

    # Broad deploy permissions for bootstrap; tighten later if desired
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "s3:*",
                    "lambda:*",
                    "cloudfront:*",
                    "iam:PassRole",
                    "iam:GetRole",
                    "events:*",
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret",
                    "logs:*",
                ],
                "Resource": "*",
            }
        ],
    }
    iam.put_role_policy(
        RoleName=OIDC_ROLE_NAME,
        PolicyName="amu-reporting-deploy-inline",
        PolicyDocument=json.dumps(policy),
    )
    return f"arn:aws:iam::{account_id()}:role/{OIDC_ROLE_NAME}"


def main() -> None:
    state = load_state()
    ensure_bucket(FRONTEND_BUCKET)
    ensure_bucket(DATA_BUCKET)
    ensure_secret("amu-reporting/auth-secret", "CHANGE_ME_AUTH_SECRET")
    ensure_secret("amu-reporting/resend-api-key", "CHANGE_ME_RESEND")
    ensure_secret("amu-reporting/virtuous-api-key", "CHANGE_ME_VIRTUOUS")
    role_arn = ensure_api_role()
    oidc_arn = ensure_oidc_deploy_role()
    state.update(
        {
            "region": AWS_REGION,
            "account": account_id(),
            "frontend_bucket": FRONTEND_BUCKET,
            "data_bucket": DATA_BUCKET,
            "api_function_name": API_FUNCTION_NAME,
            "api_role_arn": role_arn,
            "oidc_role_arn": oidc_arn,
            "github_repo": GITHUB_REPO,
        }
    )
    save_state(state)
    print(json.dumps({"bootstrap": "ok", "next": "python infra/deploy_api.py && python infra/deploy_frontend.py"}))


if __name__ == "__main__":
    main()
