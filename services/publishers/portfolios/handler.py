"""Portfolio-segment publisher.

Builds ``portfolios/latest.json`` from live Virtuous organization groups,
Prospect Pipeline tags, last gift date, and the latest Contact Note per
solicitor ``createdByUser``.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

CACHE_KEY = os.environ.get("PORTFOLIOS_CACHE_KEY") or "portfolios/latest.json"
CONTACT_VIEW = "https://app.virtuoussoftware.com/Generosity/Contact/View"
GROUP_PATH = "/api/OrganizationGroup"
FULL_CONTACT = "/api/Contact/Query/FullContact"
NOTE_QUERY = "/api/ContactNote/Query"
NOTE_OPTIONS = "/api/ContactNote/QueryOptions"
RETRYABLE = {429, 500, 502, 503, 504}

CREATED_BY_CANDIDATES = ("Created By", "Created By User", "CreatedByUser", "Creator")

MGO_STAGES = [
    ("identification", "Identification", {74}, {"identification"}),
    ("cultivation", "Cultivation", {75}, {"cultivation"}),
    ("solicitation", "Solicitation", {76}, {"solicitation"}),
    ("stewardship", "Stewardship", {77}, {"stewardship"}),
]
MA_STAGES = [
    ("engagement", "Engagement", {82}, {"engagement", "engage"}),
    ("reactivate", "Reactivate", {83}, {"reactivate"}),
    ("renewal", "Renewal", {84}, {"renewal"}),
    ("stewardship", "Stewardship", {85}, {"stewardship"}),
]
UNTAGGED = ("untagged", "Untagged", set(), set())

MGO_RELATIONSHIPS = [
    "Current",
    "Lapsed",
    "Prospect",
    "Estate Prospect",
    "Estate Donor",
    "Foundation Relationship",
    "Personal Relationship",
]
MA_RELATIONSHIPS = ["Current", "First Time", "Lapsed", "Prospect"]
IGNORED_TAG_IDS = {46}
IGNORED_TAG_NAMES = {"ma engaged"}

ROSTER: list[dict[str, Any]] = [
    {
        "name": "Beatrice Sanford",
        "email": "beatrice.sanford@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Beatrice Sanford",
        "createdByUser": "Beatrice Sanford",
    },
    {
        "name": "Brigid Luzarraga",
        "email": "brigid.luzarraga@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Brigid Luzarraga",
        "createdByUser": "Brigid Luzarraga",
    },
    {
        "name": "Colleen M. Dolnick",
        "email": "colleen.dolnick@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Colleen M. Dolnick",
        "createdByUser": "Colleen Dolnick",
    },
    {
        "name": "James Thomas",
        "email": "jim.thomas@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - James Thomas",
        "createdByUser": "Jim Thomas",
    },
    {
        "name": "Julie Musselman",
        "email": "julie.musselman@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Julie Musselman",
        "createdByUser": "Julie Musselman",
    },
    {
        "name": "Marita N. Emond",
        "email": "marita.emond@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Marita N. Emond",
        "createdByUser": "Marita Emond",
    },
    {
        "name": "Mark J. Middendorf",
        "email": "mark.middendorf@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Mark J. Middendorf",
        "createdByUser": "Mark Middendorf",
    },
    {
        "name": "Matthew Buzzanca",
        "email": "matthew.buzzanca@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Matthew Buzzanca",
        "createdByUser": "Matthew Buzzanca",
    },
    {
        "name": "Patrick J. O'Connell",
        "email": "patrick.oconnell@avemaria.edu",
        "team": "mgo",
        "groupName": "Portfolio - Patrick J. O'Connell",
        "createdByUser": "Patrick OConnell",
    },
    {
        "name": "Alanna McCann",
        "email": "alanna.f.mccann@avemaria.edu",
        "team": "ma",
        "groupName": "MA Portfolio - Alanna",
        "createdByUser": "Alanna McCann",
    },
    {
        "name": "Betsy Scaletty",
        "email": "betsy.scaletty@avemaria.edu",
        "team": "ma",
        "groupName": "MA Portfolio - Betsy",
        "createdByUser": "Betsy Scaletty",
    },
    {
        "name": "Caleb Metzen",
        "email": "caleb.m.metzen@avemaria.edu",
        "team": "ma",
        "groupName": "MA Portfolio - Caleb",
        "createdByUser": "Caleb Metzen",
    },
    {
        "name": "Elena Barnes",
        "email": "elena.j.barnes@avemaria.edu",
        "team": "ma",
        "groupName": "MA Portfolio - Elena",
        "createdByUser": "Elena Barnes",
    },
    {
        "name": "Joseph Blaso",
        "email": "joseph.c.blaso@avemaria.edu",
        "team": "ma",
        "groupName": "MA Portfolio - Joseph",
        "createdByUser": "Joseph Blaso",
    },
    {
        "name": "Natalia Abrams",
        "email": "natalia.p.abrams@avemaria.edu",
        "team": "ma",
        "groupName": "MA Portfolio - Natalia",
        "createdByUser": "Natalia Abrams",
    },
    {
        "name": "Sean Kelly",
        "email": "sean.e.kelly@avemaria.edu",
        "team": "ma",
        "groupName": "MA Portfolio - Sean",
        "createdByUser": "Sean Kelly",
    },
]


class VirtuousHttpError(RuntimeError):
    def __init__(self, path: str, code: int, detail: str):
        super().__init__(f"Virtuous {path} → {code}: {detail}")
        self.path = path
        self.code = code
        self.detail = detail


class VirtuousClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def paged_query(self, path: str, body: dict[str, Any], page_size: int = 1000) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        while True:
            payload = self._request("POST", path, body, {"skip": skip, "take": page_size})
            batch = payload.get("list") or []
            total = int(payload.get("total") or 0)
            rows.extend(batch)
            skip += page_size
            if not batch or skip >= total:
                break
        return rows

    def paged_get(self, path: str, page_size: int = 1000) -> list[dict]:
        rows: list[dict] = []
        skip = 0
        while True:
            payload = self._request("GET", path, None, {"skip": skip, "take": page_size})
            batch = payload.get("list") or []
            total = int(payload.get("total") or 0)
            rows.extend(batch)
            skip += page_size
            if not batch or skip >= total:
                break
        return rows

    def get(self, path: str) -> Any:
        return self._request("GET", path, None, {})

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        qs = urllib.parse.urlencode(params) if params else ""
        url = f"{self.base_url}{path}"
        if qs:
            url = f"{url}?{qs}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        for attempt in range(6):
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method=method,
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code in RETRYABLE and attempt < 5:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                detail = exc.read().decode("utf-8", errors="replace")[:500]
                raise VirtuousHttpError(path, exc.code, detail) from exc
        raise RuntimeError(f"Virtuous {path} failed after retries")


_APOS = dict.fromkeys(map(ord, "‘’ʼ`"), ord("'"))


def _norm_group(name: str) -> str:
    n = (name or "").replace("–", "-").replace("—", "-").translate(_APOS)
    return " ".join(n.split())


def is_mgo_portfolio(name: str) -> bool:
    n = _norm_group(name).lower()
    if n.startswith("ma portfolio"):
        return False
    return n.startswith("portfolio -")


def is_ma_portfolio(name: str) -> bool:
    return _norm_group(name).lower().startswith("ma portfolio -")


def is_portfolio_group(name: str) -> bool:
    return is_mgo_portfolio(name) or is_ma_portfolio(name)


def _fold(value: Any) -> str:
    return " ".join(str(value or "").split()).lower()


def _leaf_tag_name(name: Any) -> str:
    folded = _fold(name)
    for prefix in ("mgo:", "ma:"):
        if folded.startswith(prefix):
            return folded[len(prefix) :].strip()
    return folded


def split_creator_name(created_by_user: str) -> tuple[str, str]:
    text = " ".join((created_by_user or "").split())
    if not text:
        return "", ""
    first, _sep, last = text.partition(" ")
    return first, last.strip()


def _parse_date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    if "T" in text:
        text = text.split("T", 1)[0]
    if " " in text:
        text = text.split(" ", 1)[0]
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _contact_url(cid: Any) -> str | None:
    if cid is None or cid == "":
        return None
    return f"{CONTACT_VIEW}/{cid}"


def _iter_tags(contact: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key in ("tags", "contactTags"):
        for tag in contact.get(key) or []:
            if isinstance(tag, str):
                out.append({"id": None, "name": tag})
                continue
            if not isinstance(tag, dict):
                continue
            name = tag.get("tagName") or tag.get("name") or tag.get("tag") or ""
            tid = tag.get("tagId")
            if tid is None:
                tid = tag.get("id")
            try:
                tid_i = int(tid) if tid is not None and str(tid).strip() != "" else None
            except (TypeError, ValueError):
                tid_i = None
            out.append(
                {
                    "id": tid_i,
                    "name": str(name).strip(),
                    "group": tag.get("tagGroupName") or tag.get("tagGroup") or "",
                }
            )
    return out


def _ignored(tag: dict[str, Any]) -> bool:
    if tag.get("id") in IGNORED_TAG_IDS:
        return True
    return _fold(tag.get("name")) in IGNORED_TAG_NAMES


def _in_pipeline(tag: dict[str, Any]) -> bool:
    group = _fold(tag.get("group"))
    return not group or group == "prospect pipeline"


def classify_stage(team: str, tags: list[dict[str, Any]]) -> tuple[str, str]:
    defs = MA_STAGES if team == "ma" else MGO_STAGES
    live = [t for t in tags if not _ignored(t) and _in_pipeline(t)]
    for key, label, ids, _names in defs:
        for tag in live:
            if tag.get("id") in ids:
                return key, label
    for key, label, _ids, names in defs:
        for tag in live:
            if _leaf_tag_name(tag.get("name")) in names:
                return key, label
    return UNTAGGED[0], UNTAGGED[1]


def classify_relationships(team: str, tags: list[dict[str, Any]]) -> list[str]:
    allowed = MA_RELATIONSHIPS if team == "ma" else MGO_RELATIONSHIPS
    found: set[str] = set()
    for tag in tags:
        if _ignored(tag) or not _in_pipeline(tag):
            continue
        name = _leaf_tag_name(tag.get("name"))
        for label in allowed:
            if _fold(label) == name:
                found.add(label)
    return [label for label in allowed if label in found]


def donor_sort_key(donor: dict[str, Any]) -> tuple[int, str, str]:
    date = donor.get("lastActivityDate") or ""
    name = (donor.get("donorName") or "").lower()
    if not date:
        return (0, "", name)
    return (1, date, name)


def _project_donor(
    contact: dict[str, Any],
    team: str,
    activity: dict[int, dict[str, str | None]] | None,
) -> dict[str, Any] | None:
    cid_raw = contact.get("id") or contact.get("contactId")
    if cid_raw is None or str(cid_raw).strip() == "":
        return None
    try:
        cid = int(cid_raw)
    except (TypeError, ValueError):
        return None
    tags = _iter_tags(contact)
    stage_key, stage_label = classify_stage(team, tags)
    act = (activity or {}).get(cid) or {}
    name = " ".join(
        str(contact.get("name") or contact.get("formalContactName") or contact.get("contactName") or "").split()
    )
    return {
        "contactId": cid,
        "donorName": name or f"Contact {cid}",
        "contactUrl": _contact_url(cid),
        "stage": stage_label,
        "stageKey": stage_key,
        "relationship": classify_relationships(team, tags),
        "lastGiftDate": _parse_date(contact.get("lastGiftDate")),
        "lastActivityDate": act.get("date"),
        "lastActivityBy": act.get("by"),
    }


def empty_stages(team: str) -> list[dict[str, Any]]:
    defs = list(MA_STAGES if team == "ma" else MGO_STAGES) + [UNTAGGED]
    return [{"key": k, "label": lab, "donorCount": 0, "donors": []} for k, lab, *_ in defs]


def _bucket_donors(team: str, donors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stages = empty_stages(team)
    by_key = {s["key"]: s for s in stages}
    for donor in donors:
        key = donor.pop("stageKey", None) or "untagged"
        bucket = by_key.get(key) or by_key["untagged"]
        bucket["donors"].append(donor)
    out = []
    for stage in stages:
        stage["donors"].sort(key=donor_sort_key)
        stage["donorCount"] = len(stage["donors"])
        if stage["donorCount"] == 0:
            continue
        out.append(stage)
    return out


def build_snapshot(
    roster: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    contacts_by_group: dict[Any, list[dict[str, Any]]],
    activity_by_user: dict[str, dict[int, dict[str, str | None]]],
    generated_at: str | None = None,
) -> dict[str, Any]:
    groups_by_norm = {_norm_group(g.get("name") or "").lower(): g for g in groups if g.get("name")}
    used_group_ids: set[Any] = set()
    solicitors: list[dict[str, Any]] = []

    for person in roster:
        team = person["team"]
        group_name = person["groupName"]
        live = groups_by_norm.get(_norm_group(group_name).lower())
        gid = live.get("id") if live else None
        if gid is not None:
            used_group_ids.add(gid)
        contacts = contacts_by_group.get(gid, []) if gid is not None else []
        created = person.get("createdByUser") or person["name"]
        donors = [
            d
            for d in (_project_donor(c, team, activity_by_user.get(created)) for c in contacts)
            if d
        ]
        stages = _bucket_donors(team, donors)
        solicitors.append(
            {
                "id": person["email"],
                "name": person["name"],
                "email": person["email"],
                "team": team,
                "groupName": (live.get("name") if live else group_name),
                "groupId": gid,
                "donorCount": sum(s["donorCount"] for s in stages),
                "createdByUser": created,
                "stages": stages,
            }
        )

    for g in groups:
        gid = g.get("id")
        if gid in used_group_ids:
            continue
        raw = g.get("name") or ""
        team = "ma" if is_ma_portfolio(raw) else "mgo"
        contacts = contacts_by_group.get(gid, [])
        donors = [d for d in (_project_donor(c, team, None) for c in contacts) if d]
        stages = _bucket_donors(team, donors)
        solicitors.append(
            {
                "id": f"group-{gid}",
                "name": raw,
                "email": "",
                "team": team,
                "groupName": raw,
                "groupId": gid,
                "donorCount": sum(s["donorCount"] for s in stages),
                "createdByUser": None,
                "stages": stages,
            }
        )

    return {
        "generated_at": generated_at or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "virtuous",
        "definition": (
            "MGO and MA portfolio contacts from Virtuous organization groups, "
            "staged by Prospect Pipeline tags, with last gift and last Contact Note "
            "by that solicitor."
        ),
        "solicitors": solicitors,
    }


def discover_created_by_param(client: VirtuousClient) -> str | None:
    try:
        payload = client.get(NOTE_OPTIONS)
    except Exception as exc:  # noqa: BLE001
        print(f"  ContactNote QueryOptions failed: {exc}", flush=True)
        return None
    options = payload.get("options") if isinstance(payload, dict) else payload
    names: list[str] = []
    if isinstance(options, list):
        for opt in options:
            if isinstance(opt, dict) and opt.get("parameter"):
                names.append(str(opt["parameter"]))
    print(f"  ContactNote QueryOptions parameters: {names}", flush=True)
    folded = {_fold(n): n for n in names}
    for cand in CREATED_BY_CANDIDATES:
        if _fold(cand) in folded:
            return folded[_fold(cand)]
    for n in names:
        f = _fold(n)
        if "creat" in f and "by" in f:
            return n
        if f == "creator":
            return n
    return None


def _note_activity(notes: list[dict[str, Any]], created_by: str) -> dict[int, dict[str, str | None]]:
    latest: dict[int, dict[str, str | None]] = {}
    for note in notes:
        if (note.get("createdByUser") or "") != created_by:
            continue
        cid_raw = note.get("contactId")
        if cid_raw is None:
            continue
        try:
            cid = int(cid_raw)
        except (TypeError, ValueError):
            continue
        date = _parse_date(note.get("noteDate") or note.get("noteDateTime") or note.get("createDateTimeUtc"))
        prev = latest.get(cid)
        if prev is None or (date or "") > (prev.get("date") or ""):
            latest[cid] = {
                "date": date,
                "by": created_by or None,
            }
    return latest


def fetch_activity_for_users(client: VirtuousClient, users: list[str]) -> dict[str, dict[int, dict[str, str | None]]]:
    activity: dict[str, dict[int, dict[str, str | None]]] = {u: {} for u in users}
    if not users:
        return activity
    discover_created_by_param(client)
    for user in users:
        first, last = split_creator_name(user)
        body = {
            "groups": [
                {
                    "conditions": [
                        {"parameter": "Creator First Name", "operator": "Is", "value": first},
                        {"parameter": "Creator Last Name", "operator": "Is", "value": last},
                    ]
                }
            ]
        }
        try:
            notes = client.paged_query(NOTE_QUERY, body, 1000)
        except VirtuousHttpError as exc:
            print(
                f"  notes query Creator First/Last={first!r}/{last!r} for {user!r} "
                f"failed ({exc.code}); continuing",
                flush=True,
            )
            continue
        activity[user] = _note_activity(notes, user)
        print(
            f"  notes for {user}: {len(notes)} fetched, {len(activity[user])} contacts after stamp filter",
            flush=True,
        )
    return activity


def _full_contacts_for_group(client: VirtuousClient, group: dict[str, Any]) -> list[dict[str, Any]]:
    name = group.get("name") or ""
    gid = group.get("id")
    body = {
        "groups": [
            {
                "conditions": [
                    {"parameter": "Organization Group", "operator": "Is", "value": name},
                ]
            }
        ]
    }
    try:
        return client.paged_query(FULL_CONTACT, body, 1000)
    except VirtuousHttpError as exc:
        print(f"  FullContact by group name failed for {name!r}: {exc.code}", flush=True)
    if gid is None:
        return []
    members = client.paged_get(f"{GROUP_PATH}/{gid}/contacts", 1000)
    ids: list[int] = []
    for m in members:
        cid = m.get("contactId") or m.get("id")
        if cid is None:
            continue
        try:
            ids.append(int(cid))
        except (TypeError, ValueError):
            continue
    contacts: list[dict[str, Any]] = []
    unique = sorted(set(ids))
    for i in range(0, len(unique), 40):
        batch = unique[i : i + 40]
        groups = [
            {"conditions": [{"parameter": "Contact Id", "operator": "Is", "value": str(cid)}]}
            for cid in batch
        ]
        contacts.extend(client.paged_query(FULL_CONTACT, {"groups": groups}, 200))
    return contacts


def fetch_snapshot(client: VirtuousClient) -> dict[str, Any]:
    print("  fetching organization groups…", flush=True)
    groups = [g for g in client.paged_get(GROUP_PATH, 1000) if is_portfolio_group(g.get("name") or "")]
    print(f"  portfolio groups: {len(groups)}", flush=True)

    contacts_by_group: dict[Any, list[dict[str, Any]]] = {}
    for g in groups:
        rows = _full_contacts_for_group(client, g)
        contacts_by_group[g.get("id")] = rows
        print(f"    {g.get('name')}: {len(rows)} contacts", flush=True)

    users = sorted({p["createdByUser"] for p in ROSTER if p.get("createdByUser")})
    print(f"  fetching contact notes for {len(users)} createdByUser values…", flush=True)
    activity = fetch_activity_for_users(client, users)

    snapshot = build_snapshot(ROSTER, groups, contacts_by_group, activity)
    total = sum(s["donorCount"] for s in snapshot["solicitors"])
    print(f"  solicitors={len(snapshot['solicitors'])} donors={total}", flush=True)
    return snapshot


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    key = (os.environ.get("VIRTUOUS_API_KEY") or os.environ.get("API_KEY") or "").strip()
    if not key:
        raise RuntimeError("VIRTUOUS_API_KEY is required")
    client = VirtuousClient(
        key,
        os.environ.get("VIRTUOUS_BASE_URL") or "https://api.virtuoussoftware.com",
        timeout=180,
    )
    snapshot = fetch_snapshot(client)
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
