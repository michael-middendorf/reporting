"""Housing data fetch helpers (ported from housing-dashboard-ref/serve.py)."""
from __future__ import annotations

import asyncio
import csv
import datetime
import http.cookiejar
import io
import json
import os
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPCookieProcessor, urlopen

try:
    import websockets
    _WEBSOCKETS = True
except ImportError:
    _WEBSOCKETS = False

API_KEY = os.getenv("EREZLIFE_API_KEY") or os.getenv("API_KEY", "")
SITE_URL = os.getenv("SITE_URL", "https://avemaria.erezlife.com/")
TARGET_SESSION = os.getenv("TARGET_SESSION", "2026FALL01")
SLATE_TOKEN = os.getenv("SLATE_TOKEN", "")
SLATE_QUERY_URL = os.getenv("SLATE_QUERY_URL", "")
SLATE_DEPOSITS_TOKEN = os.getenv("SLATE_DEPOSITS_TOKEN", "")
SLATE_DEPOSITS_URL = os.getenv("SLATE_DEPOSITS_URL", "")
QLIK_API_KEY = os.getenv("QLIK_API_KEY", "")
QLIK_TENANT = os.getenv("QLIK_TENANT", "")
QLIK_SPACE = os.getenv("QLIK_SPACE", "Digital Strategy Team (DEV)")
DATA_DIR = Path(os.getenv("DATA_DIR", "/tmp"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
EREZ_CACHE_FILE = DATA_DIR / "erez_cache.json"
CACHE_TTL_HOURS = float(os.getenv("HOUSING_CACHE_TTL_HOURS", "6"))

_EREZ_FIELDS = [
    "session_id", "student_id", "email", "application_status",
    "start_date", "end_date", "building_id", "room_id", "price_type_id",
]
_ADMISSIONS_GENDER_FIELDS = ["Person Reference ID", "Gender"]
_DEPOSITS_FIELDS = [
    "Dep_App Created Date", "Dep_App Submitted Date", "Dep_Application Term",
    "Dep_Application Source", "Dep_Application Status", "Dep_Application Type",
    "Dep_Application Student Type", "Dep_Application Intended Major",
    "Dep_Application Intended Minor", "Dep_Application AC Assignment",
    "Dep_Application Workflow Bin", "Dep_Application Decision Code",
    "Dep_Application Decision Status", "Dep_Application Deposited Date",
    "Dep_Application Accepted Date", "Dep_Application Denied Date",
    "Dep_Application Withdrawn Date", "Dep_Application Athletic Decision",
    "Dep_Sport", "Dep_City", "Dep_Postal", "Dep_Region", "Dep_County",
    "Dep_Commuter Distance", "Dep_Visit Status", "Dep_First Name",
    "Dep_Last Name", "Dep_Self_SAT", "Dep_Self_ACT", "Dep_Self_CLT",
    "Portal Link", "Dep_GPA Self Reported", "Dep_Religion",
    "Dep_Official AMU GPA", "Dep_PCID", "Dep_Recruit - Rating",
    "Dep_Birthdate", "Dep_Phone", "Dep_LOI Status", "Dep_Offered",
    "Dep_CLT Convert  to ACT", "Dep_SAT Convert to ACT",
    "Dep_Application GUID", "Dep_LOI Released Date", "Dep_Deposit Date",
    "Dep_Withdrawn Date", "Dep_LOI Expire Date", "Dep_LOI Accepted Date",
    "Dep_Gender", "Dep_Risk Factor",
]
_ADMISSIONS_FIELDS = [
    "Application Student Type", "Application Type", "Application Status",
    "Application AC Assignment", "Created Date", "Application Submitted Date",
    "Application Term", "Gender", "Religion", "Sport",
    "Athlete or Non Athlete", "Application Athletic Decision",
    "Athlete Recruit - Rating", "SAT", "ACT", "CLT",
    "All Decision Codes", "Decision Code", "Accept Code", "Accept Date",
    "Full Accept Date", "Full Accept Code", "Deposit Code", "Deposit Date",
    "Denied Code", "Denied Date", "Withdrawn Code", "Withdrawn Date",
    "Self-Reported HS GPA", "Scholarship Amount",
    "Person Interview - Total Rating", "Address 1 City", "Address 1 Region",
    "Address 1 Postal", "Address 1 Country", "Person Reference ID",
    "Application Reference ID", "First Source Date", "First Source Memo",
    "Source Type Type", "Interview Status", "Interview Scheduled",
    "Interviewed Date FA25 Apps", "Interviewed Date FA26 Apps",
]


def _normalize_dep(name: str) -> str:
    """'Dep_Application Decision Code' → 'Dep_ApplicationDecisionCode'"""
    if name.startswith("Dep_") and " " in name:
        return "Dep_" + name[4:].replace(" ", "")
    return name


# ── Qlik Engine (WebSocket) fetch ─────────────────────────────────────────────
async def _qlik_fetch_async(filename: str, fields: list) -> list:
    session_id = str(uuid.uuid4())
    url = f"wss://{QLIK_TENANT}/app/SessionApp_{session_id}"
    headers = {"Authorization": f"Bearer {QLIK_API_KEY}"}
    mid = 0

    async def rpc(ws, method, handle, params):
        nonlocal mid
        mid += 1
        m = mid
        await ws.send(json.dumps({"jsonrpc": "2.0", "id": m, "method": method, "handle": handle, "params": params}))
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=90)
            resp = json.loads(raw)
            if resp.get("id") == m:
                return resp

    async with websockets.connect(url, additional_headers=headers, open_timeout=20) as ws:
        await asyncio.wait_for(ws.recv(), timeout=15)  # SESSION_CREATED

        resp = await rpc(ws, "OpenDoc", -1, {"qDocName": f"SessionApp_{session_id}"})
        dh = resp["result"]["qReturn"]["qHandle"]

        if filename.endswith(".csv"):
            fmt = "txt, codepage is 65001, embedded labels, delimiter is ',', msq"
        else:
            fmt = "qvd"
        script = f"data: LOAD * FROM [lib://{QLIK_SPACE}:DataFiles/{filename}] ({fmt});"
        await rpc(ws, "SetScript", dh, {"qScript": script})
        resp = await rpc(ws, "DoReload", dh, {})
        if not resp["result"].get("qReturn"):
            raise RuntimeError(f"Qlik reload failed for {filename}")

        dims = [{"qDef": {"qFieldDefs": [f], "qSortCriterias": []}} for f in fields]
        resp = await rpc(ws, "CreateObject", dh, {
            "qProp": {
                "qInfo": {"qType": "table"},
                "qHyperCubeDef": {
                    "qDimensions": dims, "qMeasures": [],
                    "qInitialDataFetch": [{"qTop": 0, "qLeft": 0, "qHeight": 0, "qWidth": 0}],
                },
            }
        })
        oh = resp["result"]["qReturn"]["qHandle"]

        resp = await rpc(ws, "GetLayout", oh, {})
        total = resp["result"]["qLayout"]["qHyperCube"]["qSize"]["qcy"]
        print(f"    Qlik {filename}: {total} rows")

        records = []
        # Qlik cell limit ≈ 10,000 per page (width × height)
        page = max(1, 10_000 // max(len(fields), 1))
        for top in range(0, total, page):
            h = min(page, total - top)
            resp = await rpc(ws, "GetHyperCubeData", oh, {
                "qPath": "/qHyperCubeDef",
                "qPages": [{"qTop": top, "qLeft": 0, "qHeight": h, "qWidth": len(fields)}],
            })
            if "error" in resp:
                raise RuntimeError(f"GetHyperCubeData error: {resp['error']}")
            for row in resp["result"]["qDataPages"][0]["qMatrix"]:
                records.append({fields[i]: row[i].get("qText", "") for i in range(len(fields))})

        return records


def _qlik_fetch(filename: str, fields: list) -> list:
    if not _WEBSOCKETS:
        raise RuntimeError("websockets package not installed")
    if not QLIK_API_KEY or not QLIK_TENANT:
        raise RuntimeError("QLIK_API_KEY / QLIK_TENANT not set in .env")
    return asyncio.run(_qlik_fetch_async(filename, fields))


def _build_gender_lookup() -> dict:
    """Return {person_ref_id: gender} from admissions_report_housing.csv."""
    try:
        rows = _qlik_fetch("admissions_report_housing.csv", _ADMISSIONS_GENDER_FIELDS)
        lookup = {}
        for r in rows:
            pid = r.get("Person Reference ID", "").strip()
            gen = r.get("Gender", "").strip()
            if pid and gen:
                lookup[pid] = gen
        print(f"  → Gender lookup built: {len(lookup)} students")
        return lookup
    except Exception as exc:
        print(f"  ⚠  Gender lookup failed: {exc}")
        return {}


def _enrich_gender(records: list[dict], lookup: dict) -> list[dict]:
    for r in records:
        sid = r.get("student_id", "").strip()
        r["gender"] = lookup.get(sid, "")
    return records


DEPOSITS_CSV_FILE = DATA_DIR / "slate_deposits.csv"


def _display_date(dt: Optional[datetime.datetime] = None) -> str:
    dt = dt or datetime.datetime.now()
    return f"{dt.strftime('%b')} {dt.day} {dt.year}"


def _build_housing_result(records: list[dict], include_gender: bool = False) -> dict:
    fa26 = [r for r in records if r.get("session_id") == TARGET_SESSION]
    if include_gender:
        _enrich_gender(fa26, _build_gender_lookup())
    return {
        "records": fa26,
        "session": TARGET_SESSION,
        "total": len(fa26),
        "cached_at": _display_date(),
    }


def _load_local_deposits_csv():
    if not DEPOSITS_CSV_FILE.exists():
        return None
    text = DEPOSITS_CSV_FILE.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    records = list(reader)
    print(f"  Loaded {len(records)} from {DEPOSITS_CSV_FILE.name} (fallback)\n")
    return records


def get_housing_data(*, force_refresh: bool = False) -> dict:
    """Cache-first housing occupancy payload (Qlik Engine)."""
    if not force_refresh and EREZ_CACHE_FILE.exists():
        try:
            age_hours = (datetime.datetime.now().timestamp() - EREZ_CACHE_FILE.stat().st_mtime) / 3600
            if age_hours < CACHE_TTL_HOURS:
                data = json.loads(EREZ_CACHE_FILE.read_text())
                return data
        except Exception as exc:
            print(f"  Cache read error: {exc}")

    records = _qlik_fetch("housing_erez_life.csv", _EREZ_FIELDS)
    result = _build_housing_result(records, include_gender=True)
    EREZ_CACHE_FILE.write_text(json.dumps(result))
    return result


def get_admissions_for_housing() -> dict:
    try:
        records = _qlik_fetch("admissions_report_housing.csv", _ADMISSIONS_FIELDS)
        return {"records": records, "total": len(records)}
    except Exception as exc:
        if not SLATE_QUERY_URL:
            raise
        print(f"  Qlik admissions error: {exc}; trying Slate")
        jar = http.cookiejar.CookieJar()
        opener = build_opener(HTTPCookieProcessor(jar))
        req = Request(SLATE_QUERY_URL, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
        with opener.open(req, timeout=180) as r:
            data = json.loads(r.read())
        records = data.get("row") or data.get("records") or (data if isinstance(data, list) else [])
        return {"records": records, "total": len(records)}


def get_deposits_for_housing() -> dict:
    try:
        raw = _qlik_fetch("housing_all_depoits.csv", _DEPOSITS_FIELDS)
        records = [{_normalize_dep(k): v for k, v in r.items()} for r in raw]
        return {"records": records, "total": len(records), "source": "qlik"}
    except Exception as exc:
        print(f"  Qlik deposits error: {exc}")
        records = _load_local_deposits_csv()
        if records is not None:
            return {"records": records, "total": len(records), "source": "csv"}
        if not SLATE_DEPOSITS_URL:
            raise
        jar = http.cookiejar.CookieJar()
        opener = build_opener(HTTPCookieProcessor(jar))
        req = Request(SLATE_DEPOSITS_URL, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
        with opener.open(req, timeout=60) as r:
            data = json.loads(r.read())
        records = data.get("row") or data.get("records") or (data if isinstance(data, list) else [])
        return {"records": records, "total": len(records), "source": "slate"}
