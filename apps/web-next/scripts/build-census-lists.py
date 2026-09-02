#!/usr/bin/env python3
"""Rebuild census JSON lists from registration, EOT GPA, honors, and Slate sports.

Student-level output is gitignored. Do not commit tokens or JSON.
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

DOWNLOADS = Path("/Users/regina.m.pirolli/Downloads")
CENSUS_DIR = Path("/Users/regina.m.pirolli/Documents/PERSONAL Census Files")
DATA = Path(__file__).resolve().parents[1] / "src/lib/reports/census/data"

REGISTRATION = DOWNLOADS / "Registration Status-27.xlsx"
INTERNATIONAL_GLOB = "Registration Status*International*.xlsx"
# -4 = session 01 with Res Comm (R on campus, C commuter, O other).
# -2 = 03Ireland (not on -4). -5 = 01LuxMundi (replaces -3; adds Bates).
RESIDENCY_OVERLAYS = [
    DOWNLOADS / "Registration Status w Residency-4.xlsx",
    DOWNLOADS / "Registration Status w Residency-2.xlsx",
    DOWNLOADS / "Registration Status w Residency-5.xlsx",
]
EOT_FILES = [DOWNLOADS / "End Of Term-6.xlsx", DOWNLOADS / "End Of Term-7.xlsx"]
# Both years. Filenames still say FA25; 100450 is Fall 2025 incoming, 103105 is Fall 2026 incoming.
INCOMING_PRIOR = DOWNLOADS / "FA25 Incoming Students Census 20260901-100450.xlsx"
INCOMING_CURRENT = DOWNLOADS / "FA25 Incoming Students Census 20260901-103105.xlsx"
# Chesterton dual enrollment roster. Only DE Type = Chesterton counts; blank is not Chesterton.
CHESTERTON_DE = DOWNLOADS / "FA25 Incoming Students Census 20260901-103435.xlsx"
HONORS = DOWNLOADS / "Association Honors-3.xlsx"
MARINES = DOWNLOADS / "Mary's Marines_As of 9-1-26.xlsx"
SCHOLARS = DOWNLOADS / "Scholars Fall 2026.xlsx"
PRIOR = CENSUS_DIR / "Fall 2025 Census Final 9.23.25.xlsx"
FA25_ROSTER = CENSUS_DIR / "FA25 Athlete Roster For Slate.xlsx"
FA25_HOUSING = CENSUS_DIR / "Copy of 9.4.2025 CENSUS Fall 25.xlsx"
FA26_ENTRY = DOWNLOADS / "Roster -_ Housing Report 20260821-155657.xlsx"
# Gold Resident/Commuter was blank and not in the FA25 eRez extract.
FA25_RESIDENCY_FILL = {
    "P000342716": "Other",  # Abigail Rich: LESS, San Diego, Fall 2025 graduate; not in eRez
}
GRADUATES = DOWNLOADS / "Graduated %2D All-13.xlsx"
SLATE_ATHLETES = Path("/tmp/slate-athletes.json")
EXISTING_STUDENTS = DATA / "students.json"

NON_DS = {"DUAL", "EACO", "ND"}

# Match apps/web-next/src/lib/reports/census/retention-overrides.ts (Census retention sheet col R).
RETENTION_EXCLUDE = {"P000384377", "P000378273"}  # Aiden Wilson; Hannah Nelson (deceased)
RETENTION_FORCE_RETAINED = {"P000352989", "P000380426", "P000343155", "P000379038"}  # Trumpore; Harrell; Pritchard; Parks
RETENTION_FORCE_GRADUATED = {
    "P000358025",
    "P000341586",
    "P000342817",  # December 2025
    "P000346202",  # Spring 2026
    "P000347161",
    "P000354952",
    "P000357988",
    "P000345243",
    "P000379261",
    "P000343142",
    "P000354723",
    "P000346640",
    "P000347632",
    "P000345979",
    "P000343474",
    "P000349726",
    "P000381969",
    "P000354719",
    "P000383151",
    "P000358530",  # Summer 2026
}
RETENTION_LOA = {"P000341593", "P000346188", "P000344532", "P000380481", "P000343982", "P000380315"}
RETENTION_UNRETAINED_SKIP = RETENTION_EXCLUDE | RETENTION_FORCE_RETAINED | RETENTION_FORCE_GRADUATED | RETENTION_LOA

CLASS_MAP = {
    "FRES": "Freshman",
    "FR": "Freshman",
    "FRESH": "Freshman",
    "SOPH": "Sophomore",
    "SO": "Sophomore",
    "JR": "Junior",
    "SR": "Senior",
    "FIRS": "First-Year Grad",
    "SECO": "Second-Year Grad",
    "GRAD": "GRAD",
    "NDEG": "NDEG",
}

# Religion = detailed label. Cath/Chris/Other = FA25 grouping (Catholic includes Eastern Rite).
RELIGION_MAP = {
    "CATH": ("Catholic", "Catholic"),
    "CHRI": ("Christian", "Non-Catholic"),
    "ECAT": ("Eastern Rite Catholic", "Catholic"),
    "OTH": ("Other", "Non-Catholic"),
    "NONE": ("-", "Non-Catholic"),
}

GENDER_MAP = {"M": "Male", "F": "Female", "MALE": "Male", "FEMALE": "Female"}

GENDERED_SPORT = {
    "soccer": ("Soccer-Men", "Soccer-Women"),
    "basketball": ("Basketball-Men", "Basketball-Women"),
    "swimming": ("Swimming-Men", "Swimming-Women"),
    "golf": ("Golf-Men", "Golf-Women"),
    "tennis": ("Tennis-Men", "Tennis-Women"),
    "track and field": ("XC/Track-Men", "XC/Track-Women"),
    "cross country": ("XC/Track-Men", "XC/Track-Women"),
    "xc/track": ("XC/Track-Men", "XC/Track-Women"),
    "lacrosse": ("Lacrosse-Men", "Lacrosse-Women"),
}

ASSOC_SPORT = {
    "mary's marines": "marines",
    "fsp": "fsp",
    "institute": "institute",
    "the honors college": "honors_flag",
}


def norm(v) -> str:
    return str(v or "").strip().upper()


def pcid_of(v) -> str:
    t = str(v or "").strip().upper().replace(" ", "")
    if not t:
        return ""
    if t.startswith("P"):
        return "P" + t[1:].zfill(9) if t[1:].isdigit() else t
    if t.isdigit():
        return "P" + t.zfill(9)
    return t


def dash(v) -> str:
    t = str(v).strip() if v is not None else ""
    return t if t else ""


def is_ay_grad(year, term) -> bool:
    y = str(year or "").strip()
    t = str(term or "").strip().upper()
    return (y == "2025" and t == "FALL") or (y == "2026" and t in {"SPRING", "SUMMER"})


def header_map(row) -> dict[str, int]:
    out = {}
    for i, v in enumerate(row):
        key = str(v or "").strip()
        if key and key not in out:
            out[key] = i
    return out


def load_curriculum_map() -> dict[str, str]:
    if not EXISTING_STUDENTS.exists():
        return {}
    data = json.loads(EXISTING_STUDENTS.read_text())
    out = {}
    for s in data.get("students") or []:
        code = (s.get("curriculum") or "").strip()
        name = (s.get("curriculumName") or "").strip()
        if code and name:
            out[code] = name
    return out


def iter_sheet_rows(path: Path):
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    header = None
    for row in ws.iter_rows(values_only=True):
        if header is None:
            first = str(row[0] or "").strip() if row else ""
            if first in {"ID", "PCID", "PEOPLE ID"}:
                header = header_map(row)
            continue
        if row and row[0]:
            yield header, row
    wb.close()


def _col(header: dict[str, int], row, *names):
    for n in names:
        if n in header:
            i = header[n]
            return row[i] if i < len(row) else None
    lower = {k.lower(): i for k, i in header.items()}
    for n in names:
        i = lower.get(n.lower())
        if i is not None:
            return row[i] if i < len(row) else None
    return None


def load_international(paths: list[Path] | None = None) -> dict[str, dict]:
    """Citizenship + Visa from Registration Status - International Students."""
    out: dict[str, dict] = {}
    files = paths if paths is not None else sorted(
        p for p in DOWNLOADS.glob(INTERNATIONAL_GLOB) if not p.name.startswith("~$")
    )
    for path in files:
        if not path.exists():
            continue
        for header, row in iter_sheet_rows(path):
            pid = pcid_of(_col(header, row, "ID", "PCID"))
            if not pid.startswith("P"):
                continue
            rec: dict = {}
            cit = dash(_col(header, row, "Citizenship")).upper()
            visa = dash(_col(header, row, "Visa")).upper()
            if cit:
                rec["citizenship"] = cit
            if visa:
                rec["visa"] = visa
            if rec:
                prev = out.get(pid, {})
                prev.update(rec)
                out[pid] = prev
    return out


def load_fa25_roster(path: Path | None = None) -> dict[str, dict]:
    """FA25 Slate roster: Status = Varsity / Non-Varsity / Non-NAIA; blank = band / manager associated."""
    p = path or FA25_ROSTER
    out: dict[str, dict] = {}
    if not p.exists():
        return out
    wb = load_workbook(p, data_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = header_map(next(rows))
    i_id = header.get("PCID")
    i_sport = header.get("Sport")
    i_type = header.get("Status")
    if i_id is None or i_sport is None:
        wb.close()
        return out
    for row in rows:
        pid = pcid_of(row[i_id] if i_id < len(row) else None)
        if not pid.startswith("P"):
            continue
        rec: dict = {}
        sport = dash(row[i_sport] if i_sport < len(row) else None)
        typ = dash(row[i_type] if i_type is not None and i_type < len(row) else None)
        if sport:
            rec["sport"] = sport
        if typ:
            rec["athleticType"] = typ
        elif sport and sport.strip().lower() not in {"band", "marching band"}:
            # Blank Status on a team is associated (managers / student coaches), not a player.
            rec["athleticType"] = "Manager/Student Coach"
        if rec:
            out[pid] = rec
    wb.close()
    return out


def apply_fa25_roster(rows: list[dict], roster: dict[str, dict]) -> int:
    n = 0
    for s in rows:
        rec = roster.get(norm(s.get("pcid")))
        if not rec:
            continue
        if rec.get("athleticType"):
            s["athleticType"] = rec["athleticType"]
        if rec.get("sport") and not str(s.get("sport") or "").strip():
            s["sport"] = rec["sport"]
            s["athlete"] = "Athlete"
        n += 1
    return n


def fa25_housing_residency(building: str) -> str:
    b = (building or "").strip().lower()
    if not b:
        return ""
    if b == "commuter":
        return "Commuter"
    if "study" in b or b in {"resstab", "rsta"}:
        return "Other"
    return "Resident"


def load_fa25_housing(path: Path | None = None) -> dict[str, dict]:
    """FA25 eRez residence-applications: Building and Admit Term."""
    p = path or FA25_HOUSING
    out: dict[str, dict] = {}
    if not p.exists():
        return out
    wb = load_workbook(p, data_only=True, read_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = header_map(next(rows))
    i_id = next((header[k] for k in ("Student ID", "PCID", "ID") if k in header), None)
    i_bldg = header.get("Building")
    i_admit = header.get("Admit Term")
    if i_id is None:
        wb.close()
        return out
    for row in rows:
        pid = pcid_of(row[i_id] if i_id < len(row) else None)
        if not pid.startswith("P"):
            continue
        rec: dict = {}
        if i_bldg is not None:
            res = fa25_housing_residency(str(row[i_bldg] if i_bldg < len(row) else "") or "")
            if res:
                rec["residency"] = res
        if i_admit is not None:
            admit = dash(row[i_admit] if i_admit < len(row) else None)
            if admit:
                rec["admitTerm"] = admit
        if rec:
            out[pid] = rec
    wb.close()
    return out


def apply_fa25_housing(rows: list[dict], housing: dict[str, dict] | None = None) -> int:
    housing = housing if housing is not None else load_fa25_housing()
    n = 0
    for s in rows:
        pid = norm(s.get("pcid"))
        rec = housing.get(pid) or {}
        if rec.get("admitTerm"):
            s["admitTerm"] = rec["admitTerm"]
        cur = str(s.get("residency") or "").strip()
        if cur and cur != "-":
            continue
        res = rec.get("residency") or FA25_RESIDENCY_FILL.get(pid) or ""
        if not res:
            continue
        s["residency"] = res
        n += 1
    return n


def is_spring_or_summer_admit(term: str) -> bool:
    t = (term or "").strip().upper()
    return "SPRING" in t or "SUMM" in t


def load_fa26_entry_terms(path: Path | None = None) -> dict[str, str]:
    p = path or FA26_ENTRY
    out: dict[str, str] = {}
    if not p.exists():
        return out
    wb = load_workbook(p, data_only=True, read_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = header_map(next(rows))
    i_id = next((header[k] for k in ("PCID", "Student ID", "ID") if k in header), None)
    i_term = next((header[k] for k in ("Entry Term", "Admit Term") if k in header), None)
    if i_id is None or i_term is None:
        wb.close()
        return out
    for row in rows:
        pid = pcid_of(row[i_id] if i_id < len(row) else None)
        if not pid.startswith("P"):
            continue
        term = dash(row[i_term] if i_term < len(row) else None)
        if term:
            out[pid] = term
    wb.close()
    return out


def apply_fa26_entry_terms(rows: list[dict], terms: dict[str, str] | None = None) -> int:
    terms = terms if terms is not None else load_fa26_entry_terms()
    n = 0
    for s in rows:
        pid = norm(s.get("pcid"))
        term = terms.get(pid) or ""
        if term:
            s["admitTerm"] = term
        if is_spring_or_summer_admit(s.get("admitTerm") or ""):
            ir = str(s.get("incomingReturning") or "")
            if ir.lower().startswith("incoming"):
                s["incomingReturning"] = "Returning"
                n += 1
    return n


def apply_international(rows: list[dict], intl: dict[str, dict]) -> int:
    n = 0
    for s in rows:
        rec = intl.get(norm(s.get("pcid")))
        if not rec:
            continue
        if rec.get("citizenship"):
            s["citizenship"] = rec["citizenship"]
        if rec.get("visa"):
            s["visa"] = rec["visa"]
        n += 1
    return n


def load_registration(path: Path) -> list[dict]:
    out = []
    for header, row in iter_sheet_rows(path):
        def col(name, default=""):
            i = header.get(name)
            return row[i] if i is not None else default

        pid = pcid_of(col("ID"))
        if not pid.startswith("P"):
            continue
        assoc = str(col("Sport") or "").strip()
        extra = {"marines": "", "fsp": "", "household": "", "institute": ""}
        key = assoc.lower().rstrip()
        if key in ASSOC_SPORT:
            field = ASSOC_SPORT[key]
            if field == "marines":
                extra["marines"] = "Mary's Marines"
            elif field == "fsp":
                extra["fsp"] = "FSP"
            elif field == "institute":
                extra["institute"] = "Associate"
        elif "marines" in key:
            extra["marines"] = "Mary's Marines"
        out.append(
            {
                "pcid": pid,
                "first": dash(col("First Name")),
                "last": dash(col("Last Name")),
                "session": dash(col("Session")),
                "program": dash(col("Program")),
                "degree": dash(col("Degree")),
                "curriculum": dash(col("Curriculum")),
                "collegeAttend": dash(col("College Attend")),
                "classRaw": dash(col("Class")),
                "fullPart": dash(col("Full Part Time")),
                "credits": col("Credits") if col("Credits") not in (None, "") else "",
                "gpa": col("Cumulative GPA") if col("Cumulative GPA") not in (None, "") else "",
                "genderRaw": dash(col("Gender")),
                "ethnicity": dash(col("Ethnicity")) or "-",
                "religionRaw": dash(col("Religion")),
                "city": dash(col("City")),
                "state": dash(col("State")),
                "email": dash(col("Email")),
                **extra,
            }
        )
    return out


def load_residency_overlay(path: Path) -> list[dict]:
    """Registration Status with Residency rows. Keep every program for a person."""
    if not path.exists():
        return []
    out: list[dict] = []
    for header, row in iter_sheet_rows(path):
        def col(name, default=""):
            i = header.get(name)
            return row[i] if i is not None else default

        pid = pcid_of(col("ID") or col("PCID"))
        if not pid.startswith("P"):
            continue
        out.append(
            {
                "pcid": pid,
                "first": dash(col("First Name")),
                "last": dash(col("Last Name")),
                "session": dash(col("Session")),
                "program": dash(col("Program")),
                "degree": dash(col("Degree")),
                "curriculum": dash(col("Curriculum")),
                "collegeAttend": dash(col("College Attend")),
                "classRaw": dash(col("Class")),
                "fullPart": dash(col("Full Part Time")),
                "credits": col("Credits") if col("Credits") not in (None, "") else "",
                "gpa": col("Cumulative GPA") if col("Cumulative GPA") not in (None, "") else "",
                "genderRaw": dash(col("Gender")),
                "ethnicity": dash(col("Ethnicity")),
                "religionRaw": dash(col("Religion")),
                "city": dash(col("City")),
                "state": dash(col("State")),
                "email": dash(col("Email")),
                "resComm": dash(col("Res Comm")).upper(),
                "marines": "",
                "fsp": "",
                "household": "",
                "institute": "",
            }
        )
    return out


def _keep_special_session(current: str, incoming: str) -> bool:
    cur = (current or "").lower().replace(" ", "")
    new = (incoming or "").lower().replace(" ", "")
    if "ireland" in cur and "ireland" not in new:
        return True
    if "luxmundi" in cur and "luxmundi" not in new:
        return True
    return False


def apply_residency_overlay(registered_rows: list[dict], extra_rows: list[dict]) -> None:
    def pair(r: dict) -> tuple[str, str]:
        return (norm(r["pcid"]), str(r.get("program") or "").strip().upper())

    by_pair = {pair(r): r for r in registered_rows}
    by_pcid: dict[str, list[dict]] = {}
    for r in registered_rows:
        by_pcid.setdefault(norm(r["pcid"]), []).append(r)

    merge_keys = (
        "session",
        "degree",
        "curriculum",
        "classRaw",
        "fullPart",
        "credits",
        "gpa",
        "genderRaw",
        "ethnicity",
        "city",
        "state",
        "email",
    )

    def merge_onto(row: dict, overlay: dict) -> None:
        for key in merge_keys:
            val = overlay.get(key)
            if val in (None, "", "-"):
                continue
            if key == "session" and _keep_special_session(str(row.get("session") or ""), str(val)):
                continue
            row[key] = val
        if overlay.get("collegeAttend"):
            row["collegeAttend"] = overlay["collegeAttend"]
        if overlay.get("resComm"):
            row["resComm"] = overlay["resComm"]

    for overlay in extra_rows:
        pid = norm(overlay["pcid"])
        prog = str(overlay.get("program") or "").strip().upper()
        hit = by_pair.get((pid, prog))
        if hit:
            merge_onto(hit, overlay)
            continue
        existing = by_pcid.get(pid) or []
        exist_progs = {str(e.get("program") or "").strip().upper() for e in existing if str(e.get("program") or "").strip()}
        if existing and prog and exist_progs and prog not in exist_progs:
            sess = str(overlay.get("session") or "").lower().replace(" ", "")
            # Extra program only for Lux Mundi / Ireland (Arianna UG + MA). Do not add a campus
            # UNDERG row for someone already GRAD on Registration Status.
            if "luxmundi" in sess or "ireland" in sess:
                registered_rows.append(overlay)
                by_pair[(pid, prog)] = overlay
                by_pcid[pid].append(overlay)
            else:
                merge_onto(existing[0], overlay)
            continue
        if existing:
            merge_onto(existing[0], overlay)
            continue
        sess = str(overlay.get("session") or "").lower().replace(" ", "")
        if "luxmundi" not in sess and "ireland" not in sess:
            continue
        registered_rows.append(overlay)
        by_pair[(pid, prog)] = overlay
        by_pcid[pid] = [overlay]


def load_eot_gpa(paths: list[Path]) -> dict[str, float]:
    """Latest cumulative GPA by PCID (prefer higher earned credits)."""
    return {k: v[0] for k, v in load_eot(paths).items()}


def load_eot(paths: list[Path]) -> dict[str, tuple[float, float]]:
    """Latest cumulative GPA and earned credits by PCID (prefer higher earned credits)."""
    best: dict[str, tuple[float, float]] = {}
    for path in paths:
        if not path.exists():
            continue
        for header, row in iter_sheet_rows(path):
            pid = pcid_of(row[header["PEOPLE ID"]] if "PEOPLE ID" in header else row[0])
            if not pid:
                continue
            gpa = row[header["Cumulative GPA"]]
            earned = row[header.get("Cumulative Earned Credits", 16)] or 0
            try:
                gpa_n = float(gpa)
            except (TypeError, ValueError):
                continue
            try:
                earned_n = float(earned)
            except (TypeError, ValueError):
                earned_n = 0
            prev = best.get(pid)
            if prev is None or earned_n >= prev[1]:
                best[pid] = (gpa_n, earned_n)
    return best


def load_honors(path: Path) -> set[str]:
    ids: set[str] = set()
    if not path.exists():
        return ids
    for header, row in iter_sheet_rows(path):
        pid = pcid_of(row[header.get("PCID", 0)])
        if pid.startswith("P"):
            ids.add(pid)
    return ids


def load_marines(path: Path) -> set[str]:
    """Official Mary's Marines association roster (PCID column). Dedupes repeat rows."""
    ids: set[str] = set()
    if not path.exists():
        return ids
    wb = load_workbook(path, data_only=True)
    ws = wb.active
    header = None
    for row in ws.iter_rows(values_only=True):
        if header is None:
            keys = [str(c or "").strip() for c in (row or ())]
            if "PCID" in keys:
                header = header_map(row)
            continue
        i = header.get("PCID")
        pid = pcid_of(row[i] if i is not None and i < len(row) else "")
        if pid.startswith("P"):
            ids.add(pid)
    wb.close()
    return ids


