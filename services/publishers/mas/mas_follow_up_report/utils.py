from __future__ import annotations

import csv
import datetime as dt
import gzip
import html
import json
import os
import re
import tempfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def chunked(items: Sequence[Any], size: int) -> Iterator[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def parse_virt_date(value: Any) -> dt.date | None:
    if value in (None, "", "Unavailable"):
        return None
    text = str(value).strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m/%d/%Y %I:%M:%S %p"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def parse_virt_datetime(value: Any) -> dt.datetime | None:
    if value in (None, "", "Unavailable"):
        return None
    text = str(value).strip()
    candidates = (
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%Y %H:%M:%S",
    )
    for fmt in candidates:
        try:
            return dt.datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def parse_currency(value: Any) -> Decimal:
    if value in (None, "", "Unavailable"):
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    text = str(value).strip()
    negative = text.startswith("(") and text.endswith(")")
    text = text.replace("$", "").replace(",", "").replace("(", "").replace(")", "")
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return Decimal("0")
    return -amount if negative else amount


def coerce_decimal_text(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f")


def iso_date(value: dt.date | None) -> str | None:
    return value.isoformat() if value else None


def iso_datetime(value: dt.datetime | None) -> str | None:
    return value.replace(microsecond=0).isoformat() if value else None


def days_ago(base_date: dt.date, days: int) -> dt.date:
    return base_date - dt.timedelta(days=days)


def month_start(value: dt.date) -> dt.date:
    return value.replace(day=1)


def week_start(value: dt.date) -> dt.date:
    return value - dt.timedelta(days=value.weekday())


def add_months(value: dt.date, months: int) -> dt.date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return dt.date(year, month, 1)


def rolling_month_starts(end_date: dt.date, months: int) -> list[dt.date]:
    end_month = month_start(end_date)
    start_month = add_months(end_month, -(months - 1))
    return [add_months(start_month, offset) for offset in range(months)]


def rolling_week_starts(end_date: dt.date, weeks: int) -> list[dt.date]:
    end_week = week_start(end_date)
    start_week = end_week - dt.timedelta(weeks=weeks - 1)
    return [start_week + dt.timedelta(weeks=offset) for offset in range(weeks)]


def safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def strip_html_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def build_snippet(value: str | None, limit: int = 180) -> str:
    text = strip_html_text(value)
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def atomic_write_text(path: Path, content: str) -> None:
    ensure_dir(path.parent)
    fd, temp_path = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def write_json(path: Path, payload: Any) -> None:
    atomic_write_text(path, json.dumps(payload, indent=2, sort_keys=False))


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fieldnames: list[str]) -> None:
    ensure_dir(path.parent)
    fd, temp_path = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def write_jsonl_gz(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    ensure_dir(path.parent)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(tmp_path, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=False))
            handle.write("\n")
    os.replace(tmp_path, path)


def read_jsonl_gz(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text:
                continue
            rows.append(json.loads(text))
    return rows
