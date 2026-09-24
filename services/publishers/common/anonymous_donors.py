"""Virtuous "Anonymous Donor" contact tag.

Virtuous CRM gifts carry no anonymity flag; Advancement marks anonymous donors
with this contact tag. Publishers stamp ``anonymousDonor`` on every named gift
row and the reporting API hides names from non-Advancement viewers unless the
flag is exactly False. ``None`` from the lookup means "unknown": every row is
then flagged anonymous (fail closed).
"""
from __future__ import annotations

from typing import Any, Iterable

ANONYMOUS_DONOR_TAG = "Anonymous Donor"
CONTACT_QUERY_PATH = "/api/Contact/Query"
# Tag is a list field on Contact Query: IsAnyOf/IsNoneOf with a values list only.
TAG_QUERY = {
    "groups": [{"conditions": [
        {"parameter": "Tag", "operator": "IsAnyOf", "values": [ANONYMOUS_DONOR_TAG]},
    ]}],
}


def anonymous_contact_ids(client: Any) -> frozenset[str] | None:
    """Contact IDs tagged ANONYMOUS_DONOR_TAG, or None when unknown.

    The tag is in use, so an empty result is treated as a failed lookup.
    ``client.paged_query(path, body)`` must return the list of contacts.
    """
    try:
        rows = client.paged_query(CONTACT_QUERY_PATH, TAG_QUERY)
    except Exception as exc:  # noqa: BLE001
        print(f"  anonymous donor tag query failed: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
        return None
    ids = frozenset(str(r["id"]) for r in rows if r.get("id") is not None)
    if not ids:
        print("  anonymous donor tag query returned no contacts", flush=True)
        return None
    print(f"  anonymous donor contacts={len(ids)}", flush=True)
    return ids


def gift_contact_ids(record: dict[str, Any]) -> set[str]:
    """contactId plus any passthrough contactIds on a gift or designation."""
    ids = {str(record["contactId"])} if record.get("contactId") is not None else set()
    for passthrough in record.get("giftPassthroughs") or []:
        if passthrough.get("contactId") is not None:
            ids.add(str(passthrough["contactId"]))
    return ids


def is_anonymous_donor(contact_ids: Iterable[str], anonymous_ids: frozenset[str] | None) -> bool:
    if anonymous_ids is None:
        return True
    return bool(set(contact_ids) & anonymous_ids)