def load_institute_scholars(path: Path) -> tuple[set[str], set[tuple[str, str]], list[tuple[str, str, str]]]:
    """Y1/Y2/Y3 scholar roster. FA25 Institute column used Scholar / Associate."""
    emails: set[str] = set()
    names: set[tuple[str, str]] = set()
    rows: list[tuple[str, str, str]] = []
    if not path.exists():
        return emails, names, rows
    wb = load_workbook(path, data_only=True, read_only=True)
    for sheet_name in wb.sheetnames:
        header = None
        for row in wb[sheet_name].iter_rows(values_only=True):
            if header is None:
                keys = [str(c or "").strip() for c in (row or ())]
                if "Email" in keys and ("First" in keys or "Last" in keys):
                    header = header_map(row)
                continue
            if not row or not any(c not in (None, "") for c in row):
                continue

            def col(name: str) -> str:
                i = header.get(name)
                return dash(row[i]) if i is not None and i < len(row) else ""

            email = col("Email").lower()
            first = col("First")
            last = col("Last")
            if email:
                emails.add(email)
            if first and last:
                names.add((first.lower(), last.lower()))
            rows.append((first, last, email))
    wb.close()
    return emails, names, rows


def census_sport(team: str, gender: str) -> str:
    t = (team or "").split(",")[0].strip()
    if not t:
        return ""
    low = t.lower()
    if low in {"athletics", "athlete", "n/a", "none"}:
        return ""
    if "pickleball" in low:
        return ""
    if "ireland" in low:
        return ""
    if low in {"marching band", "band"}:
        return "Band"
    if "rugby" in low:
        return "Rugby-Men"
    if "cross country" in low or "track" in low or low.startswith("xc"):
        t = "Track and Field"
        low = t.lower()
    pair = GENDERED_SPORT.get(low)
    if not pair:
        return t
    return pair[0] if gender == "Male" else pair[1]


