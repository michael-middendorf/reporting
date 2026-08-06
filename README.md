# AMU Reporting

Single web app for Ave Maria University internal reports, deployed with **SST**.

Remote: https://github.com/colecantu904/reporting

## Reports

| Route | Report |
|-------|--------|
| `/` | Hub |
| `/enrollment` | Admissions enrollment dashboard |
| `/housing` | Housing occupancy |
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
| `qlik` | housing_occupancy | HousingRefresh |

Each dataset keeps ~3 dated days. Report pages read `_latest` (or invoke on-read processors for MAS/alumni derived views). **No derived report packages are stored in S3.**

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
