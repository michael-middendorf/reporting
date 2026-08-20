#!/usr/bin/env python3
"""Build the AMU "The Institute" Admissions Pipeline Dashboard.

Fetches six Slate "run as service" queries, injects them into template.html,
and writes a single self-contained dashboard HTML file you can open by
double-clicking (no server, no dependencies).

The big all-applications query (q1) and the prospect pool (q2) plus the bin
history (q6) are pre-aggregated here so the output file stays small — only the
Institute applicant/recruiting rows are inlined verbatim.

Usage:
    python3 build.py            # fetch fresh data from Slate, then build
    python3 build.py --offline  # rebuild from cached q?.json only

Each query's id + auth hash live in QUERIES below (override any hash via the
matching SLATE_H_<KEY> environment variable, e.g. SLATE_H_Q2). If a fetch
fails, the cached copy is used when present. The cached q?.json and the
generated HTML contain FERPA-protected student data and are git-ignored.
"""
import json, os, sys, ssl, urllib.request, datetime, html
from collections import Counter, defaultdict

HERE     = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(HERE, "institute_dashboard.html")          # static frontend (fetches /api/dashboard)
OFFLINE  = os.path.join(HERE, "institute_dashboard.offline.html")  # self-contained, data baked in (gitignored)
BASE     = "https://apply.avemaria.edu/manage/query/run"

# ---------------------------------------------------------------------------
# INSTITUTE GOALS  --  EDIT THESE
# ---------------------------------------------------------------------------
# The gauge "you-should-be-here" marker = Institute goal x last year's
# ADMISSIONS pace. i.e. the benchmark is: what fraction of the cycle enrollment
# had reached by this calendar date last year (computed from the admissions
# query), applied to each Institute goal. Enter the Institute's season targets:
INSTITUTE_GOALS = {
    "placeholder": False,         # real 2026 targets (Regina, 2026-08-04)
    "Applicants": 500,
    "Interviews": 400,
    "Accepted": 125,
    "Signed": 110,
}

# ---------------------------------------------------------------------------
# RECRUITING CALLS WORKFLOW (q7)  --  FA27 KPIs
# ---------------------------------------------------------------------------
# A second set of dials (separate from the applicant funnel above) for the
# "recruiting calls workflow" — one row per person in that Slate workflow.
# Each KPI: (key, display name, FA27 goal, window-1 share, "i" definition).
# The "you-should-be-here" marker is a fixed CALENDAR schedule (not last-year
# pace): spread linearly across two windows —
#   W1: 2026-07-01 -> 2027-01-01   (this share of the goal)
#   W2: 2027-01-01 -> 2027-05-01   (the remaining share)
RECRUITING_KPIS = [
    ("leads", "Leads", 1000, 0.70,
     "Everyone in the recruiting calls workflow."),
    ("amu", "Institute-Driven AMU Apps", 200, 1.00,
     "Entered through the recruiting calls (has a workflow-entry date) AND has "
     "submitted an AMU application."),
    ("institute", "Non-organic Institute Apps", 400, 0.75,
     "Anyone in the workflow who has submitted an Institute application "
     "(result = 'institute application')."),
]
_RC_A = datetime.date(2026, 7, 1)
_RC_B = datetime.date(2027, 1, 1)
_RC_C = datetime.date(2027, 5, 1)

# key -> (query id, auth token, read-timeout seconds).  The auth TOKENS are
# secret and live in slate_queries.json (git-ignored) — this fallback keeps only
# the non-secret query ids so the real tokens never land in committed code.
# Copy slate_queries.example.json -> slate_queries.json and fill in the tokens.
QUERIES = {
    "q1": ("95f1b1f0-3118-485b-894d-18437a2a66ee", "", 600),  # all AMU apps (enrollment + funnel dates; slow)
    "q2": ("2025a39b-0dd4-43d8-a8c3-0b556b61c050", "", 600),  # prospect pool
    "q3": ("87bb648d-6181-4ef3-b1dc-dd58f4266c08", "", 120),  # recruiting
    "q4": ("54bde0b8-a89b-4cc2-ba83-540a17f593be", "", 120),  # applicants (core)
    "q5": ("c4b92e4f-bc5b-41c5-b150-22576e13a10a", "", 120),  # engagement
    "q6": ("7e9251b4-05a0-489a-b2e3-2dbd488ee7d8", "", 180),  # bin history
    "q7": ("3550aa37-39b9-41dd-bab5-dd5acfef479d", "", 120),  # recruiting calls workflow (FA27 KPIs)
}


