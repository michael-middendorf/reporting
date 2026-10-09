import copy
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("web", pathlib.Path(__file__).with_name("deploy-reporting-web.py"))
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)

def fixture():
    return {"family": web.FAMILY, "status": "ACTIVE", "taskDefinitionArn": "old",
            "taskRoleArn": "same-task-role", "executionRoleArn": "same-execution-role", "networkMode": "awsvpc",
            "cpu": "512", "memory": "1024", "requiresCompatibilities": ["FARGATE"],
            "containerDefinitions": [{"name": "web", "image": "old", "environment": [{"name": "SSO_ONLY", "value": "false"},
              {"name": "SSO_CUTOVER_AT", "value": ""}, {"name": "UNCHANGED", "value": "synthetic"}],
              "secrets": [{"name": "AUTH_SECRET", "valueFrom": "synthetic-ref"}], "readonlyRootFilesystem": True,
              "user": "node", "mountPoints": [{"sourceVolume": "tmp", "containerPath": "/tmp"}]},
             {"name": "sidecar", "image": "same-sidecar", "essential": False}],
            "volumes": [{"name": "tmp"}], "placementConstraints": []}

class FieldGate(unittest.TestCase):
    def test_only_image_and_controls_change(self):
        original = fixture()
        updated = web.candidate(original, "new", {"SSO_ONLY": "true", "SSO_CUTOVER_AT": "2026-01-01T00:00:00Z"})
        restored = copy.deepcopy(updated)
        restored["containerDefinitions"][0]["image"] = "old"
        restored["containerDefinitions"][0]["environment"] = original["containerDefinitions"][0]["environment"]
        self.assertEqual(restored, web.register_fields(original))
        self.assertEqual(original, fixture())

    def test_all_other_fields_refused(self):
        original = fixture()
        expected = web.register_fields(original)
        for mutate in [lambda t: t.update(taskRoleArn="other"), lambda t: t.update(memory="2048"),
                       lambda t: t["containerDefinitions"][0]["secrets"][0].update(valueFrom="other"),
                       lambda t: t["containerDefinitions"][1].update(image="other"),
                       lambda t: t["containerDefinitions"][0].update(readonlyRootFilesystem=False)]:
            actual = copy.deepcopy(original)
            mutate(actual)
            with self.assertRaisesRegex(ValueError, "task_field_drift"):
                web.assert_fields(actual, expected)

    def test_duplicate_and_secret_controls_refused(self):
        td = fixture()
        td["containerDefinitions"][0]["environment"].append({"name": "SSO_ONLY", "value": "true"})
        with self.assertRaisesRegex(ValueError, "duplicate"):
            web.candidate(td, "new", {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""})
        td = fixture()
        td["containerDefinitions"][0]["secrets"].append({"name": "SSO_ONLY", "valueFrom": "synthetic"})
        with self.assertRaisesRegex(ValueError, "collision"):
            web.candidate(td, "new", {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""})

    def test_stability_and_network_projection(self):
        service = {"serviceName": web.SERVICE, "status": "ACTIVE", "desiredCount": 1, "runningCount": 1,
                   "pendingCount": 0, "deployments": [{"rolloutState": "COMPLETED"}], "taskDefinition": "old",
                   "networkConfiguration": {"awsvpcConfiguration": {"subnets": ["same-private"]}}}
        self.assertEqual(web.service_snapshot(service)["networkConfiguration"], service["networkConfiguration"])
        for key, value in [("runningCount", 0), ("pendingCount", 1), ("desiredCount", 2)]:
            changed = copy.deepcopy(service)
            changed[key] = value
            with self.assertRaises(ValueError):
                web.service_snapshot(changed)

    def test_default_dry_run_has_no_registry_or_ecs_mutations(self):
        td = fixture()
        td["containerDefinitions"][0]["image"] = f"{web.ACCOUNT}.dkr.ecr.{web.REGION}.amazonaws.com/{web.REPOSITORY}:existing"
        service = {"serviceName": web.SERVICE, "status": "ACTIVE", "desiredCount": 1, "runningCount": 1,
                   "pendingCount": 0, "deployments": [{"rolloutState": "COMPLETED"}], "taskDefinition": "old"}
        with patch.object(web, "aws", return_value={"Account": web.ACCOUNT}) as aws, \
             patch.object(web, "live_service", return_value=service), \
             patch.object(web, "definition", return_value={"taskDefinition": td}), \
             patch.object(web.subprocess, "run", side_effect=AssertionError("no subprocess mutation")), patch("builtins.print"):
            web.deploy("a" * 40, {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""})
            self.assertEqual(aws.call_args_list[0].args, ("sts", "get-caller-identity"))
            self.assertEqual(aws.call_count, 1)

    def test_network_drift_after_registration_never_updates_service(self):
        td = fixture()
        prefix = f"{web.ACCOUNT}.dkr.ecr.{web.REGION}.amazonaws.com/{web.REPOSITORY}"
        td["containerDefinitions"][0]["image"] = prefix + ":existing"
        service = {"serviceName": web.SERVICE, "status": "ACTIVE", "desiredCount": 1, "runningCount": 1,
                   "pendingCount": 0, "deployments": [{"rolloutState": "COMPLETED"}], "taskDefinition": "old",
                   "networkConfiguration": {"awsvpcConfiguration": {"subnets": ["original"]}}}
        drift = copy.deepcopy(service)
        drift["networkConfiguration"]["awsvpcConfiguration"]["subnets"] = ["changed"]
        expected = web.candidate(td, prefix + "@sha256:" + "a" * 64, {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""})
        new_td = dict(expected, status="ACTIVE", taskDefinitionArn="new")
        calls = []
        def aws(*args, **kwargs):
            calls.append(args)
            if args == ("sts", "get-caller-identity"):
                return {"Account": web.ACCOUNT}
            if args[:2] == ("ecr", "describe-images"):
                return {"imageDetails": [{"imageDigest": "sha256:" + "a" * 64}]}
            if args[:2] == ("ecs", "register-task-definition"):
                self.assertEqual(kwargs["payload"], expected)
                self.assertNotIn("tags", kwargs["payload"], "ECS rejects an explicit empty tag list")
                return {"taskDefinition": new_td}
            raise AssertionError("unexpected mutation")
        with patch.object(web, "aws", side_effect=aws), \
             patch.object(web, "live_service", side_effect=[service, service, drift]), \
             patch.object(web, "definition", side_effect=lambda arn: {"taskDefinition": td if arn == "old" else new_td}), \
             patch.object(web.subprocess, "run", side_effect=AssertionError("immutable existing image must not rebuild")):
            with self.assertRaisesRegex(ValueError, "service_drift_after_register"):
                web.deploy("b" * 40, {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""}, execute=True)
        self.assertFalse(any(call[:2] == ("ecs", "update-service") for call in calls))

    def test_existing_immutable_image_actual_execute_and_digest_gate(self):
        for bad_digest in [False, True]:
            with self.subTest(bad_digest=bad_digest):
                td = fixture()
                prefix = f"{web.ACCOUNT}.dkr.ecr.{web.REGION}.amazonaws.com/{web.REPOSITORY}"
                td["containerDefinitions"][0]["image"] = prefix + ":existing"
                service = {"serviceName": web.SERVICE, "status": "ACTIVE", "desiredCount": 1, "runningCount": 1,
                           "pendingCount": 0, "deployments": [{"rolloutState": "COMPLETED"}], "taskDefinition": "old"}
                expected = web.candidate(td, prefix + "@sha256:" + "a" * 64, {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""})
                new_td = dict(expected, status="ACTIVE", taskDefinitionArn="new")
                calls = []
                def aws(*args, **kwargs):
                    calls.append(args)
                    if args == ("sts", "get-caller-identity"):
                        return {"Account": web.ACCOUNT}
                    if args[:2] == ("ecr", "describe-images"):
                        return {"imageDetails": [{"imageDigest": "sha256:" + "a" * 64}]}
                    if args[:2] == ("ecs", "register-task-definition"):
                        self.assertEqual(kwargs["payload"], expected)
                        self.assertNotIn("tags", kwargs["payload"], "ECS rejects an explicit empty tag list")
                        return {"taskDefinition": new_td}
                    if args[:2] == ("ecs", "update-service"):
                        self.assertEqual(args, ("ecs", "update-service", "--cluster", web.CLUSTER, "--service", web.SERVICE, "--task-definition", "new"))
                        return {}
                    if args[:2] == ("ecs", "list-tasks"):
                        return {"taskArns": ["synthetic-running"]}
                    if args[:2] == ("ecs", "describe-tasks"):
                        return {"tasks": [{"taskDefinitionArn": "new", "containers": [{"name": "web", "imageDigest": "sha256:" + ("b" if bad_digest else "a") * 64}]}]}
                    raise AssertionError("unexpected AWS operation")
                with patch.object(web, "aws", side_effect=aws), \
                     patch.object(web, "live_service", side_effect=[service, service, service, dict(service, taskDefinition="new")]), \
                     patch.object(web, "definition", side_effect=lambda arn: {"taskDefinition": td if arn == "old" else new_td}), \
                     patch.object(web.subprocess, "run", side_effect=AssertionError("must reuse immutable image")), patch("builtins.print") as output:
                    if bad_digest:
                        with self.assertRaisesRegex(ValueError, "running_image_mismatch"):
                            web.deploy("b" * 40, {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""}, execute=True)
                    else:
                        web.deploy("b" * 40, {"SSO_ONLY": "false", "SSO_CUTOVER_AT": ""}, execute=True)
                        self.assertIn('"deployed": true', output.call_args.args[0])
                self.assertEqual(sum(call[:2] == ("ecs", "update-service") for call in calls), 1)

if __name__ == "__main__":
    unittest.main()
