from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
from pathlib import Path

from .config import load_config
from .pipeline import MAFollowUpPipeline
from .virtuous import VirtuousClient


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mission Advancement follow-on giving report")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("sync", help="Run the Virtuous sync")

    serve_parser = subparsers.add_parser("serve", help="Serve the static site locally")
    serve_parser.add_argument("--port", type=int, default=8000)
    serve_parser.add_argument("--dir", default="site")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "serve":
        return serve(args.port, args.dir)

    config = load_config()
    client = VirtuousClient(
        base_url=config.base_url,
        api_key=config.api_key,
        timeout_seconds=config.timeout_seconds,
    )
    pipeline = MAFollowUpPipeline(config, client)
    metadata = pipeline.run("sync")
    completed_at = metadata.get("generated_at_display") or metadata.get("generated_at") or "unknown"
    print(
        f"sync complete: mode=sync "
        f"engagements={metadata['counts']['engagements']} "
        f"contacts={metadata['counts']['contacts']} "
        f"runtime={metadata['runtime_seconds']}s "
        f"completed_at={completed_at}"
    )
    return 0


def serve(port: int, directory: str) -> int:
    path = Path(directory).resolve()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(path))
    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"serving {path} on http://127.0.0.1:{port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0
