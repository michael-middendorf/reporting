"""Cybersecurity dashboard publisher (IT-3, PR 2): AWS + GitHub sources.

Daily SST Cron (05:00 ET, wired up by the main loop in a later PR) that
builds cybersecurity/latest.json for reporting.avemaria.edu/cybersecurity
from AWS (Security Hub, GuardDuty, Inspector2, IAM, CloudTrail, Backup, RDS,
ACM, VPN), GitHub (Dependabot/code scanning/secret scanning via a GitHub
App), a Graph stub (PR 3 implements it), and the AD inbox feed (PR 4 writes
to it). Every one of those four sources is isolated: a source that errors,
is not configured, or is not licensed shows up as that source's own status,
and the other three still compose normally (see aws.py's per-sub-source
wrapping and compose.py's "unknown rag on missing data, never a fake zero").

Local usage (reads real AWS/GitHub; writes nothing unless --write is given):
    PYTHONPATH=services/publishers python services/publishers/security/handler.py
    PYTHONPATH=services/publishers python services/publishers/security/handler.py --write

Tests (fakes/fixtures only, no network, no AWS credentials):
    PYTHONPATH=services/publishers python -m unittest discover \
        -s services/publishers/security -t services/publishers/security
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import ad
import aws
import compose
import github
import graph


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def collect_sources() -> dict[str, Any]:
    log("collecting aws...")
    aws_result = aws.collect()
    log(f"aws: {aws_result['status']} (sub: {aws_result.get('subStatus')})")

    log("collecting github...")
    github_result = github.collect()
    log(f"github: {github_result['status']}")

    log("collecting graph...")
    graph_result = graph.collect()
    log(f"graph: {graph_result['status']}")

    log("collecting ad...")
    ad_result = ad.collect()
    log(f"ad: {ad_result['status']}")

    return {"aws": aws_result, "github": github_result, "graph": graph_result, "ad": ad_result}


def run(*, write: bool) -> dict[str, Any]:
    sources = collect_sources()
    doc = compose.build_and_publish(sources, write=write)
    status_summary = {k: v.get("status") for k, v in doc["sources"].items()}
    rag_summary: dict[str, int] = {}
    for kpi in doc["kpis"]:
        rag_summary[kpi["rag"]] = rag_summary.get(kpi["rag"], 0) + 1
    log(f"composed {len(doc['kpis'])} kpi(s); sources={status_summary}; rag={rag_summary}; write={write}")
    return doc


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    """Lambda entry point. Always writes to S3 (the SST Cron invokes this)."""
    del event, context
    doc = run(write=True)
    return {
        "generatedAt": doc["generatedAt"],
        "kpis": len(doc["kpis"]),
        "sourceStatus": {k: v.get("status") for k, v in doc["sources"].items()},
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write cybersecurity/latest.json and cybersecurity/history/<date>.json to S3. "
        "Default is a dry run that only prints the composed document.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Explicit no-op flag; this is already the default.")
    args = parser.parse_args(argv)
    write = bool(args.write) and not args.dry_run
    doc = run(write=write)
    print(json.dumps(doc, indent=2, default=str))


if __name__ == "__main__":
    main()
