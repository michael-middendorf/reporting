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

All **app reads** go through the SST `ReportData` bucket (`DATA_BUCKET`):

```
enrollment/          # synced from legacy Slate dashboard cache
mas/data/            # synced from mas-report-cache …/data/
points/data/         # synced from mas-report-cache …/points/data/
alumni/              # published / seeded alumni artifacts
housing/latest.json  # HousingRefresh (Qlik)
```

Legacy source buckets are **not modified**. `ReportDataSync` (every 15 min) copies
enrollment + MAS + points into `ReportData`. `EnrollmentRefresh` still writes the
legacy enrollment cache for other consumers. Housing writes directly to `ReportData`.

Next APIs are same-origin proxies (`/api/enrollment/*`, `/api/reports/mas/*`, etc.).

## Layout

```
apps/web-next/            Next.js App Router (hub, auth, report pages)
services/api/             Python helpers (housing Qlik fetch)
services/refresh/         Scheduled refresh + ReportData sync
sst.config.ts             SST Nextjs + secrets + crons
.github/workflows/deploy.yml   sst deploy --stage production on main
```

## Access control

Admins (`cole.j.cantu@avemaria.edu`, `regina.m.pirolli@avemaria.edu`) can open every report.
Everyone else is gated per report via env CSV lists (`ENROLLMENT_ALLOWED_EMAILS`, `HOUSING_ALLOWED_EMAILS`, `MAS_ALLOWED_EMAILS`, `POINTS_ALLOWED_EMAILS`, `ALUMNI_ALLOWED_EMAILS`).

## SST secrets

```bash
npx sst secret set AuthSecret '…' --stage production
npx sst secret set ResendApiKey '…' --stage production
npx sst secret set VirtuousApiKey '…' --stage production
npx sst secret set QlikApiKey '…' --stage production
npx sst secret set QlikTenant 'your-tenant.us.qlikcloud.com' --stage production
npx sst secret set ErezlifeApiKey '…' --stage production
npx sst secret set SlateQueryUrl 'https://…' --stage production
npx sst secret set SlateDepositsUrl 'https://…' --stage production
npx sst secret set AllowedEmails 'cole.j.cantu@avemaria.edu,…' --stage production

npx sst secret list --stage production
```

After changing a secret value, deploy (or merge to `main`).

## Local development

```bash
npm ci
npm ci --prefix apps/web-next
# apps/web-next/.env.local needs DATA_BUCKET + AUTH_SECRET (+ AWS creds for S3)
npm run dev
```

## Deploy

Push / merge to `main` → GitHub Actions runs `npx sst deploy --stage production`.

Set GitHub secret `AWS_DEPLOY_ROLE_ARN` to the OIDC deploy role.
