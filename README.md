# AMU Reporting

Single web app for Ave Maria University internal reports, deployed with **SST**.

Remote: https://github.com/colecantu904/reporting

## Reports

| Route | Report |
|-------|--------|
| `/` | Hub |
| `/enrollment` | Admissions enrollment dashboard |
| `/housing` | Housing occupancy, floor maps, move-ins, verification |
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

Each dataset keeps ~3 dated days. Report pages read `_latest` (or invoke on-read processors for MAS/alumni derived views). Housing also writes a short-lived `cache/housing/residents.json` snapshot so the dashboard stays under the origin timeout.

The `/housing` page is the App Runner residence-life dashboard (eRez assignments, floor maps, move-ins, verification), gated by the shared reporting login.

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