def load_sports_from_existing() -> dict[str, dict]:
    """Keep current sports when a fresh Slate extract is not in /tmp."""
    if not EXISTING_STUDENTS.exists():
        return {}
    payload = json.loads(EXISTING_STUDENTS.read_text())
    out: dict[str, dict] = {}
    for s in payload.get("students") or []:
        pid = norm(s.get("pcid"))
        if not pid.startswith("P"):
            continue
        sport = (s.get("sport") or "").strip()
        if sport in {"-", "Non-Athlete"}:
            sport = ""
        out[pid] = {
            "sport": sport,
            "athlete": s.get("athlete") or ("Athlete" if sport else "Non-Athlete"),
            "athleticType": s.get("athleticType") or "",
            "rosterStatus": s.get("rosterStatus") or "",
        }
    return out


def load_slate_sports(path: Path) -> dict[str, dict]:
    """Current roster only: sport + team association as of this fall, not last year's leftover team."""
    if not path.exists():
        carried = load_sports_from_existing()
        print(f"no {path}; carrying sports from existing students.json ({len(carried)})")
        return carried
    payload = json.loads(path.read_text())
    rows = payload.get("row") or []
    if isinstance(rows, dict):
        rows = [rows]
    out: dict[str, dict] = {}
    for r in rows:
        pid = pcid_of(r.get("PCID"))
        if not pid.startswith("P"):
            continue
        status = (r.get("RosterStatus") or "").strip()
        current = status.startswith("Roster")
        gender = GENDER_MAP.get(str(r.get("Gender") or "").strip().upper(), "")
        team = (r.get("AthletePrimaryTeam") or r.get("Sport") or "").strip() if current else ""
        sport = census_sport(team, gender) if current else ""
        on_team = status.startswith("Roster - Athlete") or (status == "Roster - Athletic Associated" and bool(sport))
        if "pickleball" in (team or "").lower():
            sport = ""
            on_team = False
        out[pid] = {
            "sport": sport,
            "athlete": "Athlete" if on_team else "Non-Athlete",
            "athleticType": (r.get("AthleticType") or "").strip() if current else "",
            "rosterStatus": status if current else "",
        }
    return out


