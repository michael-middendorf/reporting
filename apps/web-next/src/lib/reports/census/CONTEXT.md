# Census working context (Fall 2026)

Load this before re-tracing sources. Live lists are gitignored JSON under `data/` and S3 `cache/census/`. Census-only git; do not commit enrollment/athletics WIP.

## Branches / PRs

- Main has #173 (incoming scores), #175 (managers, FA25 residences, Incoming+FTCA 392), and #176 (FA26 spring as Returning).
- Next: apply unretained notes so All Not Retained / UG retention counts change (LOA off the leaver list).

## Gold sources

- FA25 gold: `Documents/PERSONAL Census Files/Fall 2025 Census Final 9.23.25.xlsx` (Summary FTCA **392**, new UG **459**, UG DS **1343**, total **1500**).
- FA25 prior JSON is that raw sheet + overlays (roster, housing, incoming 100450 scores). Do not overwrite gold `appDecision` or EOT `gpa` with Official AMU GPA.
- FA26 spine: `Downloads/Registration Status-26.xlsx`. Unique PCID grand total. Dual UG+GRAD only for Lux Mundi/Ireland extras.
- Housing: eRez + FA25 `Copy of 9.4.2025 CENSUS Fall 25.xlsx` (residence-applications).
- Unretained notes: `Downloads/Census retention sheet.xlsx` col R (`intend to return/not return`).
- FA26 entry terms: `Downloads/Roster -_ Housing Report 20260821-155657.xlsx`.

## Definitions (locked)

- **Summary FTCA** = Incoming AND College Attend FTCA, any class. Spring/summer starters are **Returning**.
- **FA25 FTCA attrition cohort** = gold Incoming+FTCA **392**, minus Aiden Wilson → **391**. Not returning freshmen. Not spring admits.
- **Athletes** (sport table) = Varsity / Non-Varsity / Non-NAIA only. Band and managers = **Associated**.
- Rugby-Women → Rugby-Men associated (no women’s rugby). Ireland is a campus, not a sport. Pickleball dropped.
- Catholic = Catholic or Eastern Rite. SAT &lt; 400 missing from means. 0 scores = missing.
- FTE: FULL 1 / THRE 0.75 / HALF 0.5 / LESS 0.25 else credits/12.
- Unretained = FA25 − intervening grads − FA26 registration − retention-sheet exceptions (exclude, force retained, force graduated, LOA). LOA is on the LOA tab, not All Not Retained.

## Live headcounts (as of last publish)

**FA26 Summary:** new UG **463**, FTCA **387**, TRAN 69, READ 2, SECB 3. (Was 397 FTCA / 484 new before spring admits moved to Returning.)

**FA25 FTCA attrition:** cohort **391**, enrolled **322**, not retained **69**, **82.4%**. (None of the six FA26 LOA are Incoming+FTCA.)

**All UG retention after notes:** prior UG **1335** (1343 − Aiden − Hannah − 6 LOA), enrolled **908**, graduates **292**, not retained **135**, **87.1%**. All Not Retained **175** (135 UG DS + 40 GRAD/NDEG/DUAL). Notes sheet 135 “not retained” is the UG DS leaver count.

**S26 LOA tab:** Spring 2026 roster (7). Mondarez returned; 6 did not.

**FA26 LOA from unretained notes (col R):** Earnhardt P000341593, Gomez P000346188, Guza P000344532, Cedeno Medrano P000380481, Pena P000343982, Wagner P000380315. On the LOA tab (intend to return). Out of All Not Retained and out of the F26 retention cohort.

## Retention notes (col R + extras)

- Exclude: Aiden Wilson P000384377 (dropped after FA25 census), Hannah Nelson P000378273 (deceased).
- Force retained: Trumpore AMSOL, Harrell enrolled, Pritchard last credits, Parks AMSOL.
- Force graduated: Dec 2025 Mather/Suchomski/B.Wilson; Spring Landry; Summer list in `retention-overrides.ts`.

## Other locked people / labels

- Blank FA25 residence (filled from eRez): Barringer Commuter, Gomez On Campus, Rich Other, Cadjenovic/Harrison/Rolon On Campus, Suchomski Commuter.
- Blank FA26 class (registration Class is space; residency extract has FRES 16 cr): Nicole Ehrhart P000381773 TRAN, Elena Snyder P000386345 FTCA basketball.
- FA26 UG still unassigned residency last we looked: Yvette Flynn, Nathan Williams.

## Q&A bot

- Census page only: **Ask census**. Same `loadCensusSnapshot` as the report. Tools for name lookup.
- Needs `XAI_API_KEY` in secret `amu-reporting/production/xai-api-key` (ECS wired in infra). Until that secret exists, the panel says not configured.

## Do not

- Treat returning FTCA freshmen as the FA25 new-student FTCA pool.
- Count spring admits as Incoming on Summary.
- Put managers/band in the Athletes column.
- Commit `data/*.json` or athletics WIP.
- Invent Pell / first-gen / income — not on these lists.
