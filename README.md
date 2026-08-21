# AMU Reporting

Single web app for Ave Maria University internal reports, deployed with **SST**.

Remote: https://github.com/colecantu904/reporting

## Reports

| Route | Report |
|-------|--------|
| `/` | Hub |
| `/enrollment` | Admissions enrollment dashboard |
| `/housing` | Housing occupancy, floor maps, move-ins, verification |
| `/institute` | The Institute admissions pipeline |
| `/advancement` | Advancement folder (Overview, Annunciation Circle, Chapel Naming Opportunities) |
| `/advancement/overview` | FY 2025-26 Advancement Overview (fundraising, MGO goals, pipeline) |
| `/advancement/chapel-naming` | Chapel naming opportunities (Virtuous gifts + naming catalog) |
| `/mas` | MA follow-on giving |
| `/points` | MA points / productivity |
| `/alumni` | Alumni coverage & opportunity |

Auth is a shared magic-link gate (Resend + email allowlist).

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
| `virtuous` | contact_notes, gifts, events, contacts | VirtuousRawRefresh |
| `erez` | housing_occupancy | HousingRefresh (eRezLife assignments) |
| `qlik` | housing_occupancy | HousingRefresh (mirror of eRez occupancy during cutover) |
| `institute` | q1–q6 (Slate query dumps) | InstituteRefresh |

Each dataset keeps ~3 dated days. Report pages read `_latest` (or invoke on-read processors for MAS/alumni/institute derived views). Raw sources stay the contract; MAS also writes a short-lived `cache/mas/` snapshot so the portal stays under CloudFront’s 60s origin limit. Housing writes `cache/housing/residents.json` for the same reason.

The `/housing` page is a native residence-life dashboard from the eRezLife assignment API (sessions `2026FALL01` + `2026FALL03Ireland`), gated by the shared reporting login. Occupancy buckets: six halls, Ireland (CIARA/MALAC), Rome (price type RSTA), commuters (NODM), Middle Brook.

Institute publisher needs Slate query tokens once:

```bash
npx sst secret set InstituteSlateQueries "$(cat slate_queries.json)" --stage production
```

(`slate_queries.json` shape: `{"queries":[{"name":"q1","query_id":"...","token":"...","timeout":600}, ...]}` for q1–q6.)

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

Push to `main` runs `sst deploy --stage production`.