def load_graduates(path: Path) -> list[dict]:
    from openpyxl import load_workbook as lw

    wb = lw(path, data_only=True)
    ws = wb.active
    header = None
    out = []
    for row in ws.iter_rows(values_only=True):
        if header is None:
            first = str(row[0] or "").strip() if row else ""
            if first == "PCID":
                header = header_map(row)
            continue
        pid = pcid_of(row[header["PCID"]] if header["PCID"] < len(row) else "")
        if not pid:
            continue
        year, term = row[header["Graduation Year"]], row[header["Graduation Term"]]
        prog_i = header.get("Graduation Program")
        deg_i = header.get("Graduation Degree")
        out.append(
            {
                "pcid": pid,
                "year": year,
                "term": term,
                "program": str(row[prog_i] or "").strip() if prog_i is not None else "",
                "degree": str(row[deg_i] or "").strip() if deg_i is not None else "",
            }
        )
    wb.close()
    if header is None:
        raise RuntimeError(f"No PCID header in {path}")
    return out


def load_ireland_pcids() -> set[str]:
    """eRez CIARA/MALAC assignments. Temporary: count these as Returning."""
    path = Path("/tmp/residents.json")
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return set()
    out: set[str] = set()
    for r in payload.get("residents") or []:
        b = str(r.get("building") or "").strip().upper()
        p = str(r.get("price_type") or "").strip().upper()
        if b in {"CIARA", "MALAC"} or p == "ISTA":
            pid = pcid_of(r.get("pcid"))
            if pid.startswith("P"):
                out.add(pid)
    return out


