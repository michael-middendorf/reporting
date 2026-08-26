#!/usr/bin/env python3
"""Rebuild unretained.json: last census raw − intervening graduates − this-term registration.

Student-level output is gitignored. Registration is the all-student count for the current term.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from openpyxl import load_workbook

CENSUS_DIR = Path("/Users/regina.m.pirolli/Documents/PERSONAL Census Files")
PRIOR = CENSUS_DIR / "Fall 2025 Census Final 9.23.25.xlsx"
REGISTRATION = Path("/Users/regina.m.pirolli/Downloads/Registration Status-23.xlsx")
GRADUATES = CENSUS_DIR / "FA26 Census" / "FA26_graduates_2025_2026.xlsx"
DATA = Path(__file__).resolve().parents[1] / "src/lib/reports/census/data"
OUT = DATA / "unretained.json"
PRIOR_OUT = DATA / "prior.json"
GRADS_OUT = DATA / "graduates.json"

NON_DS = {"DUAL", "EACO", "ND"}


def norm(v) -> str:
    return str(v or "").strip().upper()


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


def dash(v) -> str:
    t = str(v).strip() if v is not None else ""
    return t if t else "-"


def load_registration_ids(path: Path) -> set[str]:
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    ids: set[str] = set()
    header = None
    for row in ws.iter_rows(values_only=True):
        if header is None:
            if row and str(row[0] or "").strip() == "ID":
                header = header_map(row)
            continue
        pcid = norm(row[0])
        if pcid.startswith("P"):
            ids.add(pcid)
    wb.close()
    return ids


def load_graduates(path: Path) -> list[dict]:
    wb = load_workbook(path, data_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = header_map(next(rows))
    out = []
    for row in rows:
        pcid = str(row[header["PCID"]] or "").strip()
        if not pcid:
            continue
        year = row[header["Graduation Year"]]
        term = row[header["Graduation Term"]]
        if is_ay_grad(year, term):
            out.append(
                {
                    "pcid": pcid,
                    "year": year,
                    "term": term,
                    "program": str(row[header["Graduation Program"]] or "").strip(),
                }
            )
    wb.close()
    return out


def load_prior(path: Path) -> list[dict]:
    wb = load_workbook(path, data_only=True)
    ws = wb["FA25 Census Raw Data"]
    rows = ws.iter_rows(values_only=True)
    header = header_map(next(rows))
    out = []
    for row in rows:
        pcid = str(row[header["PCID"]] or "").strip()
        if not pcid.upper().startswith("P"):
            continue
        sport = dash(row[header.get("Athletic Assoc. (Athlet.)", 18)])
        if sport == "-":
            sport = ""
        out.append(
            {
                "pcid": pcid,
                "first": str(row[header["First_Name"]] or "").strip(),
                "last": str(row[header["Last_Name"]] or "").strip(),
                "incomingReturning": dash(row[header["Incoming/Returning"]]),
                "state": dash(row[header["State"]]),
                "religion": dash(row[header["Religion"]]),
                "cathGroup": dash(row[header["Cath/Chris/Other"]] if "Cath/Chris/Other" in header else ""),
                "ethnicity": dash(row[header["Ethnicity"]]),
                "gender": dash(row[header["Gender"]]),
                "program": str(row[header["Program"]] or "").strip(),
                "collegeAttend": str(row[header["College_Attend"]] or "").strip(),
                "curriculum": str(row[header["Curriculum"]] or "").strip(),
                "curriculumName": str(row[header["Curriculum"]] or "").strip(),
                "classLevel": dash(row[header["Class_Level"]]),
                "fullPart": str(row[header["Full_Part"]] or "").strip(),
                "city": str(row[header["City"]] or "").strip(),
                "credits": row[header["Credits"]] if row[header["Credits"]] not in (None, "") else "",
                "gpa": row[header["Cumulative GPA"]] if row[header["Cumulative GPA"]] not in (None, "") else "",
                "earnedCredits": 0,
                "residency": dash(row[header["Resident / Commuter"]] if "Resident / Commuter" in header else ""),
                "sport": sport,
                "athlete": "Athlete" if sport else "Non-Athlete",
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
    registered = load_registration_ids(REGISTRATION)
    graduates = load_graduates(GRADUATES)
    grad_ids = {norm(g["pcid"]) for g in graduates}
    prior = load_prior(PRIOR)
    unretained = [
        {
            "pcid": s["pcid"],
            "first": s["first"],
            "last": s["last"],
            "retention": "Not Retained",
            "gpa": s["gpa"] if s["gpa"] not in (None, "") else "-",
            "fsp": s["fsp"],
            "household": s["household"],
            "marines": s["marines"],
            "honors": s["honors"],
            "sport": s["sport"] or "-",
            "state": s["state"],
            "gender": s["gender"],
            "classLevel": s["classLevel"],
            "collegeAttend": s["collegeAttend"],
            "incomingReturning": s["incomingReturning"],
            "program": s["program"],
        }
        for s in prior
        if norm(s["pcid"]) not in registered and norm(s["pcid"]) not in grad_ids
    ]
    ug = [
        s
        for s in unretained
        if s.get("program") == "UNDERG" and s.get("collegeAttend") not in NON_DS
    ]
    DATA.mkdir(parents=True, exist_ok=True)
    stamp = date.today().isoformat()
    OUT.write_text(
        json.dumps(
            {
                "generated": stamp,
                "term": "Fall 2026",
                "prior": "Fall 2025",
                "definition": "FA25 census raw minus 2025-26 Fall/Spring/Summer graduates minus FA26 registration.",
                "count": len(unretained),
                "ugDegreeSeeking": len(ug),
                "registered": len(registered),
                "graduates": len(graduates),
                "priorCensus": len(prior),
                "students": unretained,
            },
            default=str,
        )
    )
    PRIOR_OUT.write_text(json.dumps({"generated": stamp, "term": "Fall 2025", "count": len(prior), "students": prior}, default=str))
    GRADS_OUT.write_text(json.dumps({"generated": stamp, "count": len(graduates), "students": graduates}, default=str))
    print(
        f"Wrote {OUT}\n"
        f"  prior census {len(prior)} -> {PRIOR_OUT.name}\n"
        f"  registered this term {len(registered)}\n"
        f"  intervening graduates {len(graduates)} -> {GRADS_OUT.name}\n"
        f"  unretained {len(unretained)} (UG degree-seeking {len(ug)})"
    )


if __name__ == "__main__":
    main()
