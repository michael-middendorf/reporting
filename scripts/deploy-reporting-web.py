"""Deploy only the existing Reporting web service, without printing task configuration."""
import argparse
import copy
import datetime
import json
import re
import subprocess
import time
from pathlib import Path

ACCOUNT = "905418447941"
REGION = "us-east-2"
CLUSTER = "amu-reporting"
SERVICE = "AmuReportingEcs-WebService7F8A1763-qaHNvWylaKl3"
FAMILY = "AmuReportingEcsWebTask2423734C"
REPOSITORY = "cdk-hnb659fds-container-assets-905418447941-us-east-2"
REGISTER_FIELDS = {
    "family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions",
    "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory",
    "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators", "ephemeralStorage",
    "runtimePlatform", "enableFaultInjection",
}

def controls(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if set(value) != {"SSO_ONLY", "SSO_CUTOVER_AT"} or value["SSO_ONLY"] not in {"true", "false"}:
        raise ValueError("invalid_auth_config")
    cutoff = value["SSO_CUTOVER_AT"]
    if value["SSO_ONLY"] == "false":
        if cutoff != "":
            raise ValueError("invalid_auth_config")
    else:
        if not isinstance(cutoff, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z", cutoff):
            raise ValueError("invalid_auth_config")
        stamp = datetime.datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
        if stamp > datetime.datetime.now(datetime.timezone.utc):
            raise ValueError("future_auth_cutoff")
    return value

def register_fields(td):
    if td.get("family") != FAMILY or td.get("status") != "ACTIVE":
        raise ValueError("unexpected_task_definition")
    return copy.deepcopy({key: value for key, value in td.items() if key in REGISTER_FIELDS})

def candidate(td, image, auth):
    result = register_fields(td)
    web = [c for c in result["containerDefinitions"] if c["name"] == "web"]
    if len(web) != 1:
        raise ValueError("unexpected_web_container")
    if any(s["name"] in auth for s in web[0].get("secrets", [])):
        raise ValueError("secret_auth_collision")
    env = web[0].get("environment", [])
    for key in auth:
        if sum(e["name"] == key for e in env) > 1:
            raise ValueError("duplicate_auth_environment")
    web[0]["environment"] = [e for e in env if e["name"] not in auth] + [
        {"name": key, "value": value} for key, value in auth.items()
    ]
    web[0]["image"] = image
    return result

def canonical(value):
    value = copy.deepcopy(value)
    value.setdefault("volumes", [])
    value.setdefault("placementConstraints", [])
    value.setdefault("enableFaultInjection", False)
    if "requiresCompatibilities" in value:
        value["requiresCompatibilities"].sort()
    for container in value.get("containerDefinitions", []):
        container.setdefault("cpu", 0)
        container["environment"] = sorted(container.get("environment", []), key=lambda e: e["name"])
        for mapping in container.get("portMappings", []):
            mapping.setdefault("hostPort", mapping["containerPort"])
    return value

def assert_fields(actual, expected):
    if canonical(register_fields(actual)) != canonical(expected):
        raise ValueError("task_field_drift")

def service_snapshot(service, stable=True):
    if service.get("serviceName") != SERVICE or service.get("status") != "ACTIVE" or service.get("desiredCount") != 1:
        raise ValueError("unexpected_service")
    if stable and (service.get("runningCount") != 1 or service.get("pendingCount") != 0 or
                   len(service.get("deployments", [])) != 1 or
                   service["deployments"][0].get("rolloutState") != "COMPLETED"):
        raise ValueError("service_not_stable")
    keys = {"taskDefinition", "desiredCount", "networkConfiguration", "loadBalancers", "deploymentConfiguration",
            "capacityProviderStrategy", "launchType", "platformVersion", "schedulingStrategy", "enableExecuteCommand"}
    return {key: copy.deepcopy(service[key]) for key in keys if key in service}

def aws(*args, payload=None, missing_image=False):
    command = ["aws", "--region", REGION, *args, "--output", "json"]
    if payload is not None:
        # Linux runner stdin avoids persisting configuration or putting it in process arguments.
        command += ["--cli-input-json", "file:///dev/stdin"]
    result = subprocess.run(command, input=None if payload is None else json.dumps(payload),
                            text=True, capture_output=True, check=False)
    if result.returncode:
        if missing_image and "ImageNotFoundException" in result.stderr:
            return None
        raise RuntimeError("aws_operation_failed")
    return json.loads(result.stdout)

def live_service():
    value = aws("ecs", "describe-services", "--cluster", CLUSTER, "--services", SERVICE)
    if value.get("failures") or len(value.get("services", [])) != 1:
        raise ValueError("service_lookup_failed")
    return value["services"][0]

def definition(arn):
    return aws("ecs", "describe-task-definition", "--task-definition", arn, "--include", "TAGS")

def deploy(sha, auth, execute=False):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("invalid_source_sha")
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise ValueError("wrong_account")
    baseline = live_service()
    snapshot = service_snapshot(baseline)
    original = definition(baseline["taskDefinition"])
    td = original["taskDefinition"]
    web = [c for c in td["containerDefinitions"] if c["name"] == "web"]
    if len(web) != 1:
        raise ValueError("unexpected_web_container")
    prefix = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{REPOSITORY}"
    if not web[0]["image"].startswith(prefix + ":") and not web[0]["image"].startswith(prefix + "@sha256:"):
        raise ValueError("unexpected_repository")
    platform = td.get("runtimePlatform", {})
    if platform.get("cpuArchitecture", "X86_64") != "X86_64" or platform.get("operatingSystemFamily", "LINUX") != "LINUX":
        raise ValueError("unexpected_platform")
    # Refuse duplicate controls or secret collisions before any registry mutation.
    candidate(td, web[0]["image"], auth)
    if not execute:
        print(json.dumps({"dry_run": True, "source": sha, "baseline_task_definition": baseline["taskDefinition"],
                          "scope": "web_image_and_two_auth_controls_only"}))
        return
    tag = f"{prefix}:reporting-web-{sha}"
    existing = aws("ecr", "describe-images", "--repository-name", REPOSITORY,
                   "--image-ids", f"imageTag=reporting-web-{sha}", missing_image=True)
    if existing is None:
        token = subprocess.run(["aws", "ecr", "get-login-password", "--region", REGION], capture_output=True, text=True)
        if token.returncode:
            raise RuntimeError("registry_login_failed")
        login = subprocess.run(["docker", "login", "--username", "AWS", "--password-stdin", prefix.split("/")[0]],
                               input=token.stdout, text=True, capture_output=True)
        if login.returncode:
            raise RuntimeError("registry_login_failed")
        subprocess.run(["docker", "build", "--platform", "linux/amd64", "-f", "Dockerfile.web", "-t", tag, "."], check=True)
        subprocess.run(["docker", "push", tag], check=True)
    details = aws("ecr", "describe-images", "--repository-name", REPOSITORY, "--image-ids", f"imageTag=reporting-web-{sha}")["imageDetails"]
    if len(details) != 1 or not re.fullmatch(r"sha256:[0-9a-f]{64}", details[0]["imageDigest"]):
        raise ValueError("invalid_image_digest")
    image = prefix + "@" + details[0]["imageDigest"]
    if service_snapshot(live_service()) != snapshot:
        raise ValueError("service_drift_before_register")
    assert_fields(definition(baseline["taskDefinition"])["taskDefinition"], register_fields(td))
    expected = candidate(td, image, auth)
    request = copy.deepcopy(expected)
    # ECS rejects an explicitly empty tag list. Omitting it preserves no tags.
    if original.get("tags"):
        request["tags"] = original["tags"]
    registered = aws("ecs", "register-task-definition", payload=request)["taskDefinition"]
    assert_fields(registered, expected)
    described = definition(registered["taskDefinitionArn"])
    assert_fields(described["taskDefinition"], expected)
    if sorted(described.get("tags", []), key=lambda t: t["key"]) != sorted(original.get("tags", []), key=lambda t: t["key"]):
        raise ValueError("task_tag_drift")
    if service_snapshot(live_service()) != snapshot:
        raise ValueError("service_drift_after_register")
    aws("ecs", "update-service", "--cluster", CLUSTER, "--service", SERVICE, "--task-definition", registered["taskDefinitionArn"])
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        current = live_service()
        stable = False
        try:
            current_snapshot = service_snapshot(current)
            stable = True
        except ValueError:
            current_snapshot = service_snapshot(current, stable=False)
        expected_service = dict(snapshot, taskDefinition=registered["taskDefinitionArn"])
        if current_snapshot != expected_service:
            raise ValueError("service_drift_during_rollout")
        if any(d.get("rolloutState") == "FAILED" for d in current.get("deployments", [])):
            raise ValueError("rollout_failed")
        if stable:
            tasks = aws("ecs", "list-tasks", "--cluster", CLUSTER, "--service-name", SERVICE)["taskArns"]
            if len(tasks) != 1:
                raise ValueError("unexpected_running_tasks")
            task = aws("ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", tasks[0])["tasks"][0]
            running_web = [c for c in task["containers"] if c["name"] == "web"]
            if task["taskDefinitionArn"] != registered["taskDefinitionArn"] or len(running_web) != 1 or running_web[0].get("imageDigest") != details[0]["imageDigest"]:
                raise ValueError("running_image_mismatch")
            print(json.dumps({"deployed": True, "source": sha, "task_definition": registered["taskDefinitionArn"],
                              "digest": details[0]["imageDigest"], "rollback_task_definition": baseline["taskDefinition"]}))
            return
        time.sleep(15)
    raise RuntimeError("rollout_timeout")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--execute", action="store_true", help="Explicitly authorize image push, registration and service update")
    args = parser.parse_args()
    try:
        deploy(args.sha, controls("config/reporting-web-auth.json"), execute=args.execute)
    except Exception:
        # AWS failures can contain injected configuration. Never echo exception details.
        print(json.dumps({"deployed": False, "error": "web_deployment_failed"}))
        raise SystemExit(1)
