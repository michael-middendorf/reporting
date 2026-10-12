"""Acceptance letters export: PowerFAIDS rows -> contract v2 packages (DST-3070).

Mechanics only. Every business rule (statuses, categories, cost lines, housing,
units) is a named constant in acceptance_rules.py for Financial Aid to review.
Input is the six result sets in queries.ACCEPT_STATEMENTS. Output is the data
object, the manifest, and their S3 keys (mssql.DerivedOutput), data first.
Student rows are never logged; summary counts only.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable
from zoneinfo import ZoneInfo

try:
    from . import acceptance_rules as rules
except ImportError:  # pragma: no cover - flat import when run from this directory (tests)
    import acceptance_rules as rules  # type: ignore[no-redef]

from common import mssql

SCHEMA_VERSION = 2
SOURCE_PREFIX = "sources/acceptance-letters"
MANIFEST_KEY = f"{SOURCE_PREFIX}/manifest.json"
CAMPUS_ID_RE = re.compile(r"^P\d{9}$")
STATUSES = ("approved", "draft", "withdrawn")

Rows = list[dict[str, Any]]


def to_cents(value: Any) -> int:
    """Whole dollars (Decimal, int, float or str; None is 0) -> integer cents."""
    if value is None or value == "":
        return 0
    cents = (Decimal(str(value)) * rules.DOLLARS_TO_CENTS).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def split_even(total_cents: int) -> tuple[int, int]:
    """(fall, spring) with the odd cent going to fall."""
    spring = total_cents // 2
    return total_cents - spring, spring


def to_utc(value: Any) -> datetime | None:
    """Naive PowerFAIDS local time (datetime or ISO string) -> aware UTC; None if blank."""
    if value is None or value == "":
        return None
    if isinstance(value, str):
        text = value.strip().replace("Z", "+00:00")
        value = datetime.fromisoformat(text)
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo(rules.POWERFAIDS_TIMEZONE))
    return value.astimezone(timezone.utc)


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def source_version(package: dict[str, Any]) -> str:
    """sha256 of the canonical JSON of the package without sourceVersion and effectiveAt."""
    body = {k: v for k, v in package.items() if k not in ("sourceVersion", "effectiveAt")}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _poe_bucket(attend_desc: Any) -> str:
    text = str(attend_desc or "").strip()
    if rules.FALL_POE_PATTERN.match(text):
        return "fall"
    if rules.SPRING_POE_PATTERN.match(text):
        return "spring"
    return "other"


def _fund_category(fund: dict[str, Any]) -> str | None:
    fund_type = str(fund.get("fund_type") or "").strip()
    if fund_type == rules.FUND_TYPE_LOAN:
        return "loan"
    if fund_type == rules.FUND_TYPE_WORK:
        return "work"
    if fund_type == rules.FUND_TYPE_GRANT:
        source = str(fund.get("fund_source") or "").strip()
        family = str(fund.get("fund_family") or "").strip()
        if source == rules.SCHOLARSHIP_FUND_SOURCE and family in rules.SCHOLARSHIP_FAMILIES:
            return "scholarship"
        return "grant"
    return None


class _Counts(defaultdict):
    def __init__(self) -> None:
        super().__init__(int)


def _build_awards(
    award_rows: Rows,
    funds: dict[Any, dict[str, Any]],
    schedule: dict[Any, dict[str, int]],
    counts: _Counts,
    notes: list[str],
) -> list[dict[str, Any]]:
    awards: list[dict[str, Any]] = []
    for row in award_rows:
        status = rules.AWARD_STATUS_MAP.get(str(row.get("status") or "").strip())
        if status is None:
            counts["awardsSkippedStatus"] += 1
            continue
        fund = funds.get(row.get("fund_ay_token"))
        token_code = str(row.get("fund_ay_token"))
        if fund is None:
            counts["awardsSkippedNoFund"] += 1
            notes.append(rules.NOTE_NO_FUND.format(code=token_code))
            continue
        code = str(fund.get("fund_short_name") or "").strip() or str(fund.get("fund_token"))
        label = str(fund.get("fund_long_name") or "").strip() or code
        category = _fund_category(fund)
        if category is None:
            counts["awardsSkippedFundType"] += 1
            notes.append(rules.NOTE_UNKNOWN_FUND_TYPE.format(code=code))
            continue
        total = to_cents(row.get("actual_amt"))
        if total < 0:
            counts["awardsSkippedNegative"] += 1
            notes.append(rules.NOTE_NEGATIVE_AMOUNT.format(code=code))
            continue
        buckets = schedule.get(row.get("stu_award_token"))
        if buckets is None:
            fall, spring = split_even(total)
            notes.append(rules.NOTE_SPLIT_EVENLY.format(code=code))
        else:
            fall, spring = buckets["fall"], buckets["spring"]
            if buckets["other"]:
                notes.append(rules.NOTE_NON_TERM_DISBURSEMENT.format(code=code))
            if fall + spring != total:
                notes.append(rules.NOTE_SCHEDULE_MISMATCH.format(code=code))
        awards.append(
            {
                "code": code,
                "label": label,
                "category": category,
                "status": status,
                "fallCents": fall,
                "springCents": spring,
                "featured": False,
                "_annual": total,
            }
        )
    scholarships = [a for a in awards if a["category"] == "scholarship"]
    if scholarships:
        top = min(scholarships, key=lambda a: (-a["_annual"], a["label"]))
        top["featured"] = True
    awards.sort(key=lambda a: (a["category"], a["code"], a["label"], a["status"], a["fallCents"], a["springCents"]))
    for a in awards:
        del a["_annual"]
    return awards


def _build_costs(cost_row: dict[str, Any] | None, notes: list[str]) -> tuple[list[dict[str, Any]], str]:
    cost_row = cost_row or {}
    costs: list[dict[str, Any]] = []
    for column, code, label, category in rules.COST_LINES:
        cents = to_cents(cost_row.get(column))
        if cents > 0:
            fall, spring = split_even(cents)
            costs.append(
                {"code": code, "label": label, "category": category, "fallCents": fall, "springCents": spring}
            )
    if to_cents(cost_row.get(rules.TUITION_COLUMN)) <= 0:
        notes.append(rules.NOTE_NO_COA)
    housing = rules.HOUSING_ON_CAMPUS if to_cents(cost_row.get(rules.ROOM_BOARD_COLUMN)) > 0 else rules.HOUSING_COMMUTER
    return costs, housing


def build_export(results: dict[str, Rows], now: datetime, award_year: str) -> mssql.DerivedOutput:
    """Join the six result sets into the data object and manifest (contract v2)."""
    now = now.astimezone(timezone.utc)
    counts = _Counts()

    funds = {r["fund_token"]: r for r in results["funds"]}
    poe = {r["poe_token"]: r.get("attend_desc") for r in results["poe"]}
    schedule: dict[Any, dict[str, int]] = {}
    for r in results["schedule"]:
        buckets = schedule.setdefault(r["stu_award_token"], {"fall": 0, "spring": 0, "other": 0})
        bucket = _poe_bucket(poe.get(r.get("poe_token")))
        buckets[bucket] += to_cents(r.get("scheduled_amount"))
    awards_by_say: dict[Any, Rows] = defaultdict(list)
    for r in results["awards"]:
        awards_by_say[r["stu_award_year_token"]].append(r)
    costs_by_say = {r["stu_award_year_token"]: r for r in results["costs"]}

    # Uniqueness: a campus_id shared by two students (or two award-year rows)
    # is ambiguous, so none of them is emitted.
    by_campus: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in results["students"]:
        campus_id = r.get("campus_id")
        if campus_id is None or not CAMPUS_ID_RE.match(str(campus_id)):
            counts["studentsExcludedNoCampusId"] += 1
            continue
        by_campus[str(campus_id)].append(r)

    packages: list[dict[str, Any]] = []
    for campus_id in sorted(by_campus):
        rows = by_campus[campus_id]
        if len(rows) > 1:
            counts["campusIdsDuplicate"] += 1
            counts["studentsExcludedDuplicate"] += len(rows)
            continue
        row = rows[0]
        say_token = row["stu_award_year_token"]
        notes: list[str] = []
        awards = _build_awards(awards_by_say.get(say_token, []), funds, schedule, counts, notes)
        costs, housing = _build_costs(costs_by_say.get(say_token), notes)
        notes = list(dict.fromkeys(notes))
        if row.get("date_withdrew") is not None:
            status = "withdrawn"
        elif str(row.get("packaging_status") or "").strip() in rules.PACKAGED_STATUSES and not notes:
            status = "approved"
        else:
            status = "draft"
        stamps = [
            t
            for r in awards_by_say.get(say_token, [])
            for t in (to_utc(r.get("modified_dt")), to_utc(r.get("created_dt")))
            if t is not None
        ]
        package: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "slatePersonReferenceId": campus_id,
            "powerfaidsStudentId": str(row["student_token"]),
            "awardYear": award_year,
            "status": status,
            "housingPlan": housing,
            "costs": costs,
            "awards": awards,
            "notes": notes,
        }
        package["sourceVersion"] = source_version(package)
        package["effectiveAt"] = iso_utc(max(stamps) if stamps else now)
        packages.append(package)
        counts["packagesWithNotes"] += 1 if notes else 0

    generated_at = iso_utc(now)
    compact = now.strftime("%Y-%m-%dT%H%M%SZ")
    data_key = f"{SOURCE_PREFIX}/exports/{compact}.json"
    summary: dict[str, int] = {
        "packages": len(packages),
        **{status: sum(1 for p in packages if p["status"] == status) for status in STATUSES},
        "packagesWithNotes": counts["packagesWithNotes"],
        "awards": sum(len(p["awards"]) for p in packages),
        "awardsSkippedStatus": counts["awardsSkippedStatus"],
        "awardsSkippedFundType": counts["awardsSkippedFundType"],
        "awardsSkippedNoFund": counts["awardsSkippedNoFund"],
        "awardsSkippedNegative": counts["awardsSkippedNegative"],
        "studentsExcludedNoCampusId": counts["studentsExcludedNoCampusId"],
        "campusIdsDuplicate": counts["campusIdsDuplicate"],
        "studentsExcludedDuplicate": counts["studentsExcludedDuplicate"],
    }
    data = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "awardYear": award_year,
        "packages": packages,
    }
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "success": True,
        "generatedAt": generated_at,
        "dataKey": data_key,
        "summary": summary,
    }
    return mssql.DerivedOutput(
        objects=((data_key, data), (MANIFEST_KEY, manifest)),
        record_count=len(packages),
        prefix=SOURCE_PREFIX,
    )


def make_build(now_fn: Callable[[], datetime], award_year: str) -> Callable[[dict[str, Rows]], mssql.DerivedOutput]:
    def build(results: dict[str, Rows]) -> mssql.DerivedOutput:
        return build_export(results, now_fn(), award_year)

    return build