def _load_queries_config():
    """Prefer slate_queries.json (git-ignored, holds tokens) over the built-in
    defaults, so credentials live in config, not committed code."""
    cfg = os.path.join(HERE, "slate_queries.json")
    if not os.path.exists(cfg):
        return None
    try:
        with open(cfg, encoding="utf-8") as f:
            data = json.load(f)
        out = {}
        for q in data.get("queries", []):
            name, qid, token = q.get("name"), q.get("query_id"), q.get("token")
            if name and qid and token:
                out[name] = (qid, token, int(q.get("timeout", 180)))
        return out or None
    except Exception as exc:
        print(f"  (slate_queries.json load failed: {exc}; using built-in defaults)")
        return None


QUERIES = _load_queries_config() or QUERIES


def cache_path(key):
    return os.path.join(HERE, f"{key}.json")


def rows_of(raw):
    d = json.loads(raw)
    return d.get("row", []) if isinstance(d, dict) else (d or [])


def fetch_one(key, qid, h, timeout):
    env_h = os.environ.get(f"SLATE_H_{key.upper()}")
    if env_h:
        h = env_h
    url = f"{BASE}?id={qid}&cmd=service&output=json&h={h}"
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": "amu-institute-dashboard"})
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
    rows_of(raw)  # validate JSON
    with open(cache_path(key), "w", encoding="utf-8") as f:
        f.write(raw)
    return raw


def load(key, offline):
    """Return the raw JSON text for a query, fetching unless offline."""
    qid, h, timeout = QUERIES[key]
    if not offline:
        try:
            print(f"  fetching {key} (timeout {timeout}s)…", flush=True)
            raw = fetch_one(key, qid, h, timeout)
            print(f"    {key}: {len(rows_of(raw))} rows", flush=True)
            return raw
        except Exception as e:
            print(f"    {key} fetch failed ({e})", flush=True)
    if os.path.exists(cache_path(key)):
        print(f"    {key}: using cached copy", flush=True)
        return open(cache_path(key), encoding="utf-8").read()
    print(f"    {key}: NO DATA (fetch failed, no cache) — section will be empty", flush=True)
    return None


# ---------- aggregations (keep the big queries out of the HTML) ----------
def nz(v):
    return (v or "").strip()


def agg_q1(raw):
    """All AMU undergrad applications -> per-term summary for the context donut."""
    if not raw:
        return {}
    out = {}
    for r in rows_of(raw):
        term = nz(r.get("ApplicationTerm")) or "(no term)"
        t = out.setdefault(term, {"total": 0, "byType": Counter(), "byStatus": Counter(), "byAthlete": Counter()})
        t["total"] += 1
        t["byType"][nz(r.get("ApplicationStudentType")) or "(blank)"] += 1
        t["byStatus"][nz(r.get("ApplicationStatus")) or "(blank)"] += 1
        t["byAthlete"][nz(r.get("AthleteorNonAthlete")) or "(blank)"] += 1
    return {term: {"total": v["total"], "byType": dict(v["byType"]),
                   "byStatus": dict(v["byStatus"]), "byAthlete": dict(v["byAthlete"])}
            for term, v in out.items()}


