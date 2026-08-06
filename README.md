# AMU Reporting

Single web app for Ave Maria University internal reports, deployed with **SST**
(same pattern as the undergraduate / prospect form remakes).

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

## Data layout

All reads and writes go through the SST `ReportData` bucket (`DATA_BUCKET`):

```
enrollment/          # EnrollmentRefresh (Slate)
mas/data/            # MasGivingRefresh (Virtuous)
points/data/         # PointsRefresh (Virtuous)
alumni/              # AlumniRefresh (Virtuous)
housing/latest.json  # HousingRefresh (Qlik)
```

Publishers live under `services/publishers/` — one clean handler per report,
writing straight into ReportData. Next APIs are same-origin proxies over that bucket.

## Layout

```
apps/web-next/              Next.js App Router (hub, auth, report pages)
services/publishers/        Scheduled publishers → ReportData
sst.config.ts               SST Nextjs + secrets + crons
.github/workflows/deploy.yml
```

## Access control

Each report has an allowlist env (`ENROLLMENT_ALLOWED_EMAILS`, etc.). Magic links
are scoped per report.

## Local

```bash
# apps/web-next/.env.local needs DATA_BUCKET + AUTH_SECRET (+ AWS creds for S3)
npm run dev --prefix apps/web-next
```

## Deploy

Push to `main` runs `sst deploy --stage production`.
