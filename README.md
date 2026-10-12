# AMU Reporting

Single web app for Ave Maria University internal reports. The public site is **ECS**; SST deploys publishers and crons only.

Remote: https://github.com/colecantu904/reporting

## Reports

| Route | Report |
|-------|--------|
| `/` | Hub |
| `/enrollment` | Admissions enrollment dashboard |
| `/census` | Fall census (headcount, FTE, UG profile, retention, eRez residency; Excel draft download) |
| `/athletics` | Athletics Master overview, recruiting, and giving |
| `/athletics/master/overview` | Per-sport program stats (recruiting, academics, fundraising) |
| `/athletics/master/giving` | Athletics Giving (Virtuous gifts by athletics segment: FY26, FY27, funds) |
| `/athletics/master/eligibility` | Athletics eligibility hours, GPA, and matriculation |
| `/housing` | Housing occupancy, floor maps, move-ins, verification |
| `/institute` | The Institute admissions pipeline |
| `/advancement` | Advancement folder (Overview, MGO Top Prospects, Annunciation Circle, Fall Appeal, MA Points, Chapel Naming, Stained Glass) |
| `/advancement/overview` | Advancement Overview (Qlik FY Results: received gifts, pledges, YTD, officers, pipeline) |
| `/advancement/mgo-top-prospects` | FY MGO top prospects: open gift asks by portfolio, with named donors |
| `/advancement/fall-appeal` | Fall 2026 Appeal revenue, segmentation, and year-over-year pace |
| `/advancement/points` | MA points, tiers, and leaderboard |
| `/advancement/chapel-naming` | Chapel naming opportunities (Virtuous gifts + naming catalog) |
| `/advancement/stained-glass-windows` | Named chapel stained-glass windows (rose, sanctuary, nave) with donors |
| `/mas` | MA follow-on giving |
| `/alumni` | Alumni coverage & opportunity |

`/music` is not a reporting product. It 308s to https://hub.avemaria.edu/music.

Auth is a shared magic-link gate (Resend + email allowlist). People sign in at https://reporting.avemaria.edu; there is no daily sign-in email.

## Data layout (canonical raw)

All upstream data lands in the SST `ReportData` bucket under a single convention:

```
sources/
  {source}/{dataset}/
    dt=YYYY-MM-DD/
      data.jsonl.gz
      meta.json
    _latest.json
sources/_catalog.json
```

| Source | Datasets | Publisher cron |
|--------|----------|----------------|
| `slate` | admissions, psw, messages, campus_visits, … | EnrollmentRefresh |
| `athletics` | applications, prospects, roster (optional) | AthleticsRefresh (hourly) |
| `virtuous` | contact_notes, gifts, events, contacts | VirtuousRawRefresh |
| `erez` | housing_occupancy | HousingRefresh (eRezLife assignments) |
| `qlik` | housing_occupancy | HousingRefresh (mirror of eRez occupancy during cutover) |
| `institute` | q1–q6 (Slate query dumps) | InstituteRefresh |
| `acceptance-letters` | `manifest.json` + `exports/<generatedAt>.json` (PowerFAIDS acceptance letter packages, contract v2; own KMS key, read only by the virtual acceptance letters app, not a dataset folder) | PowerFAIDS nightly job (derived export, `docs/acceptance-letters-extract.md`) |

Each dataset keeps ~3 dated days. Report pages read `_latest` (or invoke on-read processors for MAS/alumni/institute derived views). Raw sources stay the contract; MAS also writes a short-lived `cache/mas/` snapshot so the portal stays under CloudFront’s 60s origin limit. Housing writes `cache/housing/residents.json` for the same reason.

The `/housing` page is a native residence-life dashboard from the eRezLife assignment API (sessions `2026FALL01` + `2026FALL03Ireland`), gated by the shared reporting login. Occupancy buckets: six halls, Ireland (CIARA/MALAC), Rome (price type RSTA), commuters (NODM), Middle Brook.

Institute publisher needs Slate query tokens once:

```bash
npx sst secret set InstituteSlateQueries "$(cat slate_queries.json)" --stage production
```

(`slate_queries.json` shape: `{"queries":[{"name":"q1","query_id":"...","token":"...","timeout":600}, ...]}` for q1–q6.)

Athletics uses the same secret-only pattern; its service tokens must never be
committed to the repository:

```bash
npx sst secret set AthleticsSlateQueries "$(cat athletics_queries.json)" --stage production
```

The JSON shape is `{"queries":[{"name":"applications","query_id":"...","token":"...","auth":"bearer","timeout":900},{"name":"prospects","query_id":"...","token":"...","auth":"query","timeout":900},{"name":"roster","query_id":"...","token":"...","auth":"query","timeout":900}]}`. Applications sends its token in the `Authorization: Bearer` header; prospects and roster use Slate's `h` query parameter.

`roster` is optional. Until ops adds that key, AthleticsRefresh logs `athletics_dataset_skipped` and does not write `sources/athletics/roster/`. The coaching Enrollment band then shows "Awaiting roster secret" instead of a headcount. Signed/deposited and application counts still come from the existing applications feed.

Add roster by copying the live secret JSON and appending:

```json
{"name":"roster","query_id":"674fb1b4-4fef-4f26-9816-b42a5ae8265e","token":"<Slate service token>","auth":"query","timeout":900}
```

That query id is Athletics - Roster Feed (same feed as enrollment-dashboard `athletics_roster`). Put the service token in locally, never commit `athletics_queries.json`, then:

```bash
npx sst secret set AthleticsSlateQueries "$(cat athletics_queries.json)" --stage production
```

## Layout

```
apps/web-next/              Next.js App Router
services/publishers/        Raw publishers + MAS/Alumni on-read processors
sst.config.ts
```

## Local

```bash
# apps/web-next/.env.local needs DATA_BUCKET + AUTH_SECRET (+ AWS creds for S3)
npm run dev --prefix apps/web-next
```

## Deploy

Push to `main` deploys the ECS web app, then SST publishers (`npx sst deploy --stage production`). SST does not host the web app.
