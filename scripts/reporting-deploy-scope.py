"""Conservative path gate. An unverifiable push or bootstrap blocks deployment."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

BOOTSTRAP_BASE = "80ca93b72f996b94678ed5ea991c2d1abb5601e0"
MANIFEST = "config/reporting-web-deploy-bootstrap.json"
PUBLISHER_INPUTS = {
    "apps/web-next/src/lib/reports/athletics-coaching/sports.ts",
    "apps/web-next/src/lib/reports/points/gala-site-tickets.json",
    "apps/web-next/src/lib/reports/business-office/athletics-departments.json",
}

def git(*args):
    result = subprocess.run(["git", *args], capture_output=True, check=True)
    return result.stdout

def scope(before, after):
    if not re.fullmatch(r"[0-9a-f]{40}", before or "") or before == "0" * 40 or not re.fullmatch(r"[0-9a-f]{40}", after or ""):
        return "blocked"
    try:
        git("cat-file", "-e", before + "^{commit}")
        git("merge-base", "--is-ancestor", before, after)
        # Use the complete actual push range, including deletions and both sides of renames.
        paths = [p.decode("utf-8") for p in git("diff", "--no-renames", "--name-only", "-z", before, after).split(b"\0") if p]
        if not paths:
            return "full"
        bootstrap = json.loads(git("show", after + ":" + MANIFEST))
        try:
            git("show", before + ":" + MANIFEST)
            introducing_bootstrap = False
        except Exception:
            introducing_bootstrap = True
        if introducing_bootstrap and before != BOOTSTRAP_BASE:
            return "blocked"
        # SST copy inputs are web files but are also publisher runtime inputs.
        # Read current literals so newly added publisher copies cannot be skipped.
        sst_source = git("show", after + ":sst.config.ts").decode("utf-8")
        publisher_inputs = PUBLISHER_INPUTS | set(re.findall(r'apps/web-next/[^\s\"\'`]+', sst_source))
        if any("${" in path for path in publisher_inputs):
            return "full"
        for path in paths:
            if path in publisher_inputs:
                return "full"
            if path.startswith("apps/web-next/") or path in {"Dockerfile.web", "docker/web-docker-entrypoint.sh", "config/reporting-web-auth.json"}:
                continue
            if before == BOOTSTRAP_BASE and path == MANIFEST:
                continue
            if before == BOOTSTRAP_BASE and path in bootstrap:
                if hashlib.sha256(git("show", after + ":" + path)).hexdigest() == bootstrap[path]:
                    continue
                return "blocked"
            if introducing_bootstrap:
                return "blocked"
            return "full"
        return "web"
    except Exception:
        return "blocked"

if __name__ == "__main__":
    selected = scope(os.environ.get("PUSH_BEFORE"), os.environ.get("GITHUB_SHA"))
    # Explicit dispatch retains the old reviewed full deployment path.
    if os.environ.get("GITHUB_EVENT_NAME") != "push":
        selected = "full"
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("scope=" + selected + "\n")
    print(json.dumps({"deployment_scope": selected}))
    if selected == "blocked":
        raise SystemExit(1)
