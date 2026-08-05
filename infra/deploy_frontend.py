#!/usr/bin/env python3
"""Build and deploy the Vite SPA to S3 + CloudFront (API origin for /api/*)."""

from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

import boto3
from botocore.exceptions import ClientError

AWS_REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-2"
BUCKET_NAME = os.getenv("FRONTEND_BUCKET", "amu-reporting-frontend-us-east-2")
API_FUNCTION_NAME = os.getenv("API_FUNCTION_NAME", "amu-reporting-api")
STATE_FILE = Path(__file__).resolve().parent / "deploy_state.json"
REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps" / "web"
DIST = WEB / "dist"
COMMENT = "AMU unified reporting SPA"

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


def build_web() -> None:
    subprocess.run(["npm", "ci"], cwd=WEB, check=True)
    subprocess.run(["npm", "run", "build"], cwd=WEB, check=True)
    if not (DIST / "index.html").exists():
        raise SystemExit("Vite build missing dist/index.html")


def upload_dist() -> None:
    s3 = session().client("s3", region_name=AWS_REGION)
    for path in DIST.rglob("*"):
        if not path.is_file():
            continue
        key = path.relative_to(DIST).as_posix()
        ctype, _ = mimetypes.guess_type(str(path))
        if key.endswith(".html"):
            ctype = "text/html; charset=utf-8"
            cache = "no-cache"
        elif key.startswith("assets/"):
            cache = "public, max-age=31536000, immutable"
        else:
            cache = "no-cache"
        extra = {"ContentType": ctype or "application/octet-stream", "CacheControl": cache}
        s3.upload_file(str(path), BUCKET_NAME, key, ExtraArgs=extra)
    print(json.dumps({"uploaded": "dist", "bucket": BUCKET_NAME}))


def get_function_url() -> str:
    conf = session().client("lambda", region_name=AWS_REGION).get_function_url_config(
        FunctionName=API_FUNCTION_NAME
    )
    return conf["FunctionUrl"].rstrip("/")


def ensure_oac(state: Dict[str, Any]) -> str:
    client = session().client("cloudfront", region_name="us-east-1")
    existing_id = state.get("oac_id")
    if existing_id:
        try:
            client.get_origin_access_control(Id=existing_id)
            return existing_id
        except ClientError:
            pass
    resp = client.create_origin_access_control(
        OriginAccessControlConfig={
            "Name": f"{BUCKET_NAME}-oac",
            "Description": "OAC for AMU reporting frontend",
            "SigningProtocol": "sigv4",
            "SigningBehavior": "always",
            "OriginAccessControlOriginType": "s3",
        }
    )
    return resp["OriginAccessControl"]["Id"]


