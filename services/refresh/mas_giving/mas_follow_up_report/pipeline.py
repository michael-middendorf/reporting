from __future__ import annotations

import datetime as dt
import json
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, TypedDict
from zoneinfo import ZoneInfo

from .config import AppConfig
from .utils import (
    build_snippet,
    chunked,
    coerce_decimal_text,
    days_ago,
    ensure_dir,
    iso_date,
    iso_datetime,
    month_start,
    parse_currency,
    parse_virt_date,
    parse_virt_datetime,
    rolling_month_starts,
    rolling_week_starts,
    safe_int,
    strip_html_text,
    week_start,
    write_csv,
    write_json,
    write_jsonl_gz,
)
from .virtuous import VirtuousClient, VirtuousError


FOLLOW_ON_WINDOWS = (30, 90, 365)
EASTERN_TZ = ZoneInfo("America/New_York")

RAW_NOTE_FILES = {
    "notes": "notes_recent.jsonl.gz",
    "gifts": "gifts_recent.jsonl.gz",
    "contacts": "contacts.jsonl.gz",
}

DERIVED_ARTIFACT_NAMES = (
    "metadata.json",
    "engagements.json",
    "follow_on_gifts.json",
    "contact_rollup.json",
    "scorecards.json",
    "trends.json",
    "methodology.json",
    "segment_index.json",
)

EXPORT_ARTIFACT_NAMES = (
    "engagement_ledger.csv",
    "recent_follow_on_gifts.csv",
    "contact_rollup.csv",
    "ma_scorecard_breakdown.csv",
)

MA_OWNERS = {
    "Joseph Blaso": "joseph.c.blaso@avemaria.edu",
    "Sean Kelly": "sean.e.kelly@avemaria.edu",
    "Alanna McCann": "alanna.f.mccann@avemaria.edu",
}

REPLY_THREAD_MARKERS = [
    re.compile(pattern, re.IGNORECASE | re.DOTALL)
    for pattern in (
        r"\bfrom:",
        r"\bsent:",
        r"\bsubject:",
        r"\bto:",
        r"\bon .+ wrote:\b",
        r"-----\s*original message\s*-----",
        r"\bresponded\b",
        r"\breplied\b",
        r"\bmyself:\b",
        r"\bconversation went as follows\b",
    )
]


class EngagementRow(TypedDict, total=False):
    engagement_key: str
    ma_owner: str
    ma_owner_identity: str
    contact_id: int
    contact_name: str
    task_id: str
    task_title: str
    task_description: str
    completion_note_id: int | None
    completion_datetime_utc: str | None
    engagement_type: str
    engagement_bucket: str
    connection_classification: str
    engagement_date: str
    engagement_datetime_utc: str | None
    outreach_note_id: int
    outreach_note_type: str
    outreach_note_snippet: str


class FollowOnGiftRow(TypedDict, total=False):
    gift_link_key: str
    gift_id: int
    contact_id: int
    contact_name: str
    gift_date: str
    gift_amount: str
    gift_type: str
    segment: str
    project_name: str
    project_code: str
    days_from_engagement: int
    linked_engagement_key: str


def format_generated_at_display(generated_at_utc: dt.datetime) -> str:
    if generated_at_utc.tzinfo is None:
        generated_at_utc = generated_at_utc.replace(tzinfo=dt.timezone.utc)
    eastern_time = generated_at_utc.astimezone(EASTERN_TZ)
    return eastern_time.strftime("%Y-%m-%d %H:%M:%S %Z")
    linked_ma_owner: str
    linked_engagement_type: str
    linked_engagement_bucket: str
    linked_engagement_date: str
    in_window_30: bool
    in_window_90: bool
    in_window_365: bool


class ContactRollupRow(TypedDict, total=False):
    contact_id: int
    contact_name: str
    contact_type: str
    primary_email: str
    latest_engagement_key: str
    latest_engagement_date: str
    latest_engagement_type: str
    latest_engagement_bucket: str
    latest_ma_owner: str
    engagement_count_total: int
    engagement_count_two_way: int
    engagement_count_one_way: int
    engagement_count_failed: int
    follow_on_donor_30: bool
    follow_on_donor_90: bool
    follow_on_donor_365: bool
    follow_on_gift_count_30: int
    follow_on_gift_count_90: int
    follow_on_gift_count_365: int
    follow_on_dollars_30: str
    follow_on_dollars_90: str
    follow_on_dollars_365: str
    total_follow_on_giving: str
    first_follow_on_gift_date: str | None
    last_follow_on_gift_date: str | None
    same_day_ambiguous_gift_count: int


@dataclass(frozen=True)
class RawNote:
    id: int
    contact_id: int
    contact_name: str
    note_date: dt.date | None
    create_dt: dt.datetime | None
    note_type: str
    note_text: str
    created_by_user: str
    reminder: dict[str, Any] | None

    @property
    def timestamp(self) -> dt.datetime | None:
        if self.create_dt is not None:
            return self.create_dt
        if self.note_date is not None:
            return dt.datetime.combine(self.note_date, dt.time(12, 0))
        return None


@dataclass(frozen=True)
class NoteClassification:
    engagement_type: str
    engagement_bucket: str
    connection_classification: str


@dataclass(frozen=True)
class RecurringScreenResult:
    filtered_rows: list[FollowOnGiftRow]
    excluded_gift_ids: set[int]
    excluded_row_count: int
    recurring_backed_gift_ids: set[int]


def normalize_owner(value: str | None) -> str | None:
    if not value:
        return None
    normalized = re.sub(r"\s+", " ", value.strip())
    return normalized if normalized in MA_OWNERS else None


def owner_identity(owner: str | None) -> str:
    if not owner:
        return ""
    return str(MA_OWNERS.get(owner) or "")


def reply_thread_evidence(value: str | None) -> bool:
    text = strip_html_text(value)
    return any(pattern.search(text) for pattern in REPLY_THREAD_MARKERS)


def classify_note(note_type: str | None, note_text: str | None) -> NoteClassification | None:
    normalized_type = (note_type or "").strip().lower()
    if normalized_type == "mission advancement call | conversation":
        return NoteClassification("Call conversation", "Two-way engagement", "two_way")
    if normalized_type == "mission advancement call | email conversation":
        return NoteClassification("Email exchange", "Two-way engagement", "two_way")
    if normalized_type == "mission advancement call | email reach out":
        return NoteClassification("Email reach-out", "One-way outreach", "one_way")
    if normalized_type == "mission advancement call | email inactive":
        return NoteClassification("Email inactive", "One-way outreach", "one_way")
    if normalized_type == "mission advancement call | voicemail":
        return NoteClassification("Voicemail", "One-way outreach", "one_way")
    if normalized_type == "mission advancement call | invalid number":
        return NoteClassification("Invalid number", "Failed / unreachable", "failed")
    if normalized_type == "email":
        if reply_thread_evidence(note_text):
            return NoteClassification("Email exchange", "Two-way engagement", "two_way")
        return NoteClassification("Email reach-out", "One-way outreach", "one_way")
    if normalized_type == "call":
        return NoteClassification("Call conversation", "Two-way engagement", "two_way")
    if normalized_type == "in person":
        return NoteClassification("In person", "Two-way engagement", "two_way")
    if normalized_type == "letter":
        return NoteClassification("Letter", "One-way outreach", "one_way")
    return None


