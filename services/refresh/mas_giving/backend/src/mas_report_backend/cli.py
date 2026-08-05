from __future__ import annotations

import argparse

from .service import ReportRefreshService, dumps_result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MAS report backend utilities")
    parser.add_argument("command", choices=("refresh", "health"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    service = ReportRefreshService()
    if args.command == "health":
        print(service.health())
        return 0
    print(dumps_result(service.refresh()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
