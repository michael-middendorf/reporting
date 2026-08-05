# AMU Reporting

Single web app for Ave Maria University internal reports, deployed to one AWS stack
(S3 + CloudFront + Lambda) with GitHub Actions CI/CD.

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

## Layout

```
apps/web/                 Vite + React SPA (hub, auth, report frames)
services/api/             Unified API Lambda (auth, presigns, housing)
services/refresh/         Scheduled data refresh jobs
infra/                    Bootstrap + deploy scripts
.github/workflows/        OIDC deploys
```

Legacy per-report repos may still sit beside this tree locally; they are gitignored
from the monorepo. Static UIs were copied into `apps/web/public/reports/`.

## Local development

```bash
# API (port 8000)
cp .env.example .env   # set AUTH_SECRET at minimum
cd services/api && PYTHONPATH=. python3 serve_api.py

# Web (port 5173, proxies /api → 8000)
cd apps/web && npm install && npm run dev
```

Open http://127.0.0.1:5173/login — without `RESEND_API_KEY`, magic links print in the API console.

## AWS deploy (us-east-2)

```bash
# One-time
export AUTH_SECRET='…'
export RESEND_API_KEY='…'
python3 infra/bootstrap_aws.py
python3 infra/deploy_api.py
python3 infra/deploy_frontend.py
```

Then set GitHub secret `AWS_DEPLOY_ROLE_ARN` to the OIDC role ARN from `infra/deploy_state.json`
and optionally repository variables `AWS_REGION`, `FRONTEND_BUCKET`, `DATA_BUCKET`, `API_FUNCTION_NAME`.

## Cutover notes

- Enrollment continues to read the existing Slate cache bucket during transition.
- MAS / points / alumni data should be published under the unified `DATA_BUCKET` prefixes
  (`mas/`, `points/`, `alumni/`) or continue reading legacy MAS buckets via IAM until migrated.
- After validation, retire old CloudFront distributions and the housing App Runner service.