def _json_object_candidates(value: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    stripped = value.strip()
    for candidate in (stripped,):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            candidates.append(parsed)
    if "{" not in stripped or "}" not in stripped:
        return candidates
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        snippet = stripped[start : end + 1]
        try:
            parsed = json.loads(snippet)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            candidates.append(parsed)
    return candidates


def extract_reminder_payload(record: dict[str, Any]) -> dict[str, Any] | None:
    direct = record.get("reminder")
    if isinstance(direct, dict):
        return direct
    if isinstance(direct, str):
        for candidate in _json_object_candidates(direct):
            if candidate:
                return candidate

    stack: list[Any] = list(record.values())
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if "reminder" in current and isinstance(current["reminder"], dict):
                return current["reminder"]
            reminder_keys = {
                "resolutionType",
                "taskStatus",
                "taskId",
                "reminderId",
                "message",
                "description",
                "owner",
            }
            if reminder_keys.intersection(current.keys()):
                return current
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
        elif isinstance(current, str):
            for candidate in _json_object_candidates(current):
                if isinstance(candidate.get("reminder"), dict):
                    return candidate["reminder"]
                reminder_keys = {
                    "resolutionType",
                    "taskStatus",
                    "taskId",
                    "reminderId",
                    "message",
                    "description",
                    "owner",
                }
                if reminder_keys.intersection(candidate.keys()):
                    return candidate
    return None


def raw_note_from_record(record: dict[str, Any]) -> RawNote | None:
    note_id = safe_int(record.get("id"))
    contact_id = safe_int(record.get("contactId"))
    if note_id is None or contact_id is None:
        return None
    return RawNote(
        id=note_id,
        contact_id=contact_id,
        contact_name=str(record.get("contactName") or ""),
        note_date=parse_virt_date(record.get("noteDate")),
        create_dt=parse_virt_datetime(record.get("createDateTimeUtc")),
        note_type=str(record.get("type") or record.get("noteType") or ""),
        note_text=str(record.get("note") or record.get("text") or ""),
        created_by_user=str(record.get("createdByUser") or record.get("creator") or ""),
        reminder=extract_reminder_payload(record),
    )


def build_engagement_rows(notes: list[RawNote]) -> tuple[list[EngagementRow], list[dict[str, Any]]]:
    rows: list[EngagementRow] = []
    activity_rows: list[dict[str, Any]] = []
    for note in notes:
        classification = classify_note(note.note_type, note.note_text)
        owner = normalize_owner(note.created_by_user)
        if classification is None or owner is None or note.timestamp is None:
            continue
        activity_rows.append(
            {
                "contact_id": note.contact_id,
                "contact_name": note.contact_name,
                "ma_owner": owner,
                "engagement_type": classification.engagement_type,
                "engagement_bucket": classification.engagement_bucket,
                "outreach_note_id": note.id,
                "engagement_date": iso_date(note.timestamp.date()),
                "connection_classification": classification.connection_classification,
            }
        )
        rows.append(
            {
                "engagement_key": f"{note.contact_id}-{note.id}",
                "ma_owner": owner,
                "ma_owner_identity": owner_identity(owner),
                "contact_id": note.contact_id,
                "contact_name": note.contact_name,
                "task_id": "",
                "task_title": "",
                "task_description": "",
                "completion_note_id": None,
                "completion_datetime_utc": None,
                "engagement_type": classification.engagement_type,
                "engagement_bucket": classification.engagement_bucket,
                "connection_classification": classification.connection_classification,
                "engagement_date": iso_date(note.timestamp.date()),
                "engagement_datetime_utc": iso_datetime(note.timestamp),
                "outreach_note_id": note.id,
                "outreach_note_type": note.note_type,
                "outreach_note_snippet": build_snippet(note.note_text),
            }
        )

    rows = sorted(
        rows,
        key=lambda row: (
            row["engagement_date"],
            row["ma_owner"],
            row["contact_id"],
            row["outreach_note_id"],
        ),
    )
    return rows, activity_rows


def build_follow_on_gift_rows(
    engagements: list[EngagementRow],
    gifts: list[dict[str, Any]],
) -> tuple[list[FollowOnGiftRow], dict[str, Any]]:
    gifts_by_contact: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for gift in gifts:
        contact_id = safe_int(gift.get("contactId"))
        if contact_id is not None:
            gifts_by_contact[contact_id].append(gift)
    for contact_id in gifts_by_contact:
        gifts_by_contact[contact_id].sort(
            key=lambda item: (
                parse_virt_date(item.get("giftDate")) or dt.date.min,
                safe_int(item.get("id")) or 0,
            )
        )

    rows: list[FollowOnGiftRow] = []
    ambiguous_gift_ids: set[int] = set()
    ambiguous_by_contact: dict[int, set[int]] = defaultdict(set)

    for engagement in engagements:
        contact_id = engagement["contact_id"]
        engagement_date = parse_virt_date(engagement["engagement_date"])
        if engagement_date is None:
            continue
        for gift in gifts_by_contact.get(contact_id, []):
            gift_id = safe_int(gift.get("id"))
            gift_date = parse_virt_date(gift.get("giftDate"))
            if gift_id is None or gift_date is None:
                continue
            if gift_date == engagement_date:
                ambiguous_gift_ids.add(gift_id)
                ambiguous_by_contact[contact_id].add(gift_id)
                continue
            if gift_date < engagement_date:
                continue
            days_from = (gift_date - engagement_date).days
            if days_from < 1 or days_from > 365:
                continue
            amount = parse_currency(gift.get("amount"))
            rows.append(
                {
                    "gift_link_key": f"{gift_id}-{engagement['engagement_key']}",
                    "gift_id": gift_id,
                    "contact_id": contact_id,
                    "contact_name": str(gift.get("contactName") or engagement.get("contact_name") or ""),
                    "gift_date": iso_date(gift_date) or "",
                    "gift_amount": coerce_decimal_text(amount),
                    "gift_type": str(gift.get("giftType") or ""),
                    "segment": str(gift.get("segment") or gift.get("segmentName") or ""),
                    "project_name": str(gift.get("projectName") or ""),
                    "project_code": str(gift.get("projectCode") or ""),
                    "days_from_engagement": days_from,
                    "linked_engagement_key": engagement["engagement_key"],
                    "linked_ma_owner": engagement["ma_owner"],
                    "linked_engagement_type": engagement["engagement_type"],
                    "linked_engagement_bucket": engagement["engagement_bucket"],
                    "linked_engagement_date": engagement["engagement_date"],
                    "in_window_30": days_from <= 30,
                    "in_window_90": days_from <= 90,
                    "in_window_365": days_from <= 365,
                }
            )

    rows.sort(
        key=lambda row: (
            row["gift_date"],
            row["gift_id"],
            row["days_from_engagement"],
            row["linked_ma_owner"],
        )
    )
    return rows, {
        "same_day_ambiguous_gift_count": len(ambiguous_gift_ids),
        "same_day_ambiguous_by_contact": {key: len(value) for key, value in ambiguous_by_contact.items()},
    }


def project_fields_from_gift_detail(gift_detail: dict[str, Any]) -> tuple[str, str]:
    names: list[str] = []
    codes: list[str] = []
    for designation in gift_detail.get("giftDesignations", []) or []:
        project_name = str(designation.get("project") or "").strip()
        project_code = str(designation.get("projectCode") or "").strip()
        if project_name and project_name not in names:
            names.append(project_name)
        if project_code and project_code not in codes:
            codes.append(project_code)
    return "; ".join(names), "; ".join(codes)


def recurring_signature_from_gift_detail(gift_detail: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    rows: list[tuple[str, str]] = []
    for designation in gift_detail.get("giftDesignations", []) or []:
        project_code = str(designation.get("projectCode") or designation.get("project") or "").strip()
        amount = coerce_decimal_text(parse_currency(designation.get("amountDesignated")))
        rows.append((project_code, amount))
    return tuple(sorted(rows))


def recurring_signature_from_recurring_gift(recurring_gift: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    rows: list[tuple[str, str]] = []
    for designation in recurring_gift.get("designations", []) or []:
        project_code = str(designation.get("projectCode") or designation.get("project") or "").strip()
        amount = coerce_decimal_text(parse_currency(designation.get("amountDesignated")))
        rows.append((project_code, amount))
    return tuple(sorted(rows))


def match_recurring_gift_for_detail(
    gift_detail: dict[str, Any],
    recurring_gifts: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not recurring_gifts:
        return None

    gift_signature = recurring_signature_from_gift_detail(gift_detail)
    gift_amount = parse_currency(gift_detail.get("amount"))
    gift_segment = str(gift_detail.get("segment") or "").strip().lower()
    gift_source = str(gift_detail.get("transactionSource") or "").strip().lower()
    gift_date = parse_virt_date(gift_detail.get("giftDate"))

    scored: list[tuple[int, dt.date, dict[str, Any]]] = []
    for recurring_gift in recurring_gifts:
        recurring_signature = recurring_signature_from_recurring_gift(recurring_gift)
        recurring_amount = parse_currency(recurring_gift.get("amount"))
        signature_matches = bool(gift_signature) and recurring_signature == gift_signature
        amount_matches = recurring_amount == gift_amount
        if not signature_matches and not amount_matches:
            continue

        score = 0
        if signature_matches:
            score += 8
        if amount_matches:
            score += 4

        recurring_segment = str(recurring_gift.get("segment") or "").strip().lower()
        recurring_source = str(recurring_gift.get("transactionSource") or "").strip().lower()
        if gift_segment and recurring_segment and gift_segment == recurring_segment:
            score += 3
        if gift_source and recurring_source and gift_source == recurring_source:
            score += 3

        start_date = (
            parse_virt_date(recurring_gift.get("startDate"))
            or parse_virt_date(recurring_gift.get("recurringGiftDate"))
            or parse_virt_date(recurring_gift.get("createDateTimeUtc"))
            or dt.date.min
        )
        if gift_date is not None and start_date <= gift_date:
            score += 1

        scored.append((score, start_date, recurring_gift))

    if not scored:
        if len(recurring_gifts) == 1:
            return recurring_gifts[0]
        return None

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return scored[0][2]


def should_exclude_existing_recurring_gift(
    row: FollowOnGiftRow,
    gift_detail: dict[str, Any],
    recurring_gifts: list[dict[str, Any]],
) -> bool:
    recurring_payments = gift_detail.get("recurringGiftPayments") or []
    if not recurring_payments:
        return False

    engagement_date = parse_virt_date(row.get("linked_engagement_date"))
    if engagement_date is None:
        return False

    matched = match_recurring_gift_for_detail(gift_detail, recurring_gifts)
    if matched is not None:
        start_date = (
            parse_virt_date(matched.get("startDate"))
            or parse_virt_date(matched.get("recurringGiftDate"))
            or parse_virt_date(matched.get("createDateTimeUtc"))
        )
        return start_date is not None and start_date < engagement_date

    for recurring_gift in recurring_gifts:
        start_date = (
            parse_virt_date(recurring_gift.get("startDate"))
            or parse_virt_date(recurring_gift.get("recurringGiftDate"))
            or parse_virt_date(recurring_gift.get("createDateTimeUtc"))
        )
        if start_date is not None and start_date < engagement_date:
            return True
    return False


def filter_existing_recurring_follow_on_gifts(
    rows: list[FollowOnGiftRow],
    gift_details_by_id: dict[int, dict[str, Any]],
    recurring_gifts_by_contact: dict[int, list[dict[str, Any]]],
) -> RecurringScreenResult:
    filtered_rows: list[FollowOnGiftRow] = []
    excluded_gift_ids: set[int] = set()
    recurring_backed_gift_ids: set[int] = set()
    excluded_row_count = 0

    for row in rows:
        gift_id = row["gift_id"]
        gift_detail = gift_details_by_id.get(gift_id) or {}
        project_name, project_code = project_fields_from_gift_detail(gift_detail)
        if project_name:
            row["project_name"] = project_name
        if project_code:
            row["project_code"] = project_code

        recurring_payments = gift_detail.get("recurringGiftPayments") or []
        if recurring_payments:
            recurring_backed_gift_ids.add(gift_id)
        recurring_gifts = recurring_gifts_by_contact.get(row["contact_id"], [])
        if should_exclude_existing_recurring_gift(row, gift_detail, recurring_gifts):
            excluded_gift_ids.add(gift_id)
            excluded_row_count += 1
            continue
        filtered_rows.append(row)

    return RecurringScreenResult(
        filtered_rows=filtered_rows,
        excluded_gift_ids=excluded_gift_ids,
        excluded_row_count=excluded_row_count,
        recurring_backed_gift_ids=recurring_backed_gift_ids,
    )


def build_contact_rollups(
    contacts: list[dict[str, Any]],
    engagements: list[EngagementRow],
    follow_on_gifts: list[FollowOnGiftRow],
    same_day_ambiguous_by_contact: dict[int, int],
) -> list[ContactRollupRow]:
    contacts_by_id = {safe_int(contact.get("id")): contact for contact in contacts}
    engagements_by_contact: dict[int, list[EngagementRow]] = defaultdict(list)
    for row in engagements:
        engagements_by_contact[row["contact_id"]].append(row)

    gifts_by_contact: dict[int, list[FollowOnGiftRow]] = defaultdict(list)
    for row in follow_on_gifts:
        gifts_by_contact[row["contact_id"]].append(row)

    rollups: list[ContactRollupRow] = []
    for contact_id, engagement_rows in engagements_by_contact.items():
        engagement_rows.sort(
            key=lambda row: (
                row["engagement_date"],
                row["engagement_datetime_utc"] or "",
                row["engagement_key"],
            )
        )
        latest = engagement_rows[-1]
        contact = contacts_by_id.get(contact_id) or {}
        email = ""
        for method in contact.get("contactMethods", []) or []:
            kind = str(method.get("type") or "")
            if "email" in kind.lower():
                email = str(method.get("value") or method.get("emailAddress") or "")
                if email:
                    break

        unique_gifts: dict[int, FollowOnGiftRow] = {}
        window_gifts: dict[int, dict[int, FollowOnGiftRow]] = {30: {}, 90: {}, 365: {}}
        for gift in gifts_by_contact.get(contact_id, []):
            unique_gifts.setdefault(gift["gift_id"], gift)
            for window in FOLLOW_ON_WINDOWS:
                if gift[f"in_window_{window}"]:
                    window_gifts[window].setdefault(gift["gift_id"], gift)

        def total_for(window: int) -> Decimal:
            return sum((parse_currency(gift["gift_amount"]) for gift in window_gifts[window].values()), Decimal("0"))

        first_gift_date = None
        last_gift_date = None
        if unique_gifts:
            dates = sorted(parse_virt_date(gift["gift_date"]) for gift in unique_gifts.values())
            dates = [value for value in dates if value is not None]
            if dates:
                first_gift_date = dates[0]
                last_gift_date = dates[-1]

        rollups.append(
            {
                "contact_id": contact_id,
                "contact_name": contact_display_name(contact) or latest["contact_name"],
                "contact_type": str(contact.get("contactType") or ""),
                "primary_email": email,
                "latest_engagement_key": latest["engagement_key"],
                "latest_engagement_date": latest["engagement_date"],
                "latest_engagement_type": latest["engagement_type"],
                "latest_engagement_bucket": latest["engagement_bucket"],
                "latest_ma_owner": latest["ma_owner"],
                "engagement_count_total": len(engagement_rows),
                "engagement_count_two_way": sum(1 for row in engagement_rows if row["engagement_bucket"] == "Two-way engagement"),
                "engagement_count_one_way": sum(1 for row in engagement_rows if row["engagement_bucket"] == "One-way outreach"),
                "engagement_count_failed": sum(1 for row in engagement_rows if row["engagement_bucket"] == "Failed / unreachable"),
                "follow_on_donor_30": bool(window_gifts[30]),
                "follow_on_donor_90": bool(window_gifts[90]),
                "follow_on_donor_365": bool(window_gifts[365]),
                "follow_on_gift_count_30": len(window_gifts[30]),
                "follow_on_gift_count_90": len(window_gifts[90]),
                "follow_on_gift_count_365": len(window_gifts[365]),
                "follow_on_dollars_30": coerce_decimal_text(total_for(30)),
                "follow_on_dollars_90": coerce_decimal_text(total_for(90)),
                "follow_on_dollars_365": coerce_decimal_text(total_for(365)),
                "total_follow_on_giving": coerce_decimal_text(
                    sum((parse_currency(gift["gift_amount"]) for gift in unique_gifts.values()), Decimal("0"))
                ),
                "first_follow_on_gift_date": iso_date(first_gift_date),
                "last_follow_on_gift_date": iso_date(last_gift_date),
                "same_day_ambiguous_gift_count": int(same_day_ambiguous_by_contact.get(contact_id, 0)),
            }
        )

    rollups.sort(key=lambda row: (row["latest_engagement_date"], row["contact_name"]))
    return rollups


def contact_display_name(contact: dict[str, Any] | None) -> str:
    if not contact:
        return ""
    name = str(contact.get("name") or "").strip()
    if name:
        return name
    informal = str(contact.get("informalName") or "").strip()
    if informal:
        return informal
    individuals = contact.get("contactIndividuals", []) or []
    for individual in individuals:
        if individual.get("isPrimary"):
            first = str(individual.get("firstName") or "").strip()
            last = str(individual.get("lastName") or "").strip()
            full = " ".join(part for part in (first, last) if part).strip()
            if full:
                return full
    for individual in individuals:
        first = str(individual.get("firstName") or "").strip()
        last = str(individual.get("lastName") or "").strip()
        full = " ".join(part for part in (first, last) if part).strip()
        if full:
            return full
    return ""


def enrich_contact_names(
    contacts: list[dict[str, Any]],
    engagements: list[EngagementRow],
    follow_on_gifts: list[FollowOnGiftRow],
) -> None:
    contacts_by_id = {safe_int(contact.get("id")): contact for contact in contacts}
    for row in engagements:
        contact = contacts_by_id.get(row["contact_id"])
        resolved = contact_display_name(contact)
        if resolved:
            row["contact_name"] = resolved
    for row in follow_on_gifts:
        contact = contacts_by_id.get(row["contact_id"])
        resolved = contact_display_name(contact)
        if resolved:
            row["contact_name"] = resolved


def build_scorecards(
    engagements: list[EngagementRow],
    follow_on_gifts: list[FollowOnGiftRow],
    rollups: list[ContactRollupRow],
    same_day_ambiguous_gift_count: int,
) -> dict[str, Any]:
    engagement_contacts = {row["contact_id"] for row in engagements}
    unique_gifts_all: dict[int, FollowOnGiftRow] = {}
    unique_gifts_two_way: dict[int, FollowOnGiftRow] = {}
    for row in follow_on_gifts:
        unique_gifts_all.setdefault(row["gift_id"], row)
        if row["linked_engagement_bucket"] == "Two-way engagement":
            unique_gifts_two_way.setdefault(row["gift_id"], row)

    donor_sets_two_way: dict[int, set[int]] = {30: set(), 90: set(), 365: set()}
    dollar_sums_two_way: dict[int, Decimal] = {30: Decimal("0"), 90: Decimal("0"), 365: Decimal("0")}
    seen_gifts_two_way: dict[int, set[int]] = {30: set(), 90: set(), 365: set()}
    all_activity_donor_sets: dict[int, set[int]] = {30: set(), 90: set(), 365: set()}
    all_activity_dollars: dict[int, Decimal] = {30: Decimal("0"), 90: Decimal("0"), 365: Decimal("0")}
    seen_gifts_all: dict[int, set[int]] = {30: set(), 90: set(), 365: set()}

    for row in follow_on_gifts:
        gift_id = row["gift_id"]
        contact_id = row["contact_id"]
        amount = parse_currency(row["gift_amount"])
        for window in FOLLOW_ON_WINDOWS:
            if row[f"in_window_{window}"]:
                all_activity_donor_sets[window].add(contact_id)
                if gift_id not in seen_gifts_all[window]:
                    seen_gifts_all[window].add(gift_id)
                    all_activity_dollars[window] += amount
                if row["linked_engagement_bucket"] == "Two-way engagement":
                    donor_sets_two_way[window].add(contact_id)
                    if gift_id not in seen_gifts_two_way[window]:
                        seen_gifts_two_way[window].add(gift_id)
                        dollar_sums_two_way[window] += amount

    summary_cards = [
        {"id": "ma_outreach_notes", "label": "MA Outreach Notes", "value": len(engagements), "context": "qualifying MA outreach notes by scoped owners"},
        {"id": "two_way_engagements", "label": "Two-Way Engagements", "value": sum(1 for row in engagements if row["engagement_bucket"] == "Two-way engagement"), "context": "conversation or exchange evidence"},
        {"id": "one_way_outreach", "label": "One-Way Outreach", "value": sum(1 for row in engagements if row["engagement_bucket"] == "One-way outreach"), "context": "one-directional outreach notes"},
        {"id": "failed_contacts", "label": "Failed Contacts", "value": sum(1 for row in engagements if row["engagement_bucket"] == "Failed / unreachable"), "context": "invalid number or unreachable"},
        {"id": "two_way_donors_30", "label": "Two-Way Donors 30", "value": len(donor_sets_two_way[30]), "context": "strict post-engagement donors"},
        {"id": "two_way_donors_90", "label": "Two-Way Donors 90", "value": len(donor_sets_two_way[90]), "context": "strict post-engagement donors"},
        {"id": "two_way_donors_365", "label": "Two-Way Donors 365", "value": len(donor_sets_two_way[365]), "context": "strict post-engagement donors"},
        {"id": "two_way_dollars_30", "label": "Two-Way Dollars 30", "value": f"${coerce_decimal_text(dollar_sums_two_way[30])}", "context": "unique gifts"},
        {"id": "two_way_dollars_90", "label": "Two-Way Dollars 90", "value": f"${coerce_decimal_text(dollar_sums_two_way[90])}", "context": "unique gifts"},
        {"id": "two_way_dollars_365", "label": "Two-Way Dollars 365", "value": f"${coerce_decimal_text(dollar_sums_two_way[365])}", "context": "unique gifts"},
    ]

    owner_rows: list[dict[str, Any]] = []
    for owner in MA_OWNERS:
        owner_engagements = [row for row in engagements if row["ma_owner"] == owner]
        owner_gifts = [row for row in follow_on_gifts if row["linked_ma_owner"] == owner]
        unique_owner_gift_ids_by_window = {30: set(), 90: set(), 365: set()}
        owner_donors_by_window = {30: set(), 90: set(), 365: set()}
        owner_dollars_by_window = {30: Decimal("0"), 90: Decimal("0"), 365: Decimal("0")}
        for row in owner_gifts:
            gift_id = row["gift_id"]
            amount = parse_currency(row["gift_amount"])
            for window in FOLLOW_ON_WINDOWS:
                if row[f"in_window_{window}"]:
                    owner_donors_by_window[window].add(row["contact_id"])
                    if gift_id not in unique_owner_gift_ids_by_window[window]:
                        unique_owner_gift_ids_by_window[window].add(gift_id)
                        owner_dollars_by_window[window] += amount
        owner_rows.append(
            {
                "ma_owner": owner,
                "ma_owner_identity": owner_identity(owner),
                "outreach_notes": len(owner_engagements),
                "two_way_engagements": sum(1 for row in owner_engagements if row["engagement_bucket"] == "Two-way engagement"),
                "one_way_outreach": sum(1 for row in owner_engagements if row["engagement_bucket"] == "One-way outreach"),
                "failed_contacts": sum(1 for row in owner_engagements if row["engagement_bucket"] == "Failed / unreachable"),
                "distinct_contacts": len({row["contact_id"] for row in owner_engagements}),
                "follow_on_donors_30": len(owner_donors_by_window[30]),
                "follow_on_donors_90": len(owner_donors_by_window[90]),
                "follow_on_donors_365": len(owner_donors_by_window[365]),
                "follow_on_dollars_30": coerce_decimal_text(owner_dollars_by_window[30]),
                "follow_on_dollars_90": coerce_decimal_text(owner_dollars_by_window[90]),
                "follow_on_dollars_365": coerce_decimal_text(owner_dollars_by_window[365]),
            }
        )

    leaderboard = sorted(
        owner_rows,
        key=lambda row: (
            Decimal(row["follow_on_dollars_365"]),
            row["follow_on_donors_365"],
            row["two_way_engagements"],
        ),
        reverse=True,
    )

    return {
        "summary_cards": summary_cards,
        "overall": {
            "outreach_notes": len(engagements),
            "engaged_contacts": len(engagement_contacts),
            "rollup_contacts": len(rollups),
            "same_day_ambiguous_gifts": same_day_ambiguous_gift_count,
            "all_activity_follow_on_gifts_unique": len(unique_gifts_all),
            "two_way_follow_on_gifts_unique": len(unique_gifts_two_way),
            "all_activity_follow_on_donors": {str(window): len(all_activity_donor_sets[window]) for window in FOLLOW_ON_WINDOWS},
            "two_way_follow_on_donors": {str(window): len(donor_sets_two_way[window]) for window in FOLLOW_ON_WINDOWS},
            "all_activity_follow_on_dollars": {str(window): coerce_decimal_text(all_activity_dollars[window]) for window in FOLLOW_ON_WINDOWS},
            "two_way_follow_on_dollars": {str(window): coerce_decimal_text(dollar_sums_two_way[window]) for window in FOLLOW_ON_WINDOWS},
        },
        "owners": owner_rows,
        "leaderboard": leaderboard,
    }


def build_trends(
    engagements: list[EngagementRow],
    follow_on_gifts: list[FollowOnGiftRow],
    *,
    today: dt.date,
) -> dict[str, Any]:
    weekly_points = rolling_week_starts(today, 13)
    monthly_points = rolling_month_starts(today, 12)

    weekly_map = {
        point: {
            "period_start": point.isoformat(),
            "period_label": point.strftime("%b %d"),
            "outreach_notes": 0,
            "two_way_engagements": 0,
            "one_way_outreach": 0,
            "failed_contacts": 0,
            "recent_follow_on_donors": set(),
            "recent_follow_on_dollars": Decimal("0"),
            "owners": {owner: 0 for owner in MA_OWNERS},
        }
        for point in weekly_points
    }
    monthly_map = {
        point: {
            "period_start": point.isoformat(),
            "period_label": point.strftime("%b %Y"),
            "outreach_notes": 0,
            "two_way_engagements": 0,
            "one_way_outreach": 0,
            "failed_contacts": 0,
            "recent_follow_on_donors": set(),
            "recent_follow_on_dollars": Decimal("0"),
            "owners": {owner: 0 for owner in MA_OWNERS},
            "types": Counter(),
        }
        for point in monthly_points
    }

    for engagement in engagements:
        engagement_date = parse_virt_date(engagement["engagement_date"])
        if engagement_date is None:
            continue
        week_bucket = week_start(engagement_date)
        month_bucket = month_start(engagement_date)
        for bucket_map, bucket in ((weekly_map, week_bucket), (monthly_map, month_bucket)):
            if bucket not in bucket_map:
                continue
            bucket_map[bucket]["outreach_notes"] += 1
            if engagement["engagement_bucket"] == "Two-way engagement":
                bucket_map[bucket]["two_way_engagements"] += 1
            elif engagement["engagement_bucket"] == "One-way outreach":
                bucket_map[bucket]["one_way_outreach"] += 1
            else:
                bucket_map[bucket]["failed_contacts"] += 1
            bucket_map[bucket]["owners"][engagement["ma_owner"]] += 1
            if "types" in bucket_map[bucket]:
                bucket_map[bucket]["types"][engagement["engagement_type"]] += 1

    seen_recent_gifts_by_month: dict[dt.date, set[int]] = defaultdict(set)
    seen_recent_gifts_by_week: dict[dt.date, set[int]] = defaultdict(set)
    for row in follow_on_gifts:
        gift_date = parse_virt_date(row["gift_date"])
        if gift_date is None or not row["in_window_30"]:
            continue
        gift_id = row["gift_id"]
        week_bucket = week_start(gift_date)
        month_bucket = month_start(gift_date)
        amount = parse_currency(row["gift_amount"])
        if week_bucket in weekly_map and gift_id not in seen_recent_gifts_by_week[week_bucket]:
            seen_recent_gifts_by_week[week_bucket].add(gift_id)
            weekly_map[week_bucket]["recent_follow_on_dollars"] += amount
            weekly_map[week_bucket]["recent_follow_on_donors"].add(row["contact_id"])
        if month_bucket in monthly_map and gift_id not in seen_recent_gifts_by_month[month_bucket]:
            seen_recent_gifts_by_month[month_bucket].add(gift_id)
            monthly_map[month_bucket]["recent_follow_on_dollars"] += amount
            monthly_map[month_bucket]["recent_follow_on_donors"].add(row["contact_id"])

    def serialize_points(point_map: dict[dt.date, dict[str, Any]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for point in sorted(point_map):
            row = dict(point_map[point])
            row["recent_follow_on_donors"] = len(row["recent_follow_on_donors"])
            row["recent_follow_on_dollars"] = coerce_decimal_text(row["recent_follow_on_dollars"])
            if "types" in row:
                row["types"] = dict(row["types"])
            rows.append(row)
        return rows

    type_mix = Counter(row["engagement_type"] for row in engagements)
    return {
        "weekly": serialize_points(weekly_map),
        "monthly": serialize_points(monthly_map),
        "type_mix": dict(type_mix),
        "activity_totals": {
            "outreach_notes": len(engagements),
            "two_way_engagements": sum(1 for row in engagements if row["engagement_bucket"] == "Two-way engagement"),
            "one_way_outreach": sum(1 for row in engagements if row["engagement_bucket"] == "One-way outreach"),
            "failed_contacts": sum(1 for row in engagements if row["engagement_bucket"] == "Failed / unreachable"),
        },
    }


def build_methodology_payload(
    scorecards: dict[str, Any],
    smoke_checks: list[dict[str, Any]],
    *,
    generated_on: dt.date,
    config: AppConfig,
    excluded_existing_recurring_gifts: int,
    recurring_backed_follow_on_gifts: int,
) -> dict[str, Any]:
    return {
        "title": "MA Engagement and Follow-On Giving Methodology",
        "generated_on": generated_on.isoformat(),
        "scoped_owners": [
            {
                "name": owner,
                "identity": owner_identity(owner),
            }
            for owner in MA_OWNERS
        ],
        "source_of_truth": {
            "primary_activity_source": "POST /api/ContactNote/Query",
            "gift_source": "POST /api/Gift/Query with POST /api/Gift/Query/FullGift enrichment",
            "contact_enrichment_source": "Note and gift contact names with targeted POST /api/Contact/Query/FullContact fallback",
            "task_source_status": "Task and reminder completion state are ignored for report inclusion. The report uses MA-created outreach notes directly.",
        },
        "windows": {
            "fetch_days": config.note_window_days,
            "activity_default_days": config.activity_default_days,
            "recent_gift_default_days": config.recent_gift_window_days,
            "follow_on_windows_days": list(FOLLOW_ON_WINDOWS),
        },
        "definitions": {
            "two_way_engagement": [
                "Mission Advancement Call | Conversation",
                "Mission Advancement Call | Email Conversation",
                "Plain Email with reply-thread evidence",
                "Plain Call",
                "In Person",
            ],
            "one_way_outreach": [
                "Mission Advancement Call | Email Reach Out",
                "Mission Advancement Call | Email Inactive",
                "Plain Email without reply-thread evidence",
                "Letter",
                "Mission Advancement Call | Voicemail",
            ],
            "failed_unreachable": [
                "Mission Advancement Call | Invalid Number",
            ],
        },
        "caveats": [
            "This report measures temporal correlation, not causation.",
            "Any note created by a scoped MA owner and classified into the outreach taxonomy is included, regardless of task or reminder state.",
            "Same-day gifts are excluded from strict follow-on attribution because Virtuous gift records are date-only.",
            "Recurring-backed gifts are excluded when the matched recurring commitment started before the linked outreach date.",
            "One gift can link to more than one engagement row in the detailed ledger when multiple prior engagements qualify.",
            "Contact-level and cohort-level rollups deduplicate gifts to reduce obvious double-counting.",
        ],
        "same_day_ambiguous_gifts": scorecards["overall"]["same_day_ambiguous_gifts"],
        "existing_recurring_gifts_excluded": excluded_existing_recurring_gifts,
        "recurring_backed_follow_on_gifts_reviewed": recurring_backed_follow_on_gifts,
        "query_option_smoke_checks": smoke_checks,
    }


def build_segment_index(
    rollups: list[ContactRollupRow],
    engagements: list[EngagementRow],
    follow_on_gifts: list[FollowOnGiftRow],
    trends: dict[str, Any],
) -> dict[str, Any]:
    segments: dict[str, dict[str, Any]] = {}

    def add_segment(key: str, title: str, contact_ids: set[int]) -> None:
        segments[key] = {
            "title": title,
            "contact_ids": sorted(contact_ids),
        }

    add_segment("all:engaged", "All Outreach Contacts", {row["contact_id"] for row in rollups})
    for owner in MA_OWNERS:
        add_segment(
            f"owner:{owner}",
            f"{owner} Contacts",
            {row["contact_id"] for row in engagements if row["ma_owner"] == owner},
        )
    for bucket in ("Two-way engagement", "One-way outreach", "Failed / unreachable"):
        add_segment(
            f"bucket:{bucket}",
            bucket,
            {row["contact_id"] for row in engagements if row["engagement_bucket"] == bucket},
        )
    for engagement_type in sorted({row["engagement_type"] for row in engagements}):
        add_segment(
            f"type:{engagement_type}",
            engagement_type,
            {row["contact_id"] for row in engagements if row["engagement_type"] == engagement_type},
        )
    for window in FOLLOW_ON_WINDOWS:
        add_segment(
            f"follow_on:{window}",
            f"Follow-On Donors {window}",
            {row["contact_id"] for row in rollups if row[f"follow_on_donor_{window}"]},
        )

    recent_gifts_by_month: dict[str, set[int]] = defaultdict(set)
    for row in follow_on_gifts:
        if not row["in_window_30"]:
            continue
        gift_date = row["gift_date"][:7]
        recent_gifts_by_month[gift_date].add(row["contact_id"])
    for period, contact_ids in recent_gifts_by_month.items():
        add_segment(f"recent_gifts_month:{period}", f"Recent Follow-On Gifts in {period}", contact_ids)

    for row in trends.get("monthly", []):
        period = row["period_start"]
        contact_ids = {
            engagement["contact_id"]
            for engagement in engagements
            if (engagement["engagement_date"] or "").startswith(period[:7])
        }
        add_segment(f"engagement_month:{period}", f"Engagements in {row['period_label']}", contact_ids)

    return {"segments": segments}


def build_seed_contacts(
    engagements: list[EngagementRow],
    gifts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    contacts_by_id: dict[int, dict[str, Any]] = {}

    def ensure_contact(contact_id: int, contact_name: str) -> None:
        contact = contacts_by_id.setdefault(
            contact_id,
            {
                "id": contact_id,
                "name": "",
                "contactType": "",
                "contactMethods": [],
            },
        )
        resolved_name = str(contact_name or "").strip()
        if resolved_name and not str(contact.get("name") or "").strip():
            contact["name"] = resolved_name

    for row in engagements:
        ensure_contact(row["contact_id"], row.get("contact_name") or "")
    for gift in gifts:
        contact_id = safe_int(gift.get("contactId"))
        if contact_id is None:
            continue
        ensure_contact(contact_id, str(gift.get("contactName") or ""))

    return sorted(contacts_by_id.values(), key=lambda row: safe_int(row.get("id")) or 0)


class MAFollowUpPipeline:
    def __init__(self, config: AppConfig, client: VirtuousClient) -> None:
        self.config = config
        self.client = client
        for path in (
            config.raw_dir,
            config.derived_dir,
            config.state_dir,
            config.exports_dir,
            config.publish_dir,
        ):
            ensure_dir(path)

    def run(self, mode: str) -> dict[str, Any]:
        today = dt.date.today()
        started_perf = time.perf_counter()
        stage_started_at: dict[str, float] = {}
        stage_timings: dict[str, float] = {}

        def begin_stage(name: str) -> None:
            stage_started_at[name] = time.perf_counter()

        def end_stage(name: str) -> None:
            start_value = stage_started_at.pop(name, None)
            if start_value is not None:
                stage_timings[name] = round(time.perf_counter() - start_value, 2)

        begin_stage("smoke_checks")
        smoke_checks = self._smoke_check_query_options()
        end_stage("smoke_checks")

        notes_start = days_ago(today, self.config.note_window_days)
        gifts_start = days_ago(today, self.config.gift_window_days)

        print("Fetching MA contact notes...", flush=True)
        begin_stage("fetch_notes")
        note_records = self._fetch_notes(notes_start)
        end_stage("fetch_notes")
        write_jsonl_gz(self.config.raw_dir / RAW_NOTE_FILES["notes"], note_records)
        notes = [row for row in (raw_note_from_record(record) for record in note_records) if row is not None]
        print(f"  note rows: {len(notes)}", flush=True)

        begin_stage("build_engagements")
        engagements, _activity_rows = build_engagement_rows(notes)
        end_stage("build_engagements")
        candidate_contact_ids = sorted({row["contact_id"] for row in engagements})
        candidate_contact_id_set = set(candidate_contact_ids)

        print("Fetching gifts...", flush=True)
        begin_stage("fetch_gifts")
        all_gifts = self._fetch_gifts(gifts_start)
        gifts = [
            row
            for row in all_gifts
            if safe_int(row.get("contactId")) in candidate_contact_id_set
        ]
        end_stage("fetch_gifts")
        write_jsonl_gz(self.config.raw_dir / RAW_NOTE_FILES["gifts"], gifts)
        print(f"  gift rows: {len(gifts)}", flush=True)

        begin_stage("build_follow_on_gifts")
        follow_on_gifts, follow_on_stats = build_follow_on_gift_rows(engagements, gifts)
        end_stage("build_follow_on_gifts")

        begin_stage("recurring_screen")
        recurring_screen = self._filter_out_existing_recurring_gifts(follow_on_gifts, gifts_start)
        end_stage("recurring_screen")
        follow_on_gifts = recurring_screen.filtered_rows

        print("Building contact records...", flush=True)
        begin_stage("contact_enrichment")
        contacts = self._build_contacts(engagements, gifts)
        end_stage("contact_enrichment")
        write_jsonl_gz(self.config.raw_dir / RAW_NOTE_FILES["contacts"], contacts)
        print(f"  contacts: {len(contacts)}", flush=True)

        begin_stage("derive_outputs")
        enrich_contact_names(contacts, engagements, follow_on_gifts)
        rollups = build_contact_rollups(
            contacts,
            engagements,
            follow_on_gifts,
            follow_on_stats["same_day_ambiguous_by_contact"],
        )
        scorecards = build_scorecards(
            engagements,
            follow_on_gifts,
            rollups,
            follow_on_stats["same_day_ambiguous_gift_count"],
        )
        trends = build_trends(engagements, follow_on_gifts, today=today)
        methodology = build_methodology_payload(
            scorecards,
            smoke_checks,
            generated_on=today,
            config=self.config,
            excluded_existing_recurring_gifts=len(recurring_screen.excluded_gift_ids),
            recurring_backed_follow_on_gifts=len(recurring_screen.recurring_backed_gift_ids),
        )
        segment_index = build_segment_index(rollups, engagements, follow_on_gifts, trends)
        end_stage("derive_outputs")

        generated_at = dt.datetime.utcnow()
        runtime_seconds = round(time.perf_counter() - started_perf, 2)
        metadata = {
            "generated_at": iso_datetime(generated_at),
            "generated_at_display": format_generated_at_display(generated_at),
            "mode": mode,
            "windows": {
                "notes_start": iso_date(notes_start),
                "gifts_start": iso_date(gifts_start),
                "activity_default_days": self.config.activity_default_days,
                "recent_gift_default_days": self.config.recent_gift_window_days,
                "follow_on_windows": list(FOLLOW_ON_WINDOWS),
            },
            "counts": {
                "notes": len(notes),
                "candidate_contacts": len(candidate_contact_ids),
                "gifts": len(gifts),
                "contacts": len(contacts),
                "engagements": len(engagements),
                "follow_on_gift_links": len(follow_on_gifts),
                "rollup_contacts": len(rollups),
            },
            "rate_limit": self.client.rate_limit.as_dict(),
            "runtime_seconds": runtime_seconds,
            "stage_timings_seconds": stage_timings,
            "publish_runtime_seconds": None,
            "total_wall_runtime_seconds": None,
        }
        begin_stage("write_outputs")
        self._write_derived(
            metadata=metadata,
            engagements=engagements,
            follow_on_gifts=follow_on_gifts,
            rollups=rollups,
            scorecards=scorecards,
            trends=trends,
            methodology=methodology,
            segment_index=segment_index,
        )
        self._write_exports(engagements, follow_on_gifts, rollups, scorecards)
        end_stage("write_outputs")
        metadata["stage_timings_seconds"] = stage_timings

        publish_started = time.perf_counter()
        self._publish_site_data()
        publish_runtime = round(time.perf_counter() - publish_started, 2)
        metadata["publish_runtime_seconds"] = publish_runtime
        metadata["total_wall_runtime_seconds"] = round(time.perf_counter() - started_perf, 2)
        write_json(self.config.derived_dir / "metadata.json", metadata)
        write_json(self.config.publish_dir / "metadata.json", metadata)
        write_json(
            self.config.state_dir / "manifest.json",
            {
                "schema_version": 1,
                "last_success_at": metadata["generated_at"],
                "counts": metadata["counts"],
                "windows": metadata["windows"],
                "runtime_seconds": metadata["runtime_seconds"],
                "publish_runtime_seconds": metadata["publish_runtime_seconds"],
                "total_wall_runtime_seconds": metadata["total_wall_runtime_seconds"],
            },
        )
        return metadata

    def _fetch_notes(self, start_date: dt.date) -> list[dict[str, Any]]:
        today = dt.date.today()
        records = self._paged_query_with_date_fallback(
            "/api/ContactNote/Query",
            start_date,
            today,
            lambda range_start, range_end: {
                "groups": [
                    {
                        "conditions": [
                            {"parameter": "Note Date", "operator": "OnOrAfter", "value": range_start.isoformat()},
                            {"parameter": "Note Date", "operator": "OnOrBefore", "value": range_end.isoformat()},
                        ]
                    },
                    {
                        "conditions": [
                            {"parameter": "Create Date", "operator": "OnOrAfter", "value": range_start.isoformat()},
                            {"parameter": "Create Date", "operator": "OnOrBefore", "value": range_end.isoformat()},
                        ]
                    },
                ]
            },
            label="note slice",
        )
        deduped: dict[int, dict[str, Any]] = {}
        for record in records:
            row_id = safe_int(record.get("id"))
            if row_id is not None:
                deduped[row_id] = record
        return sorted(
            deduped.values(),
            key=lambda row: (
                parse_virt_datetime(row.get("createDateTimeUtc")) or dt.datetime.min,
                safe_int(row.get("id")) or 0,
            ),
        )

    def _fetch_gifts(self, start_date: dt.date) -> list[dict[str, Any]]:
        today = dt.date.today()
        return self._paged_query_with_date_fallback(
            "/api/Gift/Query",
            start_date,
            today,
            lambda range_start, range_end: {
                "groups": [
                    {
                        "conditions": [
                            {"parameter": "Gift Date", "operator": "OnOrAfter", "value": range_start.isoformat()},
                            {"parameter": "Gift Date", "operator": "OnOrBefore", "value": range_end.isoformat()},
                        ]
                    }
                ]
            },
            label="gift slice",
        )

    def _fetch_contacts(self, contact_ids: list[int]) -> list[dict[str, Any]]:
        if not contact_ids:
            return []
        contacts: list[dict[str, Any]] = []
        fetched = 0
        for chunk in chunked(contact_ids, self.config.contact_chunk_size):
            contacts.extend(self._fetch_contact_chunk_with_fallback(list(chunk)))
            fetched += len(chunk)
            if fetched % 500 == 0 or fetched >= len(contact_ids):
                print(f"  ...{fetched}/{len(contact_ids)} contact ids requested", flush=True)
        contacts.sort(key=lambda row: safe_int(row.get("id")) or 0)
        return contacts

    def _fetch_contact_chunk_with_fallback(self, contact_ids: list[int]) -> list[dict[str, Any]]:
        pending: list[list[int]] = [contact_ids]
        rows: list[dict[str, Any]] = []
        while pending:
            current = pending.pop(0)
            body = {
                "groups": [
                    {
                        "conditions": [
                            {"parameter": "Contact Id", "operator": "Is", "value": contact_id}
                        ]
                    }
                    for contact_id in current
                ]
            }
            try:
                payload = self.client.post(
                    "/api/Contact/Query/FullContact",
                    body,
                    params={"skip": 0, "take": len(current)},
                    timeout_seconds=min(max(self.config.timeout_seconds, 30), 60),
                    retries=2,
                )
                rows.extend(payload.get("list", []))
            except VirtuousError:
                if len(current) == 1:
                    raise
                midpoint = len(current) // 2
                pending.insert(0, current[midpoint:])
                pending.insert(0, current[:midpoint])
        return rows

    def _build_contacts(
        self,
        engagements: list[EngagementRow],
        gifts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        seeded_contacts = build_seed_contacts(engagements, gifts)
        missing_contact_ids = [
            safe_int(contact.get("id"))
            for contact in seeded_contacts
            if not str(contact.get("name") or "").strip()
        ]
        missing_contact_ids = [contact_id for contact_id in missing_contact_ids if contact_id is not None]
        if not missing_contact_ids:
            return seeded_contacts

        resolved_contacts = self._fetch_contacts(missing_contact_ids)
        resolved_by_id = {
            safe_int(contact.get("id")): contact
            for contact in resolved_contacts
            if safe_int(contact.get("id")) is not None
        }
        merged_contacts: list[dict[str, Any]] = []
        for contact in seeded_contacts:
            contact_id = safe_int(contact.get("id"))
            merged_contacts.append(resolved_by_id.get(contact_id) or contact)
        return merged_contacts

    def _paged_query_with_page_fallback(self, path: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        page_sizes = []
        current = self.config.page_size
        while current >= 100:
            if current not in page_sizes:
                page_sizes.append(current)
            current //= 2
        if 100 not in page_sizes:
            page_sizes.append(100)
        last_error: Exception | None = None
        for page_size in page_sizes:
            try:
                return self.client.paged_query(
                    path,
                    body,
                    page_size=page_size,
                    timeout_seconds=max(self.config.timeout_seconds, 180),
                )
            except VirtuousError as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        return []

    def _paged_query_with_date_fallback(
        self,
        path: str,
        start_date: dt.date,
        end_date: dt.date,
        build_body: Any,
        *,
        label: str,
    ) -> list[dict[str, Any]]:
        body = build_body(start_date, end_date)
        print(f"  {label}: {start_date.isoformat()} to {end_date.isoformat()}", flush=True)
        try:
            return self._paged_query_with_page_fallback(path, body)
        except VirtuousError:
            if start_date >= end_date:
                raise
            midpoint = start_date + dt.timedelta(days=(end_date - start_date).days // 2)
            if midpoint < start_date or midpoint >= end_date:
                raise
            left_rows = self._paged_query_with_date_fallback(
                path,
                start_date,
                midpoint,
                build_body,
                label=label,
            )
            right_rows = self._paged_query_with_date_fallback(
                path,
                midpoint + dt.timedelta(days=1),
                end_date,
                build_body,
                label=label,
            )
            return left_rows + right_rows

    def _fetch_full_gift_details(
        self,
        gift_ids: set[int],
        start_date: dt.date,
    ) -> dict[int, dict[str, Any]]:
        if not gift_ids:
            return {}

        details_by_id: dict[int, dict[str, Any]] = {}
        try:
            today = dt.date.today()
            records = self._paged_query_with_date_fallback(
                "/api/Gift/Query/FullGift",
                start_date,
                today,
                lambda range_start, range_end: {
                    "groups": [
                        {
                            "conditions": [
                                {"parameter": "Gift Date", "operator": "OnOrAfter", "value": range_start.isoformat()},
                                {"parameter": "Gift Date", "operator": "OnOrBefore", "value": range_end.isoformat()},
                            ]
                        }
                    ]
                },
                label="full gift slice",
            )
            for record in records:
                gift_id = safe_int(record.get("id"))
                if gift_id in gift_ids:
                    details_by_id[gift_id] = record
        except VirtuousError:
            details_by_id = {}

        missing_ids = sorted(gift_ids - set(details_by_id))
        for gift_id in missing_ids:
            details_by_id[gift_id] = self.client.get(f"/api/Gift/{gift_id}")
        return details_by_id

    def _filter_out_existing_recurring_gifts(
        self,
        rows: list[FollowOnGiftRow],
        start_date: dt.date,
    ) -> RecurringScreenResult:
        unique_gift_ids = sorted({row["gift_id"] for row in rows})
        if not unique_gift_ids:
            return RecurringScreenResult([], set(), 0, set())

        gift_details_by_id = self._fetch_full_gift_details(set(unique_gift_ids), start_date)
        contact_ids_for_recurring: set[int] = set()
        for gift_id in unique_gift_ids:
            detail = gift_details_by_id.get(gift_id) or {}
            if detail.get("recurringGiftPayments"):
                contact_id = safe_int(detail.get("contactId"))
                if contact_id is not None:
                    contact_ids_for_recurring.add(contact_id)

        recurring_gifts_by_contact: dict[int, list[dict[str, Any]]] = {}
        for contact_id in sorted(contact_ids_for_recurring):
            payload = self.client.get(
                f"/api/RecurringGift/ByContact/{contact_id}",
                params={"skip": 0, "take": 100},
            )
            recurring_gifts_by_contact[contact_id] = payload.get("list", [])

        return filter_existing_recurring_follow_on_gifts(
            rows,
            gift_details_by_id,
            recurring_gifts_by_contact,
        )

    def _write_derived(
        self,
        *,
        metadata: dict[str, Any],
        engagements: list[EngagementRow],
        follow_on_gifts: list[FollowOnGiftRow],
        rollups: list[ContactRollupRow],
        scorecards: dict[str, Any],
        trends: dict[str, Any],
        methodology: dict[str, Any],
        segment_index: dict[str, Any],
    ) -> None:
        write_json(self.config.derived_dir / "metadata.json", metadata)
        write_json(self.config.derived_dir / "engagements.json", engagements)
        write_json(self.config.derived_dir / "follow_on_gifts.json", follow_on_gifts)
        write_json(self.config.derived_dir / "contact_rollup.json", rollups)
        write_json(self.config.derived_dir / "scorecards.json", scorecards)
        write_json(self.config.derived_dir / "trends.json", trends)
        write_json(self.config.derived_dir / "methodology.json", methodology)
        write_json(self.config.derived_dir / "segment_index.json", segment_index)

    def _write_exports(
        self,
        engagements: list[EngagementRow],
        follow_on_gifts: list[FollowOnGiftRow],
        rollups: list[ContactRollupRow],
        scorecards: dict[str, Any],
    ) -> None:
        if engagements:
            write_csv(
                self.config.exports_dir / "engagement_ledger.csv",
                engagements,
                list(engagements[0].keys()),
            )
        if rollups:
            write_csv(
                self.config.exports_dir / "contact_rollup.csv",
                rollups,
                list(rollups[0].keys()),
            )
        if scorecards.get("owners"):
            write_csv(
                self.config.exports_dir / "ma_scorecard_breakdown.csv",
                scorecards["owners"],
                list(scorecards["owners"][0].keys()),
            )
        recent_gifts = [
            row
            for row in follow_on_gifts
            if row["in_window_30"]
        ]
        if recent_gifts:
            write_csv(
                self.config.exports_dir / "recent_follow_on_gifts.csv",
                recent_gifts,
                list(recent_gifts[0].keys()),
            )

    def _publish_site_data(self) -> None:
        ensure_dir(self.config.publish_dir / "exports")
        for name in DERIVED_ARTIFACT_NAMES:
            source = self.config.derived_dir / name
            target = self.config.publish_dir / name
            target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        for name in EXPORT_ARTIFACT_NAMES:
            source = self.config.exports_dir / name
            if source.exists():
                target = self.config.publish_dir / "exports" / name
                target.write_text(source.read_text(encoding="utf-8-sig"), encoding="utf-8-sig")

    def _smoke_check_query_options(self) -> list[dict[str, Any]]:
        checks: list[dict[str, Any]] = []
        for path, expected in (
            ("/api/ContactNote/QueryOptions", {"Create Date", "Note Date", "Note Type", "Creator", "Contact Id", "Contact Name"}),
            ("/api/Gift/QueryOptions", {"Gift Date", "Amount", "Contact Id", "Contact Name", "Segment Name", "Project Name", "Project Code", "Create Date"}),
        ):
            try:
                payload = self.client.get(path)
                if isinstance(payload, dict):
                    options = payload.get("options") or payload.get("list") or []
                else:
                    options = payload
                option_names = {
                    str(item.get("parameter") or item.get("name") or "")
                    for item in (options or [])
                    if isinstance(item, dict)
                }
                checks.append(
                    {
                        "path": path,
                        "ok": expected.issubset(option_names),
                        "expected": sorted(expected),
                        "found": sorted(option_names),
                    }
                )
            except Exception as exc:  # noqa: BLE001 - surface smoke-check failures in metadata
                checks.append(
                    {
                        "path": path,
                        "ok": False,
                        "error": str(exc),
                        "expected": sorted(expected),
                    }
                )
        return checks
