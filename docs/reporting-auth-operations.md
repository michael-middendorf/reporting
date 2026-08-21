# Reporting authentication operations

The reporting site uses passwordless magic-link authentication. It does not use Cognito or a user database.

The only URL to send people is **https://reporting.avemaria.edu**. After they sign in, the hub shows the reports their email is allowed to open. Do not send `/enrollment`, `/advancement`, `/annunciation`, `/advancement/chapel-naming`, `/advancement/mgo-top-prospects`, `/advancement/stained-glass-windows`, or CloudFront links.

## Authorization model

- The runtime configuration is the AWS Secrets Manager secret `amu-reporting/production/runtime` in `us-east-2`.
- `ALLOWED_EMAILS` must contain every person who may complete a magic-link sign-in.
- Each report also has its own CSV allowlist: `ENROLLMENT_ALLOWED_EMAILS`, `HOUSING_ALLOWED_EMAILS`, `INSTITUTE_ALLOWED_EMAILS`, `MAS_ALLOWED_EMAILS`, `POINTS_ALLOWED_EMAILS`, `ALUMNI_ALLOWED_EMAILS`, `ADVANCEMENT_ALLOWED_EMAILS`, and `ANNUNCIATION_ALLOWED_EMAILS`.
- An email must be in at least one report list to receive a magic link. Add it to the specific report lists it should access; add it to every report list for full reporting access.
- `ADMIN_EMAILS` in `apps/web-next/src/lib/access.ts` are source-controlled, full-access administrators. Do not add a normal report user there.

## Safe update procedure

1. Authenticate with `aws login`, then verify the intended account is `905418447941` with `aws sts get-caller-identity`.
2. Read the current secret, update its JSON in memory or a mode-600 temporary file, and preserve every existing key. Never print the secret or commit it to Git.
3. Add the normalized lower-case address to `ALLOWED_EMAILS` and only the appropriate per-report CSV values. Avoid duplicates.
4. Write the complete JSON back with `aws secretsmanager put-secret-value`.
5. ECS loads Secrets Manager values only when a task starts. Force a rolling refresh of the reporting web service:

   ```bash
   service_arn=$(aws ecs list-services --region us-east-2 --cluster amu-reporting --query 'serviceArns[0]' --output text)
   aws ecs update-service --region us-east-2 --cluster amu-reporting --service "$service_arn" --force-new-deployment
   aws ecs wait services-stable --region us-east-2 --cluster amu-reporting --services "$service_arn"
   ```

6. Verify the replacement task is running and the site login page can send a magic link to the new address.

## Current IAM access

`regina-pirolli` inherits the required effective permissions from the `PlatformEngineer` group: read/write access to the runtime secret plus `ecs:DescribeServices` and `ecs:UpdateService`. No IAM administrator permissions are needed for this operation.

## Agent guardrails

- Do not reveal secret values in terminal output, logs, pull requests, or chat.
- Do not replace the JSON with a partial document; that would remove unrelated runtime configuration.
- Do not change `AUTH_SECRET` during an allowlist update, because doing so invalidates existing sessions and magic links.
- Do not grant `*` permissions or administrator access merely to update approved users.
