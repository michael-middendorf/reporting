from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from .config import AppConfig
from .utils import (
    chunked,
    coerce_decimal_text,
    days_ago,
    ensure_dir,
    field_is_set,
    iso_date,
    iso_datetime,
    month_start,
    parse_currency,
    parse_virt_date,
    parse_virt_datetime,
    read_jsonl_gz,
    rolling_month_starts,
    safe_int,
    write_csv,
    write_json,
    write_jsonl_gz,
)
from .virtuous import VirtuousClient


PENDING_GROUP_NAME = "Pending Portfolio Assignment"

OUTREACH_ATTEMPT_TYPES = {
    "Mission Advancement Call | Email Reach Out",
    "Mission Advancement Call | Voicemail",
    "Mission Advancement Call | Invalid Number",
    "Mission Advancement Call | Email Inactive",
    "Call",
    "Email",
    "Letter",
    "In Person",
}

CONNECTED_TOUCH_TYPES = {
    "Mission Advancement Call | Conversation",
    "Mission Advancement Call | Email Conversation",
    "In Person",
}

OPPORTUNITY_BUCKET_ORDER = [
    "Recent donor, untouched, unassigned",
    "Recent donor, untouched, assigned",
    "Recent donor, touched, unassigned",
    "Recent donor, touched, assigned",
    "Lapsed donor (366-730 days)",
    "Inactive donor (>730 days)",
    "Never donor, touched in 90 days",
    "Never donor, untouched",
]

DONOR_RECENCY_ORDER = [
    "Gave in last 90 days",
    "Gave in last 365 days",
    "Gave 366-730 days ago",
    "Gave >730 days ago",
    "Never gave",
]

TOUCH_COVERAGE_ORDER = [
    "Recent donor touched in 90 days",
    "Recent donor untouched in 90 days",
    "Non-recent donor touched in 90 days",
    "No touch in 90 days",
]


@dataclass
class SyncArtifacts:
    alumni_base: list[dict[str, Any]]
    contacts: list[dict[str, Any]]
    gifts: list[dict[str, Any]]
    notes: list[dict[str, Any]]
    recurring_gifts: list[dict[str, Any]]
    planned_gifts: list[dict[str, Any]]
    event_attendees: list[dict[str, Any]]
    volunteers: list[dict[str, Any]]
    event_available: bool
    event_reason: str | None
    volunteer_available: bool
    volunteer_reason: str | None