def put_bucket_policy(oac_id: str, distribution_arn: Optional[str] = None) -> None:
    if distribution_arn:
        source_arn = distribution_arn
    else:
        account = session().client("sts").get_caller_identity()["Account"]
        source_arn = f"arn:aws:cloudfront::{account}:distribution/*"
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AllowCloudFrontServicePrincipalRead",
                "Effect": "Allow",
                "Principal": {"Service": "cloudfront.amazonaws.com"},
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{BUCKET_NAME}/*",
                "Condition": {"StringEquals": {"AWS:SourceArn": source_arn}},
            }
        ],
    }
    session().client("s3").put_bucket_policy(Bucket=BUCKET_NAME, Policy=json.dumps(policy))


def distribution_config(oac_id: str, function_url: str) -> Dict[str, Any]:
    api_domain = function_url.replace("https://", "").replace("http://", "").split("/")[0]
    s3_domain = f"{BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com"
    return {
        "CallerReference": f"amu-reporting-{int(time.time())}",
        "Comment": COMMENT,
        "Enabled": True,
        "DefaultRootObject": "index.html",
        "Origins": {
            "Quantity": 2,
            "Items": [
                {
                    "Id": "s3-frontend",
                    "DomainName": s3_domain,
                    "OriginPath": "",
                    "S3OriginConfig": {"OriginAccessIdentity": ""},
                    "OriginAccessControlId": oac_id,
                    "CustomHeaders": {"Quantity": 0},
                    "ConnectionAttempts": 3,
                    "ConnectionTimeout": 10,
                    "OriginShield": {"Enabled": False},
                },
                {
                    "Id": "lambda-api",
                    "DomainName": api_domain,
                    "OriginPath": "",
                    "CustomOriginConfig": {
                        "HTTPPort": 443,
                        "HTTPSPort": 443,
                        "OriginProtocolPolicy": "https-only",
                        "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
                        "OriginReadTimeout": 120,
                        "OriginKeepaliveTimeout": 5,
                    },
                    "CustomHeaders": {"Quantity": 0},
                    "ConnectionAttempts": 3,
                    "ConnectionTimeout": 10,
                    "OriginShield": {"Enabled": False},
                },
            ],
        },
        "DefaultCacheBehavior": {
            "TargetOriginId": "s3-frontend",
            "ViewerProtocolPolicy": "redirect-to-https",
            "AllowedMethods": {
                "Quantity": 2,
                "Items": ["GET", "HEAD"],
                "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
            },
            "Compress": True,
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            "SmoothStreaming": False,
            "FieldLevelEncryptionId": "",
            "TrustedSigners": {"Enabled": False, "Quantity": 0},
            "TrustedKeyGroups": {"Enabled": False, "Quantity": 0},
            "LambdaFunctionAssociations": {"Quantity": 0},
            "FunctionAssociations": {"Quantity": 0},
            "GrpcConfig": {"Enabled": False},
        },
        "CacheBehaviors": {
            "Quantity": 1,
            "Items": [
                {
                    "PathPattern": "/api/*",
                    "TargetOriginId": "lambda-api",
                    "ViewerProtocolPolicy": "https-only",
                    "AllowedMethods": {
                        "Quantity": 7,
                        "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
                        "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
                    },
                    "Compress": True,
                    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
                    "OriginRequestPolicyId": "b689b0a8-53d0-40ab-baf2-68738e2966ac",
                    "SmoothStreaming": False,
                    "FieldLevelEncryptionId": "",
                    "TrustedSigners": {"Enabled": False, "Quantity": 0},
                    "TrustedKeyGroups": {"Enabled": False, "Quantity": 0},
                    "LambdaFunctionAssociations": {"Quantity": 0},
                    "FunctionAssociations": {"Quantity": 0},
                    "GrpcConfig": {"Enabled": False},
                }
            ],
        },
        "CustomErrorResponses": {
            "Quantity": 2,
            "Items": [
                {
                    "ErrorCode": 403,
                    "ResponsePagePath": "/index.html",
                    "ResponseCode": "200",
                    "ErrorCachingMinTTL": 0,
                },
                {
                    "ErrorCode": 404,
                    "ResponsePagePath": "/index.html",
                    "ResponseCode": "200",
                    "ErrorCachingMinTTL": 0,
                },
            ],
        },
        "PriceClass": "PriceClass_100",
        "HttpVersion": "http2",
        "IsIPV6Enabled": True,
        "Restrictions": {"GeoRestriction": {"RestrictionType": "none", "Quantity": 0}},
        "ViewerCertificate": {
            "CloudFrontDefaultCertificate": True,
            "MinimumProtocolVersion": "TLSv1",
            "CertificateSource": "cloudfront",
        },
    }


def ensure_distribution(oac_id: str, function_url: str, state: Dict[str, Any]) -> Dict[str, Any]:
    client = session().client("cloudfront", region_name="us-east-1")
    dist_id = state.get("distribution_id")
    if dist_id:
        try:
            existing = client.get_distribution(Id=dist_id)
            return {
                "distribution_id": dist_id,
                "domain_name": existing["Distribution"]["DomainName"],
                "distribution_arn": existing["Distribution"]["ARN"],
            }
        except ClientError:
            pass
    put_bucket_policy(oac_id)
    resp = client.create_distribution(DistributionConfig=distribution_config(oac_id, function_url))
    dist = resp["Distribution"]
    put_bucket_policy(oac_id, distribution_arn=dist["ARN"])
    print("Waiting for CloudFront deploy…")
    client.get_waiter("distribution_deployed").wait(Id=dist["Id"])
    return {
        "distribution_id": dist["Id"],
        "domain_name": dist["DomainName"],
        "distribution_arn": dist["ARN"],
    }


def invalidate(distribution_id: str) -> None:
    session().client("cloudfront", region_name="us-east-1").create_invalidation(
        DistributionId=distribution_id,
        InvalidationBatch={
            "CallerReference": str(time.time()),
            "Paths": {"Quantity": 1, "Items": ["/*"]},
        },
    )


def update_api_base(app_base_url: str) -> None:
    client = session().client("lambda", region_name=AWS_REGION)
    conf = client.get_function_configuration(FunctionName=API_FUNCTION_NAME)
    env = dict((conf.get("Environment") or {}).get("Variables") or {})
    env["APP_BASE_URL"] = app_base_url.rstrip("/")
    client.update_function_configuration(
        FunctionName=API_FUNCTION_NAME,
        Environment={"Variables": env},
    )
    # Refresh Function URL CORS
    try:
        client.update_function_url_config(
            FunctionName=API_FUNCTION_NAME,
            Cors={
                "AllowCredentials": True,
                "AllowHeaders": ["content-type", "authorization"],
                "AllowMethods": ["*"],
                "AllowOrigins": [
                    app_base_url.rstrip("/"),
                    "http://127.0.0.1:5173",
                    "http://localhost:5173",
                ],
                "MaxAge": 86400,
            },
        )
    except ClientError as exc:
        print(json.dumps({"cors_update": str(exc)}))


def main() -> None:
    skip_build = os.getenv("SKIP_BUILD") == "1"
    state = load_state()
    if not skip_build:
        build_web()
    upload_dist()
    function_url = state.get("api_function_url") or get_function_url()
    oac_id = ensure_oac(state)
    dist = ensure_distribution(oac_id, function_url, state)
    app_base = f"https://{dist['domain_name']}"
    update_api_base(app_base)
    invalidate(dist["distribution_id"])
    state.update(
        {
            "oac_id": oac_id,
            "distribution_id": dist["distribution_id"],
            "domain_name": dist["domain_name"],
            "distribution_arn": dist["distribution_arn"],
            "app_base_url": app_base,
            "api_function_url": function_url,
            "frontend_bucket": BUCKET_NAME,
            "login_url": f"{app_base}/login",
        }
    )
    save_state(state)
    print(json.dumps({"deploy_frontend": "ok", "url": app_base, "login": state["login_url"]}))


if __name__ == "__main__":
    main()
