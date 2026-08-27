#!/usr/bin/env python3
"""Rebuild census JSON lists from registration, EOT GPA, honors, and Slate sports.

Student-level output is gitignored. Do not commit tokens or JSON.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from openpyxl import load_workbook

DOWNLOADS = Path("/Users/regina.m.pirolli/Downloads")
CENSUS_DIR = Path("/Users/regina.m.pirolli/Documents/PERSONAL Census Files")
DATA = Path(__file__).resolve().parents[1] / "src/lib/reports/census/data"

REGISTRATION = DOWNLOADS / "Registration Status-24.xlsx"
EOT_FILES = [DOWNLOADS / "End Of Term-6.xlsx", DOWNLOADS / "End Of Term-7.xlsx"]
HONORS = DOWNLOADS / "Association Honors-3.xlsx"
PRIOR = CENSUS_DIR / "Fall 2025 Census Final 9.23.25.xlsx"
GRADUATES = CENSUS_DIR / "FA26 Census" / "FA26_graduates_2025_2026.xlsx"
SLATE_ATHLETES = Path("/tmp/slate-athletes.json")
EXISTING_STUDENTS = DATA / "students.json"

NON_DS = {"DUAL", "EACO", "ND"}

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

RELIGION_MAP = {
    "CATH": ("Catholic", "Catholic"),
    "CHRI": ("Christian", "Christian"),
    "ECAT": ("Eastern Rite Catholic", "Eastern Rite Catholic"),
    "OTH": ("Other", "Other"),
}

GENDER_MAP = {"M": "Male", "F": "Female", "MALE": "Male", "FEMALE": "Female"}

GENDERED_SPORT = {
    "soccer": ("Soccer-Men", "Soccer-Women"),
    "basketball": ("Basketball-Men", "Basketball-Women"),
    "swimming": ("Swimming-Men", "Swimming-Women"),
    "golf": ("Golf-Men", "Golf-Women"),
    "tennis": ("Tennis-Men", "Tennis-Women"),
    "rugby": ("Rugby-Men", "Rugby-Women"),
    "track and field": ("XC/Track-Men", "XC/Track-Women"),
    "cross country": ("XC/Track-Men", "XC/Track-Women"),
    "xc/track": ("XC/Track-Men", "XC/Track-Women"),
    "pickleball": ("Pickleball-Men", "Pickleball-Women"),
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
                extra["institute"] = "Institute"
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


def load_eot_gpa(paths: list[Path]) -> dict[str, float]:
    """Latest cumulative GPA by PCID (prefer higher earned credits)."""
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
    return {k: v[0] for k, v in best.items()}


def load_honors(path: Path) -> set[str]:
    ids: set[str] = set()
    if not path.exists():
        return ids
    for header, row in iter_sheet_rows(path):
        pid = pcid_of(row[header.get("PCID", 0)])
        if pid.startswith("P"):
            ids.add(pid)
    return ids


def census_sport(team: str, gender: str) -> str:
    t = (team or "").split(",")[0].strip()
    if not t:
        return ""
    low = t.lower()
    if low in {"athletics", "athlete", "n/a", "none"}:
        return ""
    if low in {"marching band", "band"}:
        return "Band"
    if "cross country" in low or "track" in low or low.startswith("xc"):
        t = "Track and Field"
        low = t.lower()
    pair = GENDERED_SPORT.get(low)
    if not pair:
        return t
    return pair[0] if gender == "Male" else pair[1]


def load_slate_sports(path: Path) -> dict[str, dict]:
    """Current roster only: sport + team association as of this fall, not last year's leftover team."""
    if not path.exists():
        return {}
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
    rows = ws.iter_rows(values_only=True)
    header = header_map(next(rows))
    out = []
    for row in rows:
        pid = pcid_of(row[header["PCID"]])
        if not pid:
            continue
        year, term = row[header["Graduation Year"]], row[header["Graduation Term"]]
        if is_ay_grad(year, term):
            out.append(
                {
                    "pcid": pid,
                    "year": year,
                    "term": term,
                    "program": str(row[header["Graduation Program"]] or "").strip(),
                }
            )
    wb.close()
    return out


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
    cmap = load_curriculum_map()
    registered_rows = load_registration(REGISTRATION)
    eot = load_eot_gpa(EOT_FILES)
    honors = load_honors(HONORS)
    slate = load_slate_sports(SLATE_ATHLETES)
    prior = load_prior(PRIOR)
    for s in prior:
        if s["pcid"] in eot:
            s["gpa"] = eot[s["pcid"]]
    prior_ids = {norm(s["pcid"]) for s in prior}
    graduates = load_graduates(GRADUATES)
    grad_ids = {norm(g["pcid"]) for g in graduates}
    registered_ids = {norm(s["pcid"]) for s in registered_rows}

    students = []
    for r in registered_rows:
        pid = r["pcid"]
        gender = GENDER_MAP.get(r["genderRaw"].upper(), r["genderRaw"] or "")
        rel, cath = RELIGION_MAP.get(r["religionRaw"].upper(), (r["religionRaw"] or "-", "Non-Catholic" if r["religionRaw"] else "-"))
        if rel in {"Catholic", "Eastern Rite Catholic"}:
            cath = rel
        elif rel in {"Christian", "Other"}:
            cath = rel
        slate_row = slate.get(pid, {})
        sport = slate_row.get("sport") or ""
        athlete = slate_row.get("athlete") or "Non-Athlete"
        honors_val = "Hons" if pid in honors else ""
        gpa = eot.get(pid, r["gpa"])
        students.append(
            {
                "pcid": pid,
                "first": r["first"],
                "last": r["last"],
                "incomingReturning": "Returning" if norm(pid) in prior_ids else "Incoming",
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
                "residency": "",
                "sport": sport,
                "athlete": athlete,
                "athleticType": slate_row.get("athleticType") or "",
                "rosterStatus": slate_row.get("rosterStatus") or "",
                "honors": honors_val,
                "fsp": r.get("fsp") or "",
                "household": r.get("household") or "",
                "institute": r.get("institute") or "",
                "marines": r.get("marines") or "",
                "appDecision": "",
                "session": r["session"],
                "degree": r["degree"],
                "email": r["email"],
                "citizenship": "",
                "visa": "",
            }
        )

    unretained = []
    for s in prior:
        if norm(s["pcid"]) in registered_ids or norm(s["pcid"]) in grad_ids:
            continue
        gpa = eot.get(s["pcid"], s.get("gpa") or "-")
        honors_val = "Hons" if s["pcid"] in honors or str(s.get("honors") or "").lower() not in {"", "-", "none"} else s.get("honors") or ""
        if s["pcid"] in honors:
            honors_val = "Hons"
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
                "state": s.get("state") or "-",
                "gender": s.get("gender") or "-",
                "classLevel": s.get("classLevel") or "-",
                "collegeAttend": s.get("collegeAttend") or "-",
                "incomingReturning": s.get("incomingReturning") or "-",
                "program": s.get("program") or "",
            }
        )

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
                "definition": "FA25 census raw minus 2025-26 Fall/Spring/Summer graduates minus FA26 registration.",
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
    n_gpa = sum(1 for s in unretained if s["gpa"] not in ("-", "", None))
    print(
        f"students {len(students)} (athletes {n_ath}, honors {n_hons})\n"
        f"unretained {len(unretained)} UG-DS {len(ug)} with EOT GPA {n_gpa}\n"
        f"slate sports {sum(1 for v in slate.values() if v.get('sport'))}\n"
        f"honors file {len(honors)} eot gpas {len(eot)}"
    )


if __name__ == "__main__":
    main()