def agg_q2(raw):
    """Institute prospect pool -> summary charts (no per-prospect rows inlined)."""
    if not raw:
        return {}
    rows = rows_of(raw)
    byState, byStatus, byBin, byColumn = Counter(), Counter(), Counter(), Counter()
    gpas = []
    msa = 0
    for r in rows:
        byState[nz(r.get("Region")) or "(blank)"] += 1
        byStatus[nz(r.get("Status")) or "(blank)"] += 1
        byBin[nz(r.get("InstituteRecruitingBin")) or "(none)"] += 1
        byColumn[nz(r.get("InstituteRecruitingColumn")) or "(none)"] += 1
        if nz(r.get("MSATag")):
            msa += 1
        g = nz(r.get("PersonGPA-Self-Reportedhighschool"))
        try:
            if g:
                gpas.append(float(g))
        except ValueError:
            pass
    return {
        "total": len(rows),
        "byState": dict(byState), "byStatus": dict(byStatus),
        "byBin": dict(byBin), "byColumn": dict(byColumn),
        "msa": msa,
        "gpaAvg": round(sum(gpas) / len(gpas), 2) if gpas else None,
        "gpaCount": len(gpas),
    }


def _pdate(s):
    s = nz(s)
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def compute_pace(q1_raw, q4_raw, today=None):
    """Per-measure, per-term enrollment pace, from the admissions/enrollment query.

    For each term T, the benchmark cycle is the PRIOR instance (T-1) evaluated
    at the SAME point in its cycle — one calendar year ago from today. Each
    funnel measure is paced against its OWN date field, so downstream stages
    (which complete right before the term) read near-100% for a mature cycle:
      Applicants -> ApplicationSubmittedDate
      Interviews -> InterviewedDateFA<yy>Apps  (per prior-cohort column)
      Accepted   -> AcceptDate
      Signed     -> DepositDate               (deposit = committed)

    pace = (# who reached the stage by the cutoff) / (# who ever reached it).

    Returns {term: {prior, asOf, measures:{M:{pace,byNow,final}}}, "_default": term}.
    """
    import re
    today = today or datetime.datetime.now().date()
    try:
        cutoff = datetime.date(today.year - 1, today.month, today.day)
    except ValueError:  # Feb 29
        cutoff = datetime.date(today.year - 1, today.month, 28)

    by_term = defaultdict(list)
    for r in (rows_of(q1_raw) if q1_raw else []):
        t = nz(r.get("ApplicationTerm"))
        if t:
            by_term[t].append(r)

    view_terms = set(by_term)
    for r in (rows_of(q4_raw) if q4_raw else []):
        t = nz(r.get("ApplicationTerm"))
        if t:
            view_terms.add(t)

    def measure(rows, field):
        dates = [_pdate(r.get(field)) for r in rows]
        final = sum(1 for d in dates if d)
        by_now = sum(1 for d in dates if d and d <= cutoff)
        return {"pace": round(by_now / final, 4) if final else None,
                "byNow": by_now, "final": final}

    out = {}
    for term in view_terms:
        mm = re.search(r"(\d{4})", term)
        if not mm:
            continue
        prior = term.replace(mm.group(1), str(int(mm.group(1)) - 1))
        prows = by_term.get(prior)
        if not prows:
            out[term] = {"prior": prior, "measures": {}, "asOf": cutoff.strftime("%b %-d, %Y")}
            continue
        int_col = f"InterviewedDateFA{str(int(mm.group(1)) - 1)[2:]}Apps"  # prior cohort's interview date
        out[term] = {
            "prior": prior,
            "asOf": cutoff.strftime("%b %-d, %Y"),
            "measures": {
                "Applicants": measure(prows, "ApplicationSubmittedDate"),
                "Interviews": measure(prows, int_col),
                "Accepted":   measure(prows, "AcceptDate"),
                "Signed":     measure(prows, "DepositDate"),
            },
        }

    if q4_raw:
        tc = Counter(nz(r.get("ApplicationTerm")) for r in rows_of(q4_raw) if nz(r.get("ApplicationTerm")))
        out["_default"] = tc.most_common(1)[0][0] if tc else None
    return out


