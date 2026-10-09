import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("scope", Path(__file__).with_name("reporting-deploy-scope.py"))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)

class Scope(unittest.TestCase):
    def classify(self, paths, before="a" * 40, fail=False):
        def git(*args):
            if fail:
                raise RuntimeError("synthetic_missing_base")
            if args[0] == "diff":
                self.assertEqual(args[-2:], (before, "b" * 40))
                self.assertIn("--no-renames", args)
                return b"\0".join(p.encode() for p in paths) + b"\0"
            if args[0] == "show":
                if args[1].endswith(":sst.config.ts"):
                    return b'const copy = "apps/web-next/new-publisher.json";'
                return json.dumps({}).encode()
            return b""
        with patch.object(scope, "git", side_effect=git):
            return scope.scope(before, "b" * 40)

    def test_whole_push_range_web_only(self):
        self.assertEqual(self.classify(["apps/web-next/src/app/login/page.tsx", "config/reporting-web-auth.json"]), "web")

    def test_publisher_inputs_and_unknown_infrastructure_full(self):
        for path in sorted(scope.PUBLISHER_INPUTS) + ["infra/lib/reporting-ecs-stack.ts", "sst.config.ts", "Dockerfile.worker",
                                                     "scripts/reporting-deploy-scope.py", "docs/runtime.json", "apps/web-next/new-publisher.json"]:
            self.assertEqual(self.classify(["apps/web-next/src/app/login/page.tsx", path]), "full")

    def test_missing_zero_or_no_changes_fail_closed(self):
        self.assertEqual(self.classify(["apps/web-next/a"], fail=True), "blocked")
        self.assertEqual(self.classify(["apps/web-next/a"], before="0" * 40), "blocked")
        self.assertEqual(self.classify([]), "full")

    def test_rename_outside_web_is_not_skipped(self):
        self.assertEqual(self.classify(["apps/web-next/a", "publishers/a"]), "full")

    def test_bootstrap_new_manifest_wrong_base_blocks(self):
        def git(*args):
            if args[0] == "diff":
                return scope.MANIFEST.encode() + b"\0"
            if args[0] == "show" and args[1].startswith("a" * 40):
                raise RuntimeError("missing_manifest_before")
            if args[0] == "show":
                return b"{}"
            return b""
        with patch.object(scope, "git", side_effect=git):
            self.assertEqual(scope.scope("a" * 40, "b" * 40), "blocked")

if __name__ == "__main__":
    unittest.main()