class AlumniEngagementPipeline:
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

    def run(self, mode: str, *, contact_limit: int | None = None) -> dict[str, Any]:
        today = dt.date.today()
        started_at = dt.datetime.utcnow()
        manifest = self._load_manifest()

        print("Fetching alumni base...", flush=True)
        alumni_base = self._fetch_alumni_base(contact_limit=contact_limit)
        alumni_contact_ids = sorted(
            {safe_int(row.get("contactId")) for row in alumni_base if safe_int(row.get("contactId")) is not None}
        )
        print(f"  alumni rows: {len(alumni_base)}", flush=True)

        print("Fetching full contact records...", flush=True)
        contacts = self._fetch_contacts(alumni_contact_ids)
        print(f"  contacts: {len(contacts)}", flush=True)

        gifts_start = days_ago(today, self.config.gift_window_days)
        notes_start = days_ago(today, self.config.note_window_days)
        events_start = days_ago(today, self.config.event_window_days)

        print("Fetching gifts...", flush=True)
        gifts = self._fetch_gifts(alumni_contact_ids, gifts_start)
        print(f"  gifts: {len(gifts)}", flush=True)

        print("Fetching contact notes...", flush=True)
        notes = self._fetch_notes(
            alumni_contact_ids,
            notes_start=notes_start,
            prior_manifest=manifest,
            mode=mode,
        )
        print(f"  notes: {len(notes)}", flush=True)

        print("Fetching recurring gifts...", flush=True)
        recurring_gifts = self._fetch_recurring_gifts(alumni_contact_ids)
        print(f"  recurring gifts: {len(recurring_gifts)}", flush=True)

        print("Fetching planned gifts...", flush=True)
        planned_gifts = self._fetch_planned_gifts(alumni_contact_ids)
        print(f"  planned gifts: {len(planned_gifts)}", flush=True)

        print("Fetching event attendees...", flush=True)
        event_attendees = self._fetch_event_attendees(alumni_contact_ids, events_start)
        event_available = bool(event_attendees)
        event_reason = None if event_available else "No attended alumni event rows were returned in the current event window."
        print(f"  event attendees: {len(event_attendees)}", flush=True)

        print("Fetching volunteer records...", flush=True)
        volunteers, volunteer_available, volunteer_reason = self._fetch_volunteers(
            alumni_contact_ids,
            events_start,
        )
        print(f"  volunteers: {len(volunteers)}", flush=True)

        artifacts = SyncArtifacts(
            alumni_base=alumni_base,
            contacts=contacts,
            gifts=gifts,
            notes=notes,
            recurring_gifts=recurring_gifts,
            planned_gifts=planned_gifts,
            event_attendees=event_attendees,
            volunteers=volunteers,
            event_available=event_available,
            event_reason=event_reason,
            volunteer_available=volunteer_available,
            volunteer_reason=volunteer_reason,
        )
        self._write_raw_artifacts(artifacts)

        detail_records = self._build_detail_records(artifacts, today=today)
        payloads = self._build_payloads(detail_records, artifacts, today=today)

        generated_at = dt.datetime.utcnow()
        metadata = {
            "generated_at": iso_datetime(generated_at),
            "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "mode": mode,
            "windows": {
                "gifts_start": iso_date(gifts_start),
                "notes_start": iso_date(notes_start),
                "events_start": iso_date(events_start),
                "recent_touch_days": 90,
                "recent_donor_days": 365,
                "lapsed_donor_days": [366, 730],
                "trend_months": 12,
            },
            "counts": {
                "alumni_base": len(alumni_base),
                "contacts": len(contacts),
                "gifts": len(gifts),
                "notes": len(notes),
                "recurring_gifts": len(recurring_gifts),
                "planned_gifts": len(planned_gifts),
                "event_attendees": len(event_attendees),
                "volunteers": len(volunteers),
                "detail_records": len(detail_records),
            },
            "availability": {
                "event": {
                    "available": event_available,
                    "reason": event_reason,
                },
                "volunteer": {
                    "available": volunteer_available,
                    "reason": volunteer_reason,
                },
            },
            "rate_limit": self.client.rate_limit.as_dict(),
            "runtime_seconds": round((generated_at - started_at).total_seconds(), 2),
        }

        write_json(self.config.derived_dir / "metadata.json", metadata)
        write_json(self.config.derived_dir / "summary.json", payloads["summary"])
        write_json(self.config.derived_dir / "trends.json", payloads["trends"])
        write_json(self.config.derived_dir / "cohorts.json", payloads["cohorts"])
        write_json(self.config.derived_dir / "leaders.json", payloads["leaders"])
        write_json(self.config.derived_dir / "segment_index.json", payloads["segment_index"])
        write_json(self.config.derived_dir / "detail_index.json", detail_records)

        self._write_exports(detail_records)
        self._publish_site_data()

        note_watermark = self._max_modified_date(notes)
        next_manifest = {
            "schema_version": 2,
            "last_success_at": iso_datetime(generated_at),
            "last_note_modified_date": iso_date(note_watermark),
            "counts": metadata["counts"],
            "windows": metadata["windows"],
            "runtime_seconds": metadata["runtime_seconds"],
        }
        self._save_manifest(next_manifest)
        return metadata

    def _manifest_path(self) -> Path:
        return self.config.state_dir / "manifest.json"

    def _load_manifest(self) -> dict[str, Any]:
        path = self._manifest_path()
        if not path.exists():
            return {}
        import json

        return json.loads(path.read_text(encoding="utf-8"))

    def _save_manifest(self, manifest: dict[str, Any]) -> None:
        write_json(self._manifest_path(), manifest)

    def _fetch_alumni_base(self, *, contact_limit: int | None = None) -> list[dict[str, Any]]:
        body = {
            "groups": [
                {
                    "conditions": [
                        {"parameter": "Primary", "operator": "IsTrue"},
                        {"parameter": "Alumni", "operator": "Is", "value": "Alumni"},
                    ]
                }
            ]
        }
        rows = self.client.paged_query(
            "/api/ContactIndividual/Query",
            body,
            page_size=self.config.page_size,
            max_records=contact_limit,
        )
        return [row for row in rows if row.get("contactId")]

    def _fetch_contacts(self, contact_ids: list[int]) -> list[dict[str, Any]]:
        contacts: list[dict[str, Any]] = []
        for contact_chunk in chunked(contact_ids, self.config.contact_chunk_size):
            body = {
                "groups": [
                    {
                        "conditions": [
                            {"parameter": "Contact Id", "operator": "Is", "value": contact_id}
                        ]
                    }
                    for contact_id in contact_chunk
                ]
            }
            payload = self.client.post(
                "/api/Contact/Query/FullContact",
                body,
                params={"skip": 0, "take": len(contact_chunk)},
                timeout_seconds=max(self.config.timeout_seconds, 180),
            )
            contacts.extend(payload.get("list", []))
        contacts.sort(key=lambda row: row.get("id", 0))
        return contacts

    def _fetch_gifts(self, alumni_contact_ids: list[int], start_date: dt.date) -> list[dict[str, Any]]:
        return self._query_by_contact_chunks(
            "/api/Gift/Query",
            alumni_contact_ids,
            [
                {
                    "parameter": "Gift Date",
                    "operator": "OnOrAfter",
                    "value": start_date.isoformat(),
                }
            ],
            timeout_seconds=max(self.config.timeout_seconds, 180),
        )

    def _fetch_notes(
        self,
        alumni_contact_ids: list[int],
        *,
        notes_start: dt.date,
        prior_manifest: dict[str, Any],
        mode: str,
    ) -> list[dict[str, Any]]:
        alumni_set = set(alumni_contact_ids)
        if mode == "incremental":
            query_parameter = "Last Modified Date"
            query_date = notes_start
            manifest_date = parse_virt_date(prior_manifest.get("last_note_modified_date"))
            if manifest_date:
                overlap_start = manifest_date - dt.timedelta(days=self.config.incremental_overlap_days)
                if overlap_start > query_date:
                    query_date = overlap_start
        else:
            query_parameter = "Note Date"
            query_date = notes_start

        updated = self._query_by_contact_chunks(
            "/api/ContactNote/Query",
            alumni_contact_ids,
            [
                {
                    "parameter": query_parameter,
                    "operator": "OnOrAfter",
                    "value": query_date.isoformat(),
                }
            ],
            timeout_seconds=max(self.config.timeout_seconds, 180),
        )

        existing = []
        if mode == "incremental":
            existing = read_jsonl_gz(self.config.raw_dir / "notes_recent.jsonl.gz")

        by_id: dict[int, dict[str, Any]] = {}
        for row in existing:
            row_id = safe_int(row.get("id"))
            if row_id is not None:
                by_id[row_id] = row
        for row in updated:
            row_id = safe_int(row.get("id"))
            if row_id is not None:
                by_id[row_id] = row

        merged: list[dict[str, Any]] = []
        for row in by_id.values():
            note_date = parse_virt_date(row.get("noteDate"))
            if safe_int(row.get("contactId")) not in alumni_set:
                continue
            if note_date and note_date >= notes_start:
                merged.append(row)
        merged.sort(
            key=lambda row: (
                parse_virt_datetime(row.get("modifiedDateTimeUtc")) or dt.datetime.min,
                safe_int(row.get("id")) or 0,
            )
        )
        return merged

    def _fetch_recurring_gifts(self, alumni_contact_ids: list[int]) -> list[dict[str, Any]]:
        return self._query_by_contact_chunks(
            "/api/RecurringGift/Query",
            alumni_contact_ids,
            [{"parameter": "Status", "operator": "IsNot", "value": "Cancelled"}],
            timeout_seconds=max(self.config.timeout_seconds, 180),
        )

    def _fetch_planned_gifts(self, alumni_contact_ids: list[int]) -> list[dict[str, Any]]:
        return self._query_by_contact_chunks(
            "/api/PlannedGift/Query",
            alumni_contact_ids,
            [],
            timeout_seconds=max(self.config.timeout_seconds, 180),
        )

    def _fetch_event_attendees(
        self,
        alumni_contact_ids: list[int],
        start_date: dt.date,
    ) -> list[dict[str, Any]]:
        body = {
            "groups": [
                {
                    "conditions": [
                        {
                            "parameter": "Start Date",
                            "operator": "OnOrAfter",
                            "value": start_date.isoformat(),
                        },
                        {"parameter": "Attended", "operator": "IsTrue"},
                    ]
                }
            ]
        }
        allowed = set(alumni_contact_ids)
        rows = self.client.paged_query(
            "/api/EventAttendee/Query",
            body,
            page_size=self.config.page_size,
            timeout_seconds=max(self.config.timeout_seconds, 180),
        )
        return [row for row in rows if safe_int(row.get("contactId")) in allowed]

    def _fetch_volunteers(
        self,
        alumni_contact_ids: list[int],
        start_date: dt.date,
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
        body = {
            "groups": [
                {
                    "conditions": [
                        {
                            "parameter": "Volunteer Opportunity Start Date",
                            "operator": "OnOrAfter",
                            "value": start_date.isoformat(),
                        }
                    ]
                }
            ]
        }
        rows = self.client.paged_query(
            "/api/Volunteer/Query",
            body,
            page_size=self.config.page_size,
            timeout_seconds=max(self.config.timeout_seconds, 180),
        )
        if not rows:
            return [], False, "No volunteer rows were returned in the current window."
        if "contactId" not in rows[0]:
            return [], False, "Volunteer query rows do not expose contactId for contact-level attribution."
        allowed = set(alumni_contact_ids)
        filtered = [row for row in rows if safe_int(row.get("contactId")) in allowed]
        if not filtered:
            return [], False, "Volunteer rows were returned, but none were attributable to alumni contacts."
        return filtered, True, None

    def _query_by_contact_chunks(
        self,
        path: str,
        contact_ids: list[int],
        extra_conditions: list[dict[str, Any]],
        *,
        timeout_seconds: int | None = None,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for contact_chunk in chunked(contact_ids, self.config.contact_chunk_size):
            body = {
                "groups": [
                    {
                        "conditions": [
                            {"parameter": "Contact Id", "operator": "Is", "value": contact_id},
                            *extra_conditions,
                        ]
                    }
                    for contact_id in contact_chunk
                ]
            }
            rows.extend(
                self.client.paged_query(
                    path,
                    body,
                    page_size=self.config.page_size,
                    timeout_seconds=timeout_seconds,
                )
            )
        return rows

    def _write_raw_artifacts(self, artifacts: SyncArtifacts) -> None:
        write_jsonl_gz(self.config.raw_dir / "alumni_base.jsonl.gz", artifacts.alumni_base)
        write_jsonl_gz(self.config.raw_dir / "contacts.jsonl.gz", artifacts.contacts)
        write_jsonl_gz(self.config.raw_dir / "gifts_recent.jsonl.gz", artifacts.gifts)
        write_jsonl_gz(self.config.raw_dir / "notes_recent.jsonl.gz", artifacts.notes)
        write_jsonl_gz(self.config.raw_dir / "recurring_active.jsonl.gz", artifacts.recurring_gifts)
        write_jsonl_gz(self.config.raw_dir / "planned_gifts.jsonl.gz", artifacts.planned_gifts)
        write_jsonl_gz(self.config.raw_dir / "event_attendees_recent.jsonl.gz", artifacts.event_attendees)
        write_jsonl_gz(self.config.raw_dir / "volunteer_recent.jsonl.gz", artifacts.volunteers)

    def _build_detail_records(
        self,
        artifacts: SyncArtifacts,
        *,
        today: dt.date,
    ) -> list[dict[str, Any]]:
        contacts_by_id = {safe_int(contact.get("id")): contact for contact in artifacts.contacts}
        gifts_by_contact = self._index_by_contact_id(artifacts.gifts)
        notes_by_contact = self._index_by_contact_id(artifacts.notes)
        recurring_by_contact = self._index_by_contact_id(artifacts.recurring_gifts)
        planned_by_contact = self._index_by_contact_id(artifacts.planned_gifts)
        events_by_contact = self._index_by_contact_id(artifacts.event_attendees)
        volunteers_by_contact = self._index_by_contact_id(artifacts.volunteers)

        detail_records: list[dict[str, Any]] = []
        for alumni_row in artifacts.alumni_base:
            contact_id = safe_int(alumni_row.get("contactId"))
            if contact_id is None or contact_id not in contacts_by_id:
                continue
            contact = contacts_by_id[contact_id]
            individual = self._find_contact_individual(contact, alumni_row)

            gifts = gifts_by_contact.get(contact_id, [])
            notes = notes_by_contact.get(contact_id, [])
            recurring = recurring_by_contact.get(contact_id, [])
            planned = planned_by_contact.get(contact_id, [])
            events = events_by_contact.get(contact_id, [])
            volunteer_rows = volunteers_by_contact.get(contact_id, [])

            class_year = self._custom_field_value(alumni_row.get("customFields", []), "Class Year")
            if not class_year:
                class_year = self._custom_field_value(individual.get("customFields", []), "Class Year")
            degree = self._custom_field_value(individual.get("customFields", []), "Degree")
            major = self._custom_field_value(individual.get("customFields", []), "Major")
            if not degree:
                degree = self._custom_field_value(alumni_row.get("customFields", []), "Degree")
            if not major:
                major = self._custom_field_value(individual.get("customFields", []), "Major 1")
            if not major:
                major = self._custom_field_value(alumni_row.get("customFields", []), "Major")
            if not major:
                major = self._custom_field_value(alumni_row.get("customFields", []), "Major 1")

            cohort_label = class_year or "Missing Class Year"

            life_to_date_giving = parse_currency(contact.get("lifeToDateGiving"))
            year_to_date_giving = parse_currency(contact.get("yearToDateGiving"))
            last_gift_amount = parse_currency(contact.get("lastGiftAmount"))
            gift_metrics = self._gift_metrics(contact, gifts, today=today)
            note_metrics = self._note_metrics(notes, today=today)
            event_metrics = self._event_metrics(events, today=today)
            volunteer_metrics = self._volunteer_metrics(volunteer_rows, today=today)
            recurring_amount = self._recurring_amount(recurring)
            planned_amount = self._planned_amount(planned)

            is_deceased = self._is_deceased(contact)
            do_not_contact = self._do_not_flag(contact, "Do Not Contact")
            do_not_phone = self._do_not_flag(contact, "Do Not Phone")
            do_not_call_tag = self._has_do_not_call_tag(contact)
            assigned_groups = self._assigned_solicitor_groups(contact)
            assigned_flag = bool(assigned_groups)

            donor_recency_bucket = self._donor_recency_bucket(
                gift_metrics["last_gift_date"],
                life_to_date_giving,
                today=today,
            )
            lifetime_donor_flag = donor_recency_bucket != "Never gave"
            ytd_donor_flag = year_to_date_giving > 0
            recent_donor_90_flag = donor_recency_bucket == "Gave in last 90 days"
            recent_donor_365_flag = donor_recency_bucket in {
                "Gave in last 90 days",
                "Gave in last 365 days",
            }
            lapsed_donor_366_730_flag = donor_recency_bucket == "Gave 366-730 days ago"
            inactive_donor_over_730_flag = donor_recency_bucket == "Gave >730 days ago"
            never_donor_flag = donor_recency_bucket == "Never gave"

            touched_90_flag = note_metrics["touch_count_90"] > 0
            touched_365_flag = note_metrics["touch_count_365"] > 0
            outreach_attempt_90_flag = note_metrics["outreach_attempt_count_90"] > 0
            connected_conversation_90_flag = note_metrics["connected_touch_count_90"] > 0

            recent_donor_touched_90_flag = recent_donor_365_flag and touched_90_flag
            recent_donor_untouched_90_flag = recent_donor_365_flag and not touched_90_flag
            recent_donor_assigned_flag = recent_donor_365_flag and assigned_flag
            recent_donor_unassigned_flag = recent_donor_365_flag and not assigned_flag

            touch_coverage_bucket = self._touch_coverage_bucket(
                recent_donor_365_flag=recent_donor_365_flag,
                touched_90_flag=touched_90_flag,
            )
            opportunity_bucket = self._opportunity_bucket(
                recent_donor_365_flag=recent_donor_365_flag,
                touched_90_flag=touched_90_flag,
                assigned_flag=assigned_flag,
                lapsed_donor_366_730_flag=lapsed_donor_366_730_flag,
                lifetime_donor_flag=lifetime_donor_flag,
            )

            detail_records.append(
                {
                    "contact_id": contact_id,
                    "contact_individual_id": safe_int(alumni_row.get("id")),
                    "full_name": contact.get("name") or self._full_name(individual),
                    "first_name": individual.get("firstName") or "",
                    "last_name": individual.get("lastName") or "",
                    "raw_class_year": class_year,
                    "class_year": class_year,
                    "class_year_issue": None,
                    "cohort_label": cohort_label,
                    "decade": self._decade_label(class_year),
                    "degree": degree,
                    "major": major,
                    "contact_type": contact.get("contactType"),
                    "assigned_solicitor_group": " | ".join(assigned_groups) if assigned_groups else "Unassigned",
                    "assigned_flag": assigned_flag,
                    "assignment_status": "Assigned" if assigned_flag else "Unassigned",
                    "is_deceased": is_deceased,
                    "do_not_contact": do_not_contact,
                    "do_not_phone": do_not_phone,
                    "do_not_call_tag": do_not_call_tag,
                    "life_to_date_giving": coerce_decimal_text(life_to_date_giving),
                    "year_to_date_giving": coerce_decimal_text(year_to_date_giving),
                    "last_gift_amount": coerce_decimal_text(last_gift_amount),
                    "last_gift_date": iso_date(gift_metrics["last_gift_date"]),
                    "lifetime_donor_flag": lifetime_donor_flag,
                    "ytd_donor_flag": ytd_donor_flag,
                    "recent_donor_90_flag": recent_donor_90_flag,
                    "recent_donor_365_flag": recent_donor_365_flag,
                    "lapsed_donor_366_730_flag": lapsed_donor_366_730_flag,
                    "inactive_donor_over_730_flag": inactive_donor_over_730_flag,
                    "never_donor_flag": never_donor_flag,
                    "donor_recency_bucket": donor_recency_bucket,
                    "giving_last_365_total": coerce_decimal_text(gift_metrics["giving_total_365"]),
                    "giving_last_365_count": gift_metrics["giving_count_365"],
                    "giving_last_90_total": coerce_decimal_text(gift_metrics["giving_total_90"]),
                    "giving_last_90_count": gift_metrics["giving_count_90"],
                    "largest_recent_gift": coerce_decimal_text(gift_metrics["largest_recent_gift"]),
                    "active_recurring_flag": bool(recurring),
                    "active_recurring_amount": coerce_decimal_text(recurring_amount),
                    "planned_giving_flag": bool(planned),
                    "planned_giving_count": len(planned),
                    "planned_giving_amount": coerce_decimal_text(planned_amount),
                    "last_touch_date": iso_date(note_metrics["last_touch_date"]),
                    "touch_count_365": note_metrics["touch_count_365"],
                    "touch_count_90": note_metrics["touch_count_90"],
                    "outreach_attempt_count_90": note_metrics["outreach_attempt_count_90"],
                    "connected_touch_count_90": note_metrics["connected_touch_count_90"],
                    "touched_90_flag": touched_90_flag,
                    "touched_365_flag": touched_365_flag,
                    "outreach_attempt_90_flag": outreach_attempt_90_flag,
                    "connected_conversation_90_flag": connected_conversation_90_flag,
                    "touch_coverage_bucket": touch_coverage_bucket,
                    "last_event_date": iso_date(event_metrics["last_event_date"]),
                    "event_count_365": event_metrics["event_count_365"],
                    "last_volunteer_date": iso_date(volunteer_metrics["last_volunteer_date"]),
                    "volunteer_count_365": volunteer_metrics["volunteer_count_365"],
                    "recent_donor_touched_90_flag": recent_donor_touched_90_flag,
                    "recent_donor_untouched_90_flag": recent_donor_untouched_90_flag,
                    "recent_donor_assigned_flag": recent_donor_assigned_flag,
                    "recent_donor_unassigned_flag": recent_donor_unassigned_flag,
                    "opportunity_bucket": opportunity_bucket,
                    "priority_rank": self._priority_rank(opportunity_bucket),
                }
            )

        detail_records.sort(
            key=lambda row: (
                row.get("priority_rank") or 99,
                row.get("class_year") or "",
                row.get("last_name") or "",
                row.get("first_name") or "",
            )
        )
        return detail_records

    def _build_payloads(
        self,
        detail_records: list[dict[str, Any]],
        artifacts: SyncArtifacts,
        *,
        today: dt.date,
    ) -> dict[str, Any]:
        return {
            "summary": self._summary_payload(detail_records),
            "trends": self._trends_payload(detail_records, artifacts, today=today),
            "cohorts": self._cohorts_payload(detail_records),
            "leaders": self._leaders_payload(detail_records, artifacts, today=today),
            "segment_index": self._segment_index_payload(detail_records, artifacts, today=today),
        }

    def _summary_payload(self, detail_records: list[dict[str, Any]]) -> dict[str, Any]:
        total = len(detail_records)
        lifetime_donors = sum(1 for row in detail_records if row["lifetime_donor_flag"])
        ytd_donors = sum(1 for row in detail_records if row["ytd_donor_flag"])
        recent_donors_365 = sum(1 for row in detail_records if row["recent_donor_365_flag"])
        recent_donors_90 = sum(1 for row in detail_records if row["recent_donor_90_flag"])
        lapsed_donors = sum(1 for row in detail_records if row["lapsed_donor_366_730_flag"])
        touched_90 = sum(1 for row in detail_records if row["touched_90_flag"])
        recent_donors_touched = sum(1 for row in detail_records if row["recent_donor_touched_90_flag"])
        recent_donors_untouched = sum(1 for row in detail_records if row["recent_donor_untouched_90_flag"])
        assigned_recent_donors = sum(1 for row in detail_records if row["recent_donor_assigned_flag"])
        unassigned_recent_donors = sum(1 for row in detail_records if row["recent_donor_unassigned_flag"])
        active_recurring = sum(1 for row in detail_records if row["active_recurring_flag"])
        planned_giving = sum(1 for row in detail_records if row["planned_giving_flag"])

        def pct(part: int, whole: int) -> str:
            return f"{round((part / whole) * 100, 1)}%" if whole else "0%"

        return {
            "cards": [
                {
                    "id": "alumni_base",
                    "label": "Alumni Base",
                    "value": total,
                    "context": "graduated primary alumni contacts",
                },
                {
                    "id": "lifetime_donors",
                    "label": "Lifetime Donors",
                    "value": lifetime_donors,
                    "context": pct(lifetime_donors, total),
                },
                {
                    "id": "ytd_donors",
                    "label": "YTD Donors",
                    "value": ytd_donors,
                    "context": pct(ytd_donors, total),
                },
                {
                    "id": "recent_donors_365",
                    "label": "Recent Donors (365)",
                    "value": recent_donors_365,
                    "context": pct(recent_donors_365, total),
                },
                {
                    "id": "recent_donors_90",
                    "label": "Recent Donors (90)",
                    "value": recent_donors_90,
                    "context": pct(recent_donors_90, total),
                },
                {
                    "id": "lapsed_donors_366_730",
                    "label": "Lapsed Donors (366-730)",
                    "value": lapsed_donors,
                    "context": pct(lapsed_donors, total),
                },
                {
                    "id": "touched_90",
                    "label": "Touched in 90 Days",
                    "value": touched_90,
                    "context": pct(touched_90, total),
                },
                {
                    "id": "recent_donors_touched_90",
                    "label": "Recent Donors Touched 90",
                    "value": recent_donors_touched,
                    "context": pct(recent_donors_touched, recent_donors_365),
                },
                {
                    "id": "recent_donors_untouched_90",
                    "label": "Recent Donors Untouched 90",
                    "value": recent_donors_untouched,
                    "context": pct(recent_donors_untouched, recent_donors_365),
                },
                {
                    "id": "assigned_recent_donors",
                    "label": "Assigned Recent Donors",
                    "value": assigned_recent_donors,
                    "context": pct(assigned_recent_donors, recent_donors_365),
                },
                {
                    "id": "unassigned_recent_donors",
                    "label": "Unassigned Recent Donors",
                    "value": unassigned_recent_donors,
                    "context": pct(unassigned_recent_donors, recent_donors_365),
                },
                {
                    "id": "active_recurring",
                    "label": "Active Recurring",
                    "value": active_recurring,
                    "context": pct(active_recurring, total),
                },
                {
                    "id": "planned_giving",
                    "label": "Planned Giving",
                    "value": planned_giving,
                    "context": pct(planned_giving, total),
                },
            ]
        }

    def _trends_payload(
        self,
        detail_records: list[dict[str, Any]],
        artifacts: SyncArtifacts,
        *,
        today: dt.date,
    ) -> dict[str, Any]:
        months = rolling_month_starts(today, 12)
        labels = [month.isoformat() for month in months]

        gift_totals = {month: Decimal("0") for month in months}
        gift_contacts = {month: set() for month in months}
        for gift in artifacts.gifts:
            gift_date = parse_virt_date(gift.get("giftDate"))
            if not gift_date:
                continue
            bucket = month_start(gift_date)
            if bucket in gift_totals:
                gift_totals[bucket] += parse_currency(gift.get("amount"))
                contact_id = safe_int(gift.get("contactId"))
                if contact_id is not None:
                    gift_contacts[bucket].add(contact_id)

        touch_rows = {month: 0 for month in months}
        touch_contacts = {month: set() for month in months}
        for note in artifacts.notes:
            note_date = parse_virt_date(note.get("noteDate"))
            if not note_date:
                continue
            bucket = month_start(note_date)
            if bucket in touch_rows:
                touch_rows[bucket] += 1
                contact_id = safe_int(note.get("contactId"))
                if contact_id is not None:
                    touch_contacts[bucket].add(contact_id)

        donor_recency_counts = Counter(row["donor_recency_bucket"] for row in detail_records)
        opportunity_counts = Counter(row["opportunity_bucket"] for row in detail_records)

        return {
            "months": labels,
            "monthly_gift_amounts": [coerce_decimal_text(gift_totals[month]) for month in months],
            "monthly_donor_contacts": [len(gift_contacts[month]) for month in months],
            "monthly_touch_rows": [touch_rows[month] for month in months],
            "monthly_touched_contacts": [len(touch_contacts[month]) for month in months],
            "donor_recency_distribution": {
                "labels": DONOR_RECENCY_ORDER,
                "values": [donor_recency_counts[label] for label in DONOR_RECENCY_ORDER],
            },
            "opportunity_distribution": {
                "labels": OPPORTUNITY_BUCKET_ORDER,
                "values": [opportunity_counts[label] for label in OPPORTUNITY_BUCKET_ORDER],
            },
        }

    def _cohorts_payload(self, detail_records: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "class_year": self._cohort_rows(detail_records, "cohort_label"),
            "decade": self._cohort_rows(detail_records, "decade"),
            "donor_recency_bucket": self._cohort_rows(
                detail_records,
                "donor_recency_bucket",
                order=DONOR_RECENCY_ORDER,
            ),
            "touch_coverage_bucket": self._cohort_rows(
                detail_records,
                "touch_coverage_bucket",
                order=TOUCH_COVERAGE_ORDER,
            ),
            "assignment_status": self._cohort_rows(
                detail_records,
                "assignment_status",
                order=["Assigned", "Unassigned"],
            ),
            "opportunity_bucket": self._cohort_rows(
                detail_records,
                "opportunity_bucket",
                order=OPPORTUNITY_BUCKET_ORDER,
            ),
        }

    def _leaders_payload(
        self,
        detail_records: list[dict[str, Any]],
        artifacts: SyncArtifacts,
        *,
        today: dt.date,
    ) -> dict[str, Any]:
        cut_90 = today - dt.timedelta(days=90)
        notes_90 = [
            note
            for note in artifacts.notes
            if (parse_virt_date(note.get("noteDate")) or dt.date.min) >= cut_90
        ]
        note_type_counts = Counter(note.get("type") or "Unknown" for note in notes_90)
        note_creator_counts = Counter(note.get("createdByUser") or "Unknown" for note in notes_90)
        gift_segment_counts = Counter(
            gift.get("segment") or "Unknown Segment"
            for gift in artifacts.gifts
            if gift.get("segment")
        )
        solicitor_counts = Counter(
            row["assigned_solicitor_group"]
            for row in detail_records
            if row["recent_donor_365_flag"]
        )
        unassigned_recent_donor_decades = Counter(
            row["decade"] or "Unknown"
            for row in detail_records
            if row["recent_donor_unassigned_flag"]
        )
        unassigned_recent_donor_class_years = Counter(
            row["class_year"] or "Unknown"
            for row in detail_records
            if row["recent_donor_unassigned_flag"]
        )
        return {
            "top_note_types_90": note_type_counts.most_common(12),
            "top_note_creators_90": note_creator_counts.most_common(12),
            "top_gift_segments_365": gift_segment_counts.most_common(12),
            "recent_donor_solicitor_groups": solicitor_counts.most_common(12),
            "unassigned_recent_donor_decades": unassigned_recent_donor_decades.most_common(12),
            "unassigned_recent_donor_class_years": unassigned_recent_donor_class_years.most_common(12),
        }

    def _segment_index_payload(
        self,
        detail_records: list[dict[str, Any]],
        artifacts: SyncArtifacts,
        *,
        today: dt.date,
    ) -> dict[str, Any]:
        detail_contact_ids = {
            contact_id
            for contact_id in (safe_int(row.get("contact_id")) for row in detail_records)
            if contact_id is not None
        }
        months = rolling_month_starts(today, 12)
        month_labels = {month: month.strftime("%b %Y") for month in months}
        gift_contacts = {month: set() for month in months}
        touch_contacts = {month: set() for month in months}
        note_type_contacts: dict[str, set[int]] = defaultdict(set)
        note_creator_contacts: dict[str, set[int]] = defaultdict(set)
        cut_90 = today - dt.timedelta(days=90)

        for gift in artifacts.gifts:
            contact_id = safe_int(gift.get("contactId"))
            gift_date = parse_virt_date(gift.get("giftDate"))
            if contact_id is None or contact_id not in detail_contact_ids or not gift_date:
                continue
            bucket = month_start(gift_date)
            if bucket in gift_contacts:
                gift_contacts[bucket].add(contact_id)

        for note in artifacts.notes:
            contact_id = safe_int(note.get("contactId"))
            note_date = parse_virt_date(note.get("noteDate"))
            if contact_id is None or contact_id not in detail_contact_ids or not note_date:
                continue
            bucket = month_start(note_date)
            if bucket in touch_contacts:
                touch_contacts[bucket].add(contact_id)
            if note_date >= cut_90:
                note_type_contacts[note.get("type") or "Unknown"].add(contact_id)
                note_creator_contacts[note.get("createdByUser") or "Unknown"].add(contact_id)

        segments: dict[str, dict[str, Any]] = {}

        for month in months:
            month_key = month.isoformat()
            segments[f"monthly_gift:{month_key}"] = {
                "title": f"Gifts in {month_labels[month]}",
                "contact_ids": sorted(gift_contacts[month]),
            }
            segments[f"monthly_touch:{month_key}"] = {
                "title": f"Touched alumni in {month_labels[month]}",
                "contact_ids": sorted(touch_contacts[month]),
            }

        for label, contacts in note_type_contacts.items():
            segments[f"leader_note_type_90:{label}"] = {
                "title": f"Top Note Type (90 Days): {label}",
                "contact_ids": sorted(contacts),
            }
        for label, contacts in note_creator_contacts.items():
            segments[f"leader_note_creator_90:{label}"] = {
                "title": f"Top Note Creator (90 Days): {label}",
                "contact_ids": sorted(contacts),
            }

        for row in detail_records:
            contact_id = safe_int(row.get("contact_id"))
            if contact_id is None:
                continue
            if row.get("recent_donor_unassigned_flag"):
                label = row.get("decade") or "Unknown"
                key = f"leader_unassigned_recent_donor_decade:{label}"
                segment = segments.setdefault(
                    key,
                    {
                        "title": f"Unassigned Recent Donor Decade: {label}",
                        "contact_ids": [],
                    },
                )
                segment["contact_ids"].append(contact_id)
            if row.get("recent_donor_365_flag"):
                label = row.get("assigned_solicitor_group") or "Unknown"
                key = f"leader_recent_donor_solicitor_group:{label}"
                segment = segments.setdefault(
                    key,
                    {
                        "title": f"Recent Donor Solicitor Group: {label}",
                        "contact_ids": [],
                    },
                )
                segment["contact_ids"].append(contact_id)

        for segment in segments.values():
            segment["contact_ids"] = sorted({safe_int(contact_id) for contact_id in segment["contact_ids"] if contact_id is not None})

        return {"segments": segments}

    def _write_exports(self, detail_records: list[dict[str, Any]]) -> None:
        if not detail_records:
            return
        fieldnames = list(detail_records[0].keys())
        export_groups = {
            "alumni_detail.csv": detail_records,
            "lifetime_donor_detail.csv": [row for row in detail_records if row["lifetime_donor_flag"]],
            "recent_donor_365_detail.csv": [row for row in detail_records if row["recent_donor_365_flag"]],
            "recent_donor_untouched_90.csv": [row for row in detail_records if row["recent_donor_untouched_90_flag"]],
            "assigned_recent_donors.csv": [row for row in detail_records if row["recent_donor_assigned_flag"]],
            "unassigned_recent_donors.csv": [row for row in detail_records if row["recent_donor_unassigned_flag"]],
            "touched_90.csv": [row for row in detail_records if row["touched_90_flag"]],
        }
        for filename, rows in export_groups.items():
            write_csv(self.config.exports_dir / filename, rows, fieldnames)
        for obsolete_name in (
            "donor_detail.csv",
            "recently_touched.csv",
            "event_engaged.csv",
            "volunteer_engaged.csv",
        ):
            obsolete_path = self.config.exports_dir / obsolete_name
            if obsolete_path.exists():
                obsolete_path.unlink()

    def _publish_site_data(self) -> None:
        exports_publish_dir = self.config.publish_dir / "exports"
        ensure_dir(exports_publish_dir)
        for name in (
            "metadata.json",
            "summary.json",
            "trends.json",
            "cohorts.json",
            "leaders.json",
            "segment_index.json",
            "detail_index.json",
        ):
            source = self.config.derived_dir / name
            target = self.config.publish_dir / name
            target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        for name in (
            "alumni_detail.csv",
            "lifetime_donor_detail.csv",
            "recent_donor_365_detail.csv",
            "recent_donor_untouched_90.csv",
            "assigned_recent_donors.csv",
            "unassigned_recent_donors.csv",
            "touched_90.csv",
        ):
            source = self.config.exports_dir / name
            if source.exists():
                target = exports_publish_dir / name
                target.write_text(source.read_text(encoding="utf-8-sig"), encoding="utf-8-sig")
        for obsolete_name in (
            "donor_detail.csv",
            "recently_touched.csv",
            "event_engaged.csv",
            "volunteer_engaged.csv",
        ):
            obsolete_path = exports_publish_dir / obsolete_name
            if obsolete_path.exists():
                obsolete_path.unlink()

    def _max_modified_date(self, notes: list[dict[str, Any]]) -> dt.date | None:
        max_value: dt.date | None = None
        for note in notes:
            modified = parse_virt_datetime(note.get("modifiedDateTimeUtc"))
            if modified:
                current = modified.date()
                if max_value is None or current > max_value:
                    max_value = current
        return max_value

    def _index_by_contact_id(self, rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
        grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            contact_id = safe_int(row.get("contactId"))
            if contact_id is not None:
                grouped[contact_id].append(row)
        return grouped

    def _find_contact_individual(
        self,
        contact: dict[str, Any],
        alumni_row: dict[str, Any],
    ) -> dict[str, Any]:
        alumni_id = safe_int(alumni_row.get("id"))
        for individual in contact.get("contactIndividuals", []) or []:
            if safe_int(individual.get("id")) == alumni_id:
                return individual
        for individual in contact.get("contactIndividuals", []) or []:
            if individual.get("isPrimary"):
                return individual
        individuals = contact.get("contactIndividuals", []) or []
        return individuals[0] if individuals else {}

    def _custom_field_value(self, fields: list[dict[str, Any]], target_name: str) -> str | None:
        target_lower = target_name.lower()
        for field in fields or []:
            name = (field.get("displayName") or field.get("name") or "").lower()
            if name == target_lower:
                return field.get("value")
        return None

    def _full_name(self, individual: dict[str, Any]) -> str:
        return " ".join(part for part in [individual.get("firstName"), individual.get("lastName")] if part).strip()

    def _decade_label(self, class_year: str | None) -> str | None:
        if not class_year or not str(class_year).isdigit():
            return None
        year = int(class_year)
        decade = year - (year % 10)
        return f"{decade}s"

    def _assigned_solicitor_groups(self, contact: dict[str, Any]) -> list[str]:
        groups: list[str] = []
        for group in contact.get("organizationGroups", []) or []:
            group_name = str(group)
            if group_name != PENDING_GROUP_NAME:
                groups.append(group_name)
        return groups

    def _is_deceased(self, contact: dict[str, Any]) -> bool:
        return any(
            individual.get("isDeceased")
            for individual in (contact.get("contactIndividuals", []) or [])
        )

    def _do_not_flag(self, contact: dict[str, Any], target_name: str) -> bool:
        for field in contact.get("customFields", []) or []:
            name = field.get("displayName") or field.get("name") or ""
            if name == target_name and field_is_set(field.get("value")):
                return True
        return False

    def _has_do_not_call_tag(self, contact: dict[str, Any]) -> bool:
        tags = {str(tag).strip().lower() for tag in (contact.get("tags", []) or [])}
        return "do not call" in tags

    def _gift_metrics(
        self,
        contact: dict[str, Any],
        gifts: list[dict[str, Any]],
        *,
        today: dt.date,
    ) -> dict[str, Any]:
        last_gift_date = parse_virt_date(contact.get("lastGiftDate"))
        gifts_365: list[Decimal] = []
        gifts_90: list[Decimal] = []
        largest_recent = Decimal("0")
        for gift in gifts:
            gift_date = parse_virt_date(gift.get("giftDate"))
            if not gift_date:
                continue
            amount = parse_currency(gift.get("amount"))
            if amount > largest_recent:
                largest_recent = amount
            if gift_date >= today - dt.timedelta(days=365):
                gifts_365.append(amount)
            if gift_date >= today - dt.timedelta(days=90):
                gifts_90.append(amount)
            if last_gift_date is None or gift_date > last_gift_date:
                last_gift_date = gift_date
        return {
            "last_gift_date": last_gift_date,
            "giving_total_365": sum(gifts_365, Decimal("0")),
            "giving_count_365": len(gifts_365),
            "giving_total_90": sum(gifts_90, Decimal("0")),
            "giving_count_90": len(gifts_90),
            "largest_recent_gift": largest_recent,
        }

    def _note_metrics(self, notes: list[dict[str, Any]], *, today: dt.date) -> dict[str, Any]:
        cut_365 = today - dt.timedelta(days=365)
        cut_90 = today - dt.timedelta(days=90)
        last_touch: dt.date | None = None
        count_365 = 0
        count_90 = 0
        outreach_attempt_count_90 = 0
        connected_touch_count_90 = 0
        for note in notes:
            note_date = parse_virt_date(note.get("noteDate"))
            if not note_date:
                continue
            note_type = note.get("type") or "Unknown"
            if last_touch is None or note_date > last_touch:
                last_touch = note_date
            if note_date >= cut_365:
                count_365 += 1
            if note_date >= cut_90:
                count_90 += 1
                if note_type in OUTREACH_ATTEMPT_TYPES:
                    outreach_attempt_count_90 += 1
                if note_type in CONNECTED_TOUCH_TYPES:
                    connected_touch_count_90 += 1
        return {
            "last_touch_date": last_touch,
            "touch_count_365": count_365,
            "touch_count_90": count_90,
            "outreach_attempt_count_90": outreach_attempt_count_90,
            "connected_touch_count_90": connected_touch_count_90,
        }

    def _event_metrics(self, events: list[dict[str, Any]], *, today: dt.date) -> dict[str, Any]:
        last_event: dt.date | None = None
        count_365 = 0
        for event in events:
            event_date = parse_virt_date(event.get("startDateTime"))
            if not event_date:
                continue
            if last_event is None or event_date > last_event:
                last_event = event_date
            if event_date >= today - dt.timedelta(days=365):
                count_365 += 1
        return {"last_event_date": last_event, "event_count_365": count_365}

    def _volunteer_metrics(self, rows: list[dict[str, Any]], *, today: dt.date) -> dict[str, Any]:
        last_date: dt.date | None = None
        count_365 = 0
        for row in rows:
            volunteer_date = parse_virt_date(row.get("volunteerOpportunityStartDate"))
            if not volunteer_date:
                continue
            if last_date is None or volunteer_date > last_date:
                last_date = volunteer_date
            if volunteer_date >= today - dt.timedelta(days=365):
                count_365 += 1
        return {"last_volunteer_date": last_date, "volunteer_count_365": count_365}

    def _recurring_amount(self, rows: list[dict[str, Any]]) -> Decimal:
        total = Decimal("0")
        for row in rows:
            total += parse_currency(row.get("amount"))
        return total

    def _planned_amount(self, rows: list[dict[str, Any]]) -> Decimal:
        total = Decimal("0")
        for row in rows:
            total += parse_currency(row.get("anticipatedAmount"))
        return total

    def _donor_recency_bucket(
        self,
        last_gift_date: dt.date | None,
        life_to_date_giving: Decimal,
        *,
        today: dt.date,
    ) -> str:
        if last_gift_date is None and life_to_date_giving <= 0:
            return "Never gave"
        if last_gift_date is None:
            return "Gave >730 days ago"
        days_since = (today - last_gift_date).days
        if days_since <= 90:
            return "Gave in last 90 days"
        if days_since <= 365:
            return "Gave in last 365 days"
        if days_since <= 730:
            return "Gave 366-730 days ago"
        return "Gave >730 days ago"

    def _touch_coverage_bucket(
        self,
        *,
        recent_donor_365_flag: bool,
        touched_90_flag: bool,
    ) -> str:
        if recent_donor_365_flag and touched_90_flag:
            return "Recent donor touched in 90 days"
        if recent_donor_365_flag and not touched_90_flag:
            return "Recent donor untouched in 90 days"
        if touched_90_flag:
            return "Non-recent donor touched in 90 days"
        return "No touch in 90 days"

    def _opportunity_bucket(
        self,
        *,
        recent_donor_365_flag: bool,
        touched_90_flag: bool,
        assigned_flag: bool,
        lapsed_donor_366_730_flag: bool,
        lifetime_donor_flag: bool,
    ) -> str:
        if recent_donor_365_flag and not touched_90_flag and not assigned_flag:
            return "Recent donor, untouched, unassigned"
        if recent_donor_365_flag and not touched_90_flag and assigned_flag:
            return "Recent donor, untouched, assigned"
        if recent_donor_365_flag and touched_90_flag and not assigned_flag:
            return "Recent donor, touched, unassigned"
        if recent_donor_365_flag and touched_90_flag and assigned_flag:
            return "Recent donor, touched, assigned"
        if lapsed_donor_366_730_flag:
            return "Lapsed donor (366-730 days)"
        if lifetime_donor_flag:
            return "Inactive donor (>730 days)"
        if touched_90_flag:
            return "Never donor, touched in 90 days"
        return "Never donor, untouched"

    def _priority_rank(self, label: str) -> int:
        try:
            return OPPORTUNITY_BUCKET_ORDER.index(label) + 1
        except ValueError:
            return 99

    def _cohort_rows(
        self,
        detail_records: list[dict[str, Any]],
        key: str,
        *,
        order: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in detail_records:
            label = row.get(key)
            if label:
                grouped[str(label)].append(row)
        labels = order or sorted(grouped)
        rows_out: list[dict[str, Any]] = []
        for label in labels:
            rows = grouped.get(label, [])
            if not rows:
                continue
            rows_out.append(
                {
                    "label": label,
                    "alumni_count": len(rows),
                    "lifetime_donor_count": sum(1 for row in rows if row["lifetime_donor_flag"]),
                    "ytd_donor_count": sum(1 for row in rows if row["ytd_donor_flag"]),
                    "recent_donor_90_count": sum(1 for row in rows if row["recent_donor_90_flag"]),
                    "recent_donor_365_count": sum(1 for row in rows if row["recent_donor_365_flag"]),
                    "lapsed_donor_366_730_count": sum(
                        1 for row in rows if row["lapsed_donor_366_730_flag"]
                    ),
                    "touched_90_count": sum(1 for row in rows if row["touched_90_flag"]),
                    "recent_donor_touched_90_count": sum(
                        1 for row in rows if row["recent_donor_touched_90_flag"]
                    ),
                    "recent_donor_untouched_90_count": sum(
                        1 for row in rows if row["recent_donor_untouched_90_flag"]
                    ),
                    "assigned_count": sum(1 for row in rows if row["assigned_flag"]),
                    "unassigned_count": sum(1 for row in rows if not row["assigned_flag"]),
                }
            )
        return rows_out
