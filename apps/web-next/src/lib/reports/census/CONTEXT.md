# Census working context (Fall 2026)

Load this before re-tracing sources. Live lists are gitignored JSON under `data/` and S3 `cache/census/`. Census-only git; do not commit enrollment/athletics WIP.

## Branches / PRs

- Main has #173 (incoming scores), #175 (managers, FA25 residences, Incoming+FTCA 392), and #176 (FA26 spring as Returning).
- Next: publish rebuilt lists (`publish-census-lists.sh`) so /census uses Registration Status-29.
- Verify-tab notes (last column) are in `verify-notes.ts`: Trumpore/Shephard residency, Pankratz out of halls, graduate Incoming vs Returning.

## Gold sources

- FA25 gold: `Documents/PERSONAL Census Files/Fall 2025 Census Final 9.23.25.xlsx` (Summary FTCA **392**, new UG **459**, UG DS **1343**, total **1500**).
- FA25 prior JSON is that raw sheet + overlays (roster, housing, incoming 100450 scores). Do not overwrite gold `appDecision` or EOT `gpa` with Official AMU GPA.
- FA26 spine: `Downloads/Registration Status-29.xlsx` (was -27 through 2 Sep). Unique PCID grand total. Dual UG+GRAD only for Lux Mundi/Ireland extras. Residency overlays: `-6` campus, `-8` Ireland, `-7` Lux Mundi.
- Mary's Marines FA26: `Downloads/Mary's Marines_As of 9-1-26.xlsx` (410 unique PCIDs). Replaces the Registration Status Sport flag.
- Chesterton: extract `20260901-103435.xlsx` column **DE Type**. 76 rows, **1** filled (`Chesterton` = Gianna Cox, not on FA26). Blank is not Chesterton. Summary Chesterton dual = **0**.
- Housing: eRez + FA25 `Copy of 9.4.2025 CENSUS Fall 25.xlsx` (residence-applications).
- Unretained notes: `Downloads/Census retention sheet.xlsx` col R (`intend to return/not return`).
- Graduates / alumni: `Graduated %2D All-15.xlsx` (was -14). Intervening year is Fall 2025, Spring 2026, and Summer 2026. Alumni admits use undergraduate degrees on this extract.
- FA26 entry terms: `Downloads/Roster -_ Housing Report 20260821-155657.xlsx`.
- Incoming states: `Downloads/FA25 Incoming Students Census 20260903-135650.xlsx` (Person State / Address 1 Region). Fills blank FA25/FA26 state only; does not overwrite a filled state.
- Institute scholars: `Downloads/Scholars Fall 2026 (1).xlsx` (Y1/Y2/Y3). Michael Gotlund removed vs the 8-28 file. Six roster names are not on Registration Status.

## Definitions (locked)

- **Summary FTCA** = Incoming AND College Attend FTCA, any class. Spring/summer UG admits are **Returning**. Graduate verify notes can mark a summer starter Incoming (Verburgt MBA).
- **FA25 FTCA attrition cohort** = gold Incoming+FTCA **392**, minus Aiden Wilson → **391**. Not returning freshmen. Not spring admits.
- **Athletes** (sport table) = Varsity / Non-Varsity / Non-NAIA only. Band and managers = **Associated**.
- Rugby-Women → Rugby-Men associated (no women’s rugby). Ireland is a campus, not a sport. Pickleball dropped.
- Catholic = Catholic or Eastern Rite. SAT &lt; 400 missing from means. 0 scores = missing.
- FTE: FULL 1 / THRE 0.75 / HALF 0.5 / LESS 0.25 else credits/12.
- Unretained = FA25 − intervening grads − FA26 registration − retention-sheet exceptions (exclude, force retained, force graduated, LOA). LOA is on the FA26 LOA tab, not All Not Retained.
- Retention % = still enrolled / (cohort − intervening graduates). Same formula on All UG, FTCA, sports, and crosstabs.
- FA25 retention denominator = gold UG DS minus Aiden Wilson and Hannah Nelson only. Fall 2026 LOA stays in that total and counts as retained.

## Live headcounts (as of last publish)

**FA26 Summary (Registration Status-29, 3 Sep rebuild):** unique **1629**, UG DS **1400**, new UG **469**, Incoming+FTCA **394**, TRAN 68, READ 2, SECB 4. Graduate **153** (Rodriguez UG only). Shephard Ireland. Trumpore Commuter. Parks UG. O'Connor SECB.

**FA25 FTCA attrition:** cohort **391**, enrolled **322**, not retained **69**, **82.4%**. (None of the six FA26 LOA are Incoming+FTCA.)

**All UG retention after notes:** prior UG **1341** (1343 − Aiden − Hannah; LOA stays in). Enrolled and graduate counts are live. LOA is not a leaver and not on All Not Retained. Notes sheet 135 “not retained” is the UG DS leaver count.

**FA26 LOA tab:** Earnhardt P000341593, Gomez P000346188, Cedeno Medrano P000380481, Pena P000343982, Wagner P000380315. Intend to return. In the FA25 cohort. Counted as retained. Not All Not Retained. Derrick Guza is not retained.

## Retention notes (col R + extras)

- Exclude: Aiden Wilson P000384377 (dropped after FA25 census), Hannah Nelson P000378273 (deceased).
- Force retained: Trumpore AMSOL, Harrell enrolled, Pritchard last credits, Parks AMSOL.
- Conferral date wins over extract term (December = Fall). Mather/Suchomski/B.Wilson Dec 13 2025 count as Fall 2025 from All-15. Force-graduated is the remaining Summer list in `retention-overrides.ts`.

## Verify-tab notes (last column)

- Trumpore P000352989: Commuter (off-campus AMSOL). Already force retained.
- Shephard P000355002: Ireland yes (Mount Melleray Abbey). Commuter living with family at MM; residency stays Ireland.
- Beatty / Marsden / Pankratz: not retained. Pankratz housing is excluded (arrived, never registered, out of dorms).
- Graduates still registered: Incoming for new-program notes (phd / ma / mba / fall incoming); Returning for Barnes (current mba), Kelly (mba spring starter), Pellegrini (mba spring starter). Vague “grad student” notes stay Returning.
- Rodriguez P000390750: UNDERG only (drop Lux Mundi GRAD row).
- Peloso P000382172: Rugby-Men, not Ultimate Frisbee.
- Hannah Nelson P000378273: Deceased tab. Still out of the FA25 retention denominator.

## Other locked people / labels

- Blank FA25 residence (filled from eRez): Barringer Commuter, Gomez On Campus, Rich Other, Cadjenovic/Harrison/Rolon On Campus, Suchomski Commuter.
- Blank FA26 class (registration Class is space): Nicole Ehrhart P000381773 TRAN, Elena Snyder P000386345 FTCA basketball, John O'Connor P000389994 SECB.
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