def _rc_target(goal, share, today):
    """Cumulative piecewise-linear target-to-date for a recruiting KPI.

    `share` of the goal is spread evenly across window 1 (Jul 1 -> Jan 1); the
    remaining (1 - share) across window 2 (Jan 1 -> May 1). Returns the number
    you "should" be at as of `today`.
    """
    w1, w2 = share * goal, (1 - share) * goal
    if today <= _RC_A:
        return 0.0
    if today <= _RC_B:
        return w1 * (today - _RC_A).days / (_RC_B - _RC_A).days
    if today <= _RC_C:
        return w1 + w2 * (today - _RC_B).days / (_RC_C - _RC_B).days
    return float(goal)


_FA27_TERM = "Fall 2027"


def _is_fa27(r):
    """True if the row belongs to the FA27 cycle.

    Checks Application1ApplicationTerm first; falls back to
    PersonEntryTerminquiry for rows that entered via inquiry before applying.
    """
    return (nz(r.get("Application1ApplicationTerm")) == _FA27_TERM
            or nz(r.get("PersonEntryTerminquiry")) == _FA27_TERM)


def compute_recruiting(q7_raw, today=None):
    """Recruiting-calls-workflow (q7) FA27 KPI dials.

    q7 is one row per person in the workflow. Entry mode is encoded by
    WorkflowEntry: present = entered through the recruiting calls; blank =
    entered via their AMU application (already an applicant).
      Leads      = everyone in the workflow
      AMU Apps   = entered via calls (WorkflowEntry present) AND AMUAppSubmitted=Y
      Inst. Apps = anyone in the workflow with InstituteAppSubmitted=Y
    Each dial also carries a calendar target-to-date marker (see _rc_target).
    Rows are pre-filtered to FA27 via Application1ApplicationTerm /
    PersonEntryTerminquiry so multi-term workflow data doesn't bleed in.
    """
    rows = [r for r in (rows_of(q7_raw) if q7_raw else []) if _is_fa27(r)]

    def yes(r, field):
        return nz(r.get(field)).upper() == "Y"

    def via_calls(r):
        return bool(nz(r.get("WorkflowEntry")))

    values = {
        "leads": len(rows),
        "amu": sum(1 for r in rows if via_calls(r) and yes(r, "AMUAppSubmitted")),
        "institute": sum(1 for r in rows if yes(r, "InstituteAppSubmitted")),
    }
    today = today or datetime.datetime.now().date()
    kpis = []
    for key, name, goal, share, info in RECRUITING_KPIS:
        target = _rc_target(goal, share, today)
        kpis.append({
            "key": key, "name": name, "goal": goal, "info": info,
            "value": values[key],
            "target": round(target, 1),
            "pace": round(target / goal, 4) if goal else 0.0,
        })
    return {"asOf": today.strftime("%b %-d, %Y"), "count": len(rows), "kpis": kpis}


def agg_q6(raw):
    """Institute workflow bin history -> current occupancy + all-time touches per bin, per term."""
    if not raw:
        return {}
    out = {}
    for r in rows_of(raw):
        term = nz(r.get("His_UGApplicationTerm")) or "(no term)"
        b = nz(r.get("WorkflowBin")) or "(blank)"
        t = out.setdefault(term, {"current": Counter(), "everTouched": Counter()})
        t["everTouched"][b] += 1
        if not nz(r.get("RemovedTimestamp")):  # still in this bin
            t["current"][b] += 1
    return {term: {"current": dict(v["current"]), "everTouched": dict(v["everTouched"])}
            for term, v in out.items()}


def _numf(v):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def test_scores_lookup(q1_raw):
    """PersonReferenceID -> best (max non-blank) SAT/ACT/CLT from the admissions
    query (q1). The Institute query (q4) has no SAT/CLT, so we join them in."""
    look = {}
    for r in (rows_of(q1_raw) if q1_raw else []):
        pid = nz(r.get("PersonReferenceID"))
        if not pid:
            continue
        d = look.setdefault(pid, {})
        for k in ("SAT", "ACT", "CLT"):
            v = _numf(r.get(k))
            if v is not None and (d.get(k) is None or v > d[k]):
                d[k] = v
    return look


