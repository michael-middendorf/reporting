"""CLI: python -m mas_cache [refresh|serve] [--publish] [--no-local]

  refresh            Fetch raw Virtuous data → local frontend/data (and S3 with --publish)
  serve              Serve the frontend locally for development
"""
from __future__ import annotations

import argparse
import http.server
import socketserver
from pathlib import Path

from .config import load_config
from .refresh import refresh


def main() -> None:
    parser = argparse.ArgumentParser(prog="mas_cache")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_refresh = sub.add_parser("refresh", help="fetch raw Virtuous data")
    p_refresh.add_argument("--publish", action="store_true", help="also write raw JSON to the S3 cache bucket")
    p_refresh.add_argument("--no-local", action="store_true", help="skip writing local frontend/data")
    p_refresh.add_argument("--root", default=None)

    p_serve = sub.add_parser("serve", help="serve the frontend for local dev")
    p_serve.add_argument("--port", type=int, default=8791)
    p_serve.add_argument("--dir", default="frontend")

    args = parser.parse_args()

    if args.cmd == "refresh":
        cfg = load_config(args.root)
        meta = refresh(cfg, publish=args.publish, local=not args.no_local)
        print(f"Done. {meta['record_counts']['notes']} raw notes; generated {meta['generated_at']}")
    elif args.cmd == "serve":
        directory = str(Path(args.dir).resolve())
        handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=directory, **k)
        with socketserver.TCPServer(("", args.port), handler) as httpd:
            print(f"Serving {directory} at http://localhost:{args.port}")
            httpd.serve_forever()


if __name__ == "__main__":
    main()
