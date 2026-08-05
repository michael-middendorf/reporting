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

## Layout

```
apps/web/                 Vite + React SPA (hub, auth, report frames)
services/api/             Unified API (Python Lambda via SST)
services/refresh/         Scheduled refresh jobs
sst.config.ts             SST app: secrets, Router, StaticSite, Functions, Crons
infra/                    Legacy boto3 scripts (optional / cutover)
.github/workflows/deploy.yml   sst deploy --stage production on main
```

## SST secrets (like the form remakes)

Secrets are defined in `sst.config.ts` as `sst.Secret(...)`. Set them once per
stage; **every deploy re-applies them** into Lambda env. They are not stored in
GitHub Actions (only `AWS_DEPLOY_ROLE_ARN` for OIDC).

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

After changing a secret value, run (or merge to `main` so CI runs):

```bash
npx sst deploy --stage production
```

## Local development

```bash
npm ci
# API without full SST (optional):
cp .env.example .env
cd services/api && PYTHONPATH=. python3 serve_api.py

# Web
cd apps/web && npm install && npm run dev
```

Or: `npx sst dev --stage dev` (requires secrets set for the `dev` stage).

## Deploy

Push / merge to `main` → GitHub Actions runs `npx sst deploy --stage production`.

Manual:

```bash
npm ci
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync --all-packages
npx sst deploy --stage production
```

Set GitHub secret `AWS_DEPLOY_ROLE_ARN` to an OIDC role that can deploy this app
(e.g. `arn:aws:iam::905418447941:role/amu-reporting-github-deploy`).

## Cutover notes

- Enrollment still reads the existing Slate cache bucket during transition.
- Legacy boto3 scripts under `infra/` remain for emergency use; SST is the source of truth.
- After validation, retire old CloudFront distributions and the housing App Runner service.