def enrich_scores(q4_rows, q1_raw):
    """Add SAT/CLT (and backfill ACT) onto each Institute applicant row from q1."""
    look = test_scores_lookup(q1_raw)
    for r in q4_rows:
        sc = look.get(nz(r.get("PCID"))) or {}
        if sc.get("SAT") is not None:
            r["SAT"] = sc["SAT"]
        if sc.get("CLT") is not None:
            r["CLT"] = sc["CLT"]
        if not nz(r.get("ACT")) and sc.get("ACT") is not None:
            r["ACT"] = sc["ACT"]
    return q4_rows


def payload(raw, ts=None):
    """Build the JSON data payload the frontend consumes.

    `raw` maps each query key ("q1".."q6") to its raw JSON text (or None). The
    big queries (q1/q2/q6) are pre-aggregated; q3/q4/q5 pass through as rows.
    Shared by the offline builder, the data producer, and the dashboard API.
    """
    ts = ts or datetime.datetime.now().strftime("%b %d, %Y at %-I:%M %p")
    q4_rows = rows_of(raw["q4"]) if raw.get("q4") else []
    enrich_scores(q4_rows, raw.get("q1"))  # join SAT/ACT/CLT from the admissions query
    return {
        "generated_at": ts,
        "counts": {k: (len(rows_of(raw[k])) if raw.get(k) else 0) for k in QUERIES},
        "q4": q4_rows,
        "q3": rows_of(raw["q3"]) if raw.get("q3") else [],
        "q5": rows_of(raw["q5"]) if raw.get("q5") else [],
        "q1_summary": agg_q1(raw.get("q1")),
        "q2_summary": agg_q2(raw.get("q2")),
        "q6_summary": agg_q6(raw.get("q6")),
        "config": {
            "goals": INSTITUTE_GOALS,
            "pace": compute_pace(raw.get("q1"), raw.get("q4")),
            "recruiting": compute_recruiting(raw.get("q7")),
        },
    }


def build_offline(raw, ts=None):
    """Read the static frontend and bake the data payload into it (window
    .__INLINE_PAYLOAD__), producing a self-contained double-clickable file."""
    data = payload(raw, ts)
    with open(FRONTEND, encoding="utf-8") as f:
        html_src = f.read()
    needle = "window.__INLINE_PAYLOAD__ = null;"
    if needle not in html_src:
        raise RuntimeError(f"could not find inline-payload hook in {FRONTEND}")
    injected = html_src.replace(needle, "window.__INLINE_PAYLOAD__ = " + json.dumps(data) + ";", 1)
    with open(OFFLINE, "w", encoding="utf-8") as f:
        f.write(injected)
    return data


def main():
    offline = "--offline" in sys.argv
    print("Building The Institute dashboard (offline, self-contained)" + (" [cache]" if offline else "") + "…")

    raw = {k: load(k, offline) for k in QUERIES}

    if raw["q4"] is None:
        sys.exit("q4 (Institute applicants) is required and unavailable — cannot build. "
                 "Run once online first.")

    data = build_offline(raw)
    pace = data["config"]["pace"]
    counts = data["counts"]
    for term, p in pace.items():
        if term == "_default" or not isinstance(p, dict):
            continue
        ms = p.get("measures", {})
        if ms:
            summary = " ".join(f"{k[:3]}={round(v['pace']*100)}%" for k, v in ms.items() if v.get("pace") is not None)
            print(f"  pace {term} (vs {p['prior']} by {p['asOf']}): {summary}")

    size = os.path.getsize(OFFLINE)
    print(f"\nBuilt {OFFLINE}  ({size/1024:.0f} KB)")
    print("  Institute applicants (q4):", counts["q4"])
    print("  Recruiting (q3):", counts["q3"], "· Prospects (q2):", counts["q2"],
          "· Engagement (q5):", counts["q5"])
    print("  AMU applications (q1):", counts["q1"], "· Bin history (q6):", counts["q6"])
    print(f"\nDone. Open it with:\n  open '{OFFLINE}'")


if __name__ == "__main__":
    main()