def _incoming_col(header: dict[str, int], names: list[str]) -> int | None:
    """Exact name first; skip SAT/CLT-to-ACT conversion columns (they contain '>>')."""
    for n in names:
        if n in header and ">>" not in n:
            return header[n]
    for k, i in header.items():
        if ">>" in k:
            continue
        kl = k.lower()
        for n in names:
            if n.lower() in kl:
                return i
    return None


def _num_score(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return int(n) if n == int(n) else n


def _hs_gpa(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return round(n, 2)


def _dob(v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, datetime):
        return v.strftime("%m/%d/%Y")
    if isinstance(v, date):
        return v.strftime("%m/%d/%Y")
    return str(v).strip()


def incoming_paths(prior: bool = False) -> list[Path]:
    files = [INCOMING_PRIOR] if prior else [INCOMING_PRIOR, INCOMING_CURRENT, CHESTERTON_DE]
    return [p for p in files if p.exists() and not p.name.startswith("~$")]


def load_incoming_scores(paths: list[Path] | None = None) -> dict[str, dict]:
    """Slate incoming extract: Official AMU GPA = HS GPA. 0 scores are missing.

    Native verified ACT/SAT/CLT only — not SAT Super >> ACT / CLT Super >> ACT.
    """
    out: dict[str, dict] = {}
    for path in paths if paths is not None else incoming_paths():
        if not path.exists():
            continue
        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        header = None
        for row in ws.iter_rows(values_only=True):
            if header is None:
                header = header_map(row)
                continue
            i_id = _incoming_col(header, ["PowerCampus ID", "PCID", "ID", "PEOPLE ID"])
            if i_id is None:
                continue
            pid = pcid_of(row[i_id])
            if not pid:
                continue
            rec: dict = {}
            i_gpa = _incoming_col(header, ["Official AMU GPA", "HS GPA", "High School GPA"])
            i_act = _incoming_col(header, ["ACT Superscore (verified only)", "ACT Superscore", "ACT"])
            i_sat = _incoming_col(header, ["SAT Superscore (verified only)", "SAT Superscore", "SAT"])
            i_clt = _incoming_col(header, ["CLT Superscore (verified only)", "CLT Superscore", "CLT"])
            i_dob = _incoming_col(header, ["Person Birthdate", "Birthdate", "DOB"])
            gpa = _hs_gpa(row[i_gpa] if i_gpa is not None else None)
            act = _num_score(row[i_act] if i_act is not None else None)
            sat = _num_score(row[i_sat] if i_sat is not None else None)
            clt = _num_score(row[i_clt] if i_clt is not None else None)
            dob = _dob(row[i_dob] if i_dob is not None else None)
            if gpa is not None:
                rec["hsGpa"] = gpa
            if act is not None:
                rec["act"] = act
            if sat is not None:
                rec["sat"] = sat
            if clt is not None:
                rec["clt"] = clt
            if dob:
                rec["dob"] = dob
            if rec:
                prev = out.get(pid, {})
                prev.update(rec)
                out[pid] = prev
        wb.close()
    return out


SCORE_KEYS = ("hsGpa", "act", "sat", "clt", "dob")

# Slate accept codes → FA25 Census Application Decision labels.
DECISION_MAP = {
    "AT": "ACCT",
    "ACCT": "ACCT",
    "ACCEPT": "ACCT",
    "ACCEDPT": "ACCT",
    "ADMI": "ADM",
    "ADM": "ADM",
    "CMRV": "COMM",
    "COMM": "COMM",
    "COND": "COND",
    "NODE": "NODE",
}


def _decision(v) -> str:
    t = str(v or "").strip().upper()
    if not t or t in {"-", "NONE", "NOT LISTED"}:
        return ""
    return DECISION_MAP.get(t, t)


def clear_incoming_scores(rows: list[dict]) -> None:
    for s in rows:
        for k in SCORE_KEYS:
            s.pop(k, None)


def apply_incoming_scores(rows: list[dict], scores: dict[str, dict]) -> int:
    n = 0
    for s in rows:
        rec = scores.get(norm(s.get("pcid")))
        if not rec:
            continue
        for k in SCORE_KEYS:
            v = rec.get(k)
            if v in (None, ""):
                continue
            s[k] = v
        n += 1
    return n


def load_accept_decisions(path: Path | None = None) -> dict[str, str]:
    """Accept decisions from FA25 and FA26 incoming extracts. Later file wins on overlap."""
    paths = [path] if path is not None else incoming_paths(False)
    out: dict[str, str] = {}
    for p in paths:
        if not p.exists():
            continue
        wb = load_workbook(p, read_only=True, data_only=True)
        ws = wb.active
        header = None
        for row in ws.iter_rows(values_only=True):
            if header is None:
                header = header_map(row)
                continue
            i_id = _incoming_col(header, ["PowerCampus ID", "PCID", "ID", "PEOPLE ID"])
            i_dec = _incoming_col(
                header,
                ["Application Decision", "Accept Decision", "Accedpt Decision", "Admit Decision"],
            )
            if i_id is None or i_dec is None:
                continue
            pid = pcid_of(row[i_id])
            d = _decision(row[i_dec])
            if pid and d:
                out[pid] = d
        wb.close()
    return out


def load_chesterton_de(path: Path | None = None) -> dict[str, str]:
    """PCIDs on the Chesterton DE extract. DE Type if present, else Chesterton."""
    p = path or CHESTERTON_DE
    out: dict[str, str] = {}
    if not p.exists():
        return out
    wb = load_workbook(p, read_only=True, data_only=True)
    ws = wb.active
    header = None
    for row in ws.iter_rows(values_only=True):
        if header is None:
            header = header_map(row)
            continue
        i_id = _incoming_col(header, ["PowerCampus ID", "PCID", "ID", "PEOPLE ID"])
        if i_id is None:
            continue
        pid = pcid_of(row[i_id])
        if not pid:
            continue
        i_de = _incoming_col(header, ["DE Type", "DEType", "Chesterton"])
        de = str(row[i_de] or "").strip() if i_de is not None else ""
        if not de:
            continue
        out[pid] = de
    wb.close()
    return out


def apply_chesterton_de(rows: list[dict], roster: dict[str, str]) -> int:
    n = 0
    for s in rows:
        de = roster.get(norm(s.get("pcid")))
        if not de:
            continue
        s["deType"] = de
        n += 1
    return n


def apply_accept_decisions(rows: list[dict], decisions: dict[str, str]) -> int:
    n = 0
    for s in rows:
        s["appDecision"] = ""
        d = decisions.get(norm(s.get("pcid")))
        if not d:
            continue
        s["appDecision"] = d
        n += 1
    return n


def patch_incoming_only() -> None:
    current_scores = load_incoming_scores(incoming_paths(False))
    prior_scores = load_incoming_scores(incoming_paths(True))
    intl = load_international()
    decisions = load_accept_decisions()
    if not current_scores and not prior_scores and not intl and not decisions:
        print("no incoming extract, international file, or accept-decision file in Downloads")
        return
    for name in ("students.json", "prior.json"):
        path = DATA / name
        data = json.loads(path.read_text())
        rows = data.get("students") or []
        if name == "students.json":
            clear_incoming_scores(rows)
            n = apply_incoming_scores(rows, current_scores) if current_scores else 0
            n_int = apply_international(rows, intl) if intl else 0
            n_dec = apply_accept_decisions(rows, decisions) if decisions else 0
            n_ch = apply_chesterton_de(rows, load_chesterton_de())
            n_ros = 0
            apply_fa26_entry_terms(rows)
            scores_n = len(current_scores)
        else:
            n = apply_incoming_scores(rows, prior_scores) if prior_scores else 0
            n_int = 0
            n_dec = 0
            n_ch = 0
            n_ros = apply_fa25_roster(rows, load_fa25_roster())
            apply_fa25_housing(rows)
            scores_n = len(prior_scores)
        path.write_text(json.dumps(data, default=str))
        print(
            f"{name} incoming {n} of {data.get('count')} international {n_int} "
            f"decisions {n_dec} chesterton {n_ch} roster {n_ros} "
            f"({scores_n} incoming, {len(intl)} intl, {len(decisions)} decisions)"
        )


def load_prior(path: Path) -> list[dict]:
    from openpyxl import load_workbook as lw

    wb = lw(path, data_only=True)
    ws = wb["FA25 Census Raw Data"]
    rows = ws.iter_rows(values_only=True)
    header = header_map(next(rows))
    out = []
    for row in rows:
        pid = pcid_of(row[header["PCID"]])
        if not pid.startswith("P"):
            continue
        sport = dash(row[header.get("Athletic Assoc. (Athlet.)", 18)])
        if sport == "-":
            sport = ""
        out.append(
            {
                "pcid": pid,
                "first": dash(row[header["First_Name"]]),
                "last": dash(row[header["Last_Name"]]),
                "incomingReturning": dash(row[header["Incoming/Returning"]]),
                "state": dash(row[header["State"]]),
                "religion": dash(row[header["Religion"]]),
                "cathGroup": dash(row[header["Cath/Chris/Other"]] if "Cath/Chris/Other" in header else ""),
                "ethnicity": dash(row[header["Ethnicity"]]),
                "gender": dash(row[header["Gender"]]),
                "program": dash(row[header["Program"]]),
                "collegeAttend": dash(row[header["College_Attend"]]),
                "curriculum": dash(row[header["Curriculum"]]),
                "curriculumName": dash(row[header["Curriculum"]]),
                "classLevel": dash(row[header["Class_Level"]]),
                "fullPart": dash(row[header["Full_Part"]]),
                "city": dash(row[header["City"]]),
                "credits": row[header["Credits"]] if row[header["Credits"]] not in (None, "") else "",
                "gpa": row[header["Cumulative GPA"]] if row[header["Cumulative GPA"]] not in (None, "") else "",
                "earnedCredits": 0,
                "residency": dash(row[header["Resident / Commuter"]] if "Resident / Commuter" in header else ""),
                "sport": sport,
                "athlete": "Athlete" if sport else "Non-Athlete",
                "athleticType": "",
                "rosterStatus": "",
                "honors": dash(row[header["Honors"]] if "Honors" in header else ""),
                "fsp": dash(row[header["FSP"]] if "FSP" in header else ""),
                "household": dash(row[header["Household"]] if "Household" in header else ""),
                "institute": dash(row[header["Institute"]] if "Institute" in header else ""),
                "marines": dash(row[header["Mary's Marines"]] if "Mary's Marines" in header else ""),
                "appDecision": dash(row[header["Application Decision"]] if "Application Decision" in header else ""),
                "session": "01",
                "degree": "",
                "email": "",
                "citizenship": "",
                "visa": "",
            }
        )
    wb.close()
    return out


def main() -> None:
    if "--incoming-only" in sys.argv:
        patch_incoming_only()
        return
    cmap = load_curriculum_map()
    registered_rows = load_registration(REGISTRATION)
    residency_overlay: list[dict] = []
    for path in RESIDENCY_OVERLAYS:
        residency_overlay.extend(load_residency_overlay(path))
    apply_residency_overlay(registered_rows, residency_overlay)
    eot = load_eot(EOT_FILES)
    eot_gpa = {k: v[0] for k, v in eot.items()}
    eot_earned = {k: v[1] for k, v in eot.items()}
    honors = load_honors(HONORS)
    scholar_emails, scholar_names, scholar_rows = load_institute_scholars(SCHOLARS)
    slate = load_slate_sports(SLATE_ATHLETES)
    prior = load_prior(PRIOR)
    n_fa25_roster = apply_fa25_roster(prior, load_fa25_roster())
    n_fa25_housing = apply_fa25_housing(prior)
    for s in prior:
        if s["pcid"] in eot_gpa:
            s["gpa"] = eot_gpa[s["pcid"]]
        if s["pcid"] in eot_earned:
            s["earnedCredits"] = eot_earned[s["pcid"]]
    prior_ids = {norm(s["pcid"]) for s in prior}
    prior_by = {norm(s["pcid"]): s for s in prior}

    def prior_was_ug_ds(pid: str) -> bool:
        prev = prior_by.get(norm(pid))
        if not prev:
            return False
        return (prev.get("program") or "").strip().upper() == "UNDERG" and (
            prev.get("collegeAttend") or ""
        ).strip().upper() not in NON_DS

    def is_ftca_freshman(row: dict) -> bool:
        college = (row.get("collegeAttend") or "").strip().upper()
        cls = CLASS_MAP.get(str(row.get("classRaw") or "").upper(), str(row.get("classRaw") or "").strip())
        return college == "FTCA" and str(cls).lower().startswith("fresh")

    ireland_ids = load_ireland_pcids() | {
        norm(row["pcid"]) for row in residency_overlay if "ireland" in str(row.get("session") or "").lower()
    }
    graduates = load_graduates(GRADUATES)
    grad_ids = {norm(g["pcid"]) for g in graduates if is_ay_grad(g.get("year"), g.get("term"))}
    registered_ids = {norm(s["pcid"]) for s in registered_rows}

    students = []
    for r in registered_rows:
        pid = r["pcid"]
        gender = GENDER_MAP.get(r["genderRaw"].upper(), r["genderRaw"] or "")
        rel, cath = RELIGION_MAP.get(
            r["religionRaw"].upper(),
            (r["religionRaw"] or "-", "Non-Catholic" if r["religionRaw"] else "-"),
        )
        slate_row = slate.get(pid, {})
        sport = slate_row.get("sport") or ""
        in_ireland = norm(pid) in ireland_ids or "ireland" in str(r.get("session") or "").lower()
        if (sport or "").strip().lower() == "ireland":
            sport = ""
        athlete = slate_row.get("athlete") or "Non-Athlete"
        sess_key = str(r.get("session") or "").lower().replace(" ", "")
        in_mallary = "03mm" in sess_key or "mallary" in sess_key
        res_comm = str(r.get("resComm") or "").upper()
        if in_mallary:
            residency = "Mont Mallary"
        elif in_ireland:
            residency = "Mount Melleray Abbey"
        elif res_comm == "C":
            residency = "Commuter"
        elif res_comm == "R":
            residency = "On Campus"
        elif res_comm == "O":
            residency = "Other"
        else:
            residency = ""
        honors_val = "Hons" if pid in honors else ""
        gpa = eot_gpa.get(pid, r["gpa"])
        institute = r.get("institute") or ""
        email = (r.get("email") or "").strip()
        namekey = ((r.get("first") or "").strip().lower(), (r.get("last") or "").strip().lower())
        if email.lower() in scholar_emails or namekey in scholar_names:
            institute = "Scholar"
        students.append(
            {
                "pcid": pid,
                "first": r["first"],
                "last": r["last"],
                "incomingReturning": (
                    "Incoming"
                    if is_ftca_freshman(r) and not prior_was_ug_ds(pid)
                    else "Returning"
                    if norm(pid) in prior_ids
                    or in_ireland
                    or "ireland" in str(r.get("session") or "").lower()
                    else "Incoming"
                ),
                "state": r["state"],
                "religion": rel or "-",
                "cathGroup": cath or "-",
                "ethnicity": r["ethnicity"] or "-",
                "gender": gender,
                "program": r["program"],
                "collegeAttend": r["collegeAttend"],
                "curriculum": r["curriculum"],
                "curriculumName": cmap.get(r["curriculum"], r["curriculum"]),
                "classLevel": CLASS_MAP.get(r["classRaw"].upper(), r["classRaw"].strip()),
                "fullPart": r["fullPart"],
                "city": r["city"],
                "credits": r["credits"],
                "gpa": gpa if gpa not in (None, "") else "",
                "earnedCredits": "",
                "residency": residency,
                "sport": sport,
                "athlete": athlete,
                "athleticType": slate_row.get("athleticType") or "",
                "rosterStatus": slate_row.get("rosterStatus") or "",
                "honors": honors_val,
                "fsp": r.get("fsp") or "",
                "household": r.get("household") or "",
                "institute": institute,
                "marines": r.get("marines") or "",
                "appDecision": "",
                "deType": "",
                "session": r["session"],
                "degree": r["degree"],
                "email": r["email"],
                "citizenship": "",
                "visa": "",
            }
        )

    unretained = []
    for s in prior:
        pid = norm(s["pcid"])
        if pid in registered_ids or pid in grad_ids or pid in RETENTION_UNRETAINED_SKIP:
            continue
        gpa = eot_gpa.get(s["pcid"], s.get("gpa") or "-")
        honors_val = "Hons" if s["pcid"] in honors or str(s.get("honors") or "").lower() not in {"", "-", "none"} else s.get("honors") or ""
        if s["pcid"] in honors:
            honors_val = "Hons"
        earned = eot_earned.get(s["pcid"], s.get("earnedCredits") or "")
        unretained.append(
            {
                "pcid": s["pcid"],
                "first": s["first"],
                "last": s["last"],
                "retention": "Not Retained",
                "gpa": gpa if gpa not in (None, "") else "-",
                "fsp": s.get("fsp") or "-",
                "household": s.get("household") or "-",
                "marines": s.get("marines") or "-",
                "honors": honors_val or "-",
                "sport": s.get("sport") or "-",
                "athleticType": s.get("athleticType") or "",
                "rosterStatus": s.get("rosterStatus") or "",
                "religion": s.get("religion") or "-",
                "state": s.get("state") or "-",
                "gender": s.get("gender") or "-",
                "classLevel": s.get("classLevel") or "-",
                "collegeAttend": s.get("collegeAttend") or "-",
                "incomingReturning": s.get("incomingReturning") or "-",
                "program": s.get("program") or "",
                "credits": s.get("credits") if s.get("credits") not in (None, "") else "",
                "earnedCredits": earned if earned not in (None, "") else "",
            }
        )

    incoming_scores = load_incoming_scores(incoming_paths(False))
    prior_incoming_scores = load_incoming_scores(incoming_paths(True))
    clear_incoming_scores(students)
    n_inc_stu = apply_incoming_scores(students, incoming_scores)
    n_inc_prior = apply_incoming_scores(prior, prior_incoming_scores)
    intl = load_international()
    n_intl = apply_international(students, intl)
    decisions = load_accept_decisions()
    n_dec = apply_accept_decisions(students, decisions)
    n_chesterton = apply_chesterton_de(students, load_chesterton_de())
    n_spring = apply_fa26_entry_terms(students)
    marines_ids = load_marines(MARINES)
    n_mm = 0
    for s in students:
        if norm(s["pcid"]) in marines_ids:
            s["marines"] = "Mary's Marines"
            n_mm += 1
        else:
            s["marines"] = ""

    ug = [s for s in unretained if s.get("program") == "UNDERG" and s.get("collegeAttend") not in NON_DS]
    DATA.mkdir(parents=True, exist_ok=True)
    stamp = date.today().isoformat()
    (DATA / "students.json").write_text(
        json.dumps({"generated": stamp, "term": "Fall 2026", "count": len(students), "students": students}, default=str)
    )
    (DATA / "unretained.json").write_text(
        json.dumps(
            {
                "generated": stamp,
                "term": "Fall 2026",
                "prior": "Fall 2025",
                "definition": "FA25 census raw minus 2025-26 Fall/Spring/Summer graduates minus FA26 registration minus retention-sheet exceptions (exclude, force retained, force graduated, LOA).",
                "count": len(unretained),
                "ugDegreeSeeking": len(ug),
                "registered": len(registered_ids),
                "graduates": len(graduates),
                "priorCensus": len(prior),
                "students": unretained,
            },
            default=str,
        )
    )
    (DATA / "prior.json").write_text(
        json.dumps({"generated": stamp, "term": "Fall 2025", "count": len(prior), "students": prior}, default=str)
    )
    (DATA / "graduates.json").write_text(
        json.dumps({"generated": stamp, "count": len(graduates), "students": graduates}, default=str)
    )
    n_ath = sum(1 for s in students if s["athlete"] == "Athlete")
    n_hons = sum(1 for s in students if s["honors"] == "Hons")
    n_sch = sum(1 for s in students if s["institute"] == "Scholar")
    matched_emails = {(s.get("email") or "").strip().lower() for s in students}
    matched_names = {((s.get("first") or "").strip().lower(), (s.get("last") or "").strip().lower()) for s in students}
    unmatched_scholars = [
        f"{first} {last} <{email}>"
        for first, last, email in scholar_rows
        if email not in matched_emails and (first.lower(), last.lower()) not in matched_names
    ]
    unmatched_scholars = list(dict.fromkeys(unmatched_scholars))
    n_gpa = sum(1 for s in unretained if s["gpa"] not in ("-", "", None))
    n_ire = sum(
        1
        for s in students
        if norm(s["pcid"]) in ireland_ids or "ireland" in str(s.get("session") or "").lower()
    )
    n_ire_ret = sum(
        1
        for s in students
        if (norm(s["pcid"]) in ireland_ids or "ireland" in str(s.get("session") or "").lower())
        and s["incomingReturning"] == "Returning"
    )
    print(
        f"students {len(students)} (athletes {n_ath}, honors {n_hons}, scholars {n_sch})\n"
        f"unretained {len(unretained)} UG-DS {len(ug)} with EOT GPA {n_gpa}\n"
        f"ireland {n_ire} returning {n_ire_ret}\n"
        f"slate sports {sum(1 for v in slate.values() if v.get('sport'))}\n"
        f"incoming scores FA25+FA26 {len(incoming_scores)} on students {n_inc_stu}; FA25 {len(prior_incoming_scores)} on prior {n_inc_prior}\n"
        f"accept decisions {len(decisions)} on students {n_dec}\n"
        f"chesterton DE {n_chesterton}\n"
        f"spring/summer admits marked Returning {n_spring}\n"
        f"fa25 roster overlay {n_fa25_roster}\n"
        f"fa25 housing overlay {n_fa25_housing}\n"
        f"international {len(intl)} on students {n_intl}\n"
        f"honors file {len(honors)} eot gpas {len(eot_gpa)} scholar roster {len(scholar_emails)} unmatched {len(unmatched_scholars)}\n"
        f"mary's marines roster {len(marines_ids)} on students {n_mm}"
    )
    if unmatched_scholars:
        print("unmatched scholars:", "; ".join(unmatched_scholars))


if __name__ == "__main__":
    main()
