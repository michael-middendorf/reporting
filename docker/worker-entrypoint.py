"""ECS task dispatcher for the reporting publishers and processors."""
from __future__ import annotations

import importlib
import json
import os
import sys
from typing import Any

HANDLERS = {
    "athletics": "services.publishers.athletics.handler",
    "enrollment": "services.publishers.enrollment.handler",
    "virtuous": "services.publishers.virtuous.handler",
    "housing": "services.publishers.housing.handler",
    "institute": "services.publishers.institute.handler",
    "mas": "services.publishers.mas.handler",
    "alumni": "services.publishers.alumni.handler",
    "institute-process": "services.publishers.institute.process_handler",
    "powercampus": "services.publishers.powercampus.handler",
    "powerfaids": "services.publishers.powerfaids.handler",
    "greatplains": "services.publishers.greatplains.handler",
}


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    module_name = HANDLERS.get(action)
    if not module_name:
        raise SystemExit(f"unknown worker action: {action}")
    event: dict[str, Any] = json.loads(os.environ.get("REPORT_EVENT", "{}"))
    if action == "virtuous":
        # The ECS replacement builds the MAS cache in the same task after raw refresh.
        result = importlib.import_module(module_name).handler(event, None)
        importlib.import_module(HANDLERS["mas"]).handler({"warm_only": True}, None)
    elif action == "institute":
        result = importlib.import_module(module_name).handler(event, None)
        importlib.import_module(HANDLERS["institute-process"]).handler({}, None)
    else:
        result = importlib.import_module(module_name).handler(event, None)
    print(json.dumps(result, default=str), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
