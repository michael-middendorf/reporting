# Reporting authentication operations

The reporting site uses passwordless magic-link authentication. It does not use a password form for hub sign-in.

Academic Affairs student-level rows (names, emails, grades) add a second factor: a TOTP authenticator code after the magic-link session. Staff do not get a Cognito password. The Cognito user pool remains in the stack but is not used for this sign-in.

The only URL to send people is **https://reporting.avemaria.edu**. After they sign in, the hub shows the reports their email is allowed to open. Do not send `/enrollment`, `/advancement`, `/annunciation`, `/advancement/chapel-naming`, `/advancement/mgo-top-prospects`, `/advancement/stained-glass-windows`, `/advancement/points`, or CloudFront links.

## Sign-in

There is no daily sign-in email and no unsolicited magic-link blast. People bookmark the hub.

- Unauthenticated visitors see the hub login form and request a magic link for their allowlisted work email.
- That on-demand link expires in 15 minutes (`AUTH_MAGIC_LINK_TTL_MINUTES`) and is single-use. The extra Continue click on `/auth/magic` exists so email scanners do not consume it.
- A successful sign-in sets an HttpOnly session cookie (`amu_reporting_session`) for 14 days (`AUTH_SESSION_TTL_DAYS`).
- Notification mail (for example new Annunciation Circle members) must link to the hub with no `?token=`.
- Old inbox messages titled "Your AMU Reporting sign-in link" are expired login tokens, not the report. Send people to the hub instead.

## Authorization model

- The runtime configuration is the AWS Secrets Manager secret `amu-reporting/production/runtime` in `us-east-2`.
- `ALLOWED_EMAILS` must contain every person who may complete a magic-link sign-in.
- Each report also has its own CSV allowlist: `ENROLLMENT_ALLOWED_EMAILS`, `CENSUS_ALLOWED_EMAILS`, `ATHLETICS_ALLOWED_EMAILS`, `HOUSING_ALLOWED_EMAILS`, `INSTITUTE_ALLOWED_EMAILS`, `MAS_ALLOWED_EMAILS`, `POINTS_ALLOWED_EMAILS`, `ALUMNI_ALLOWED_EMAILS`, `ADVANCEMENT_ALLOWED_EMAILS`, `CHAPEL_ALLOWED_EMAILS`, `ANNUNCIATION_ALLOWED_EMAILS`, and `MUSIC_ALLOWED_EMAILS`.
- `chapel` is Chapel Naming + Stained Glass only. Advancement grants include chapel. Do not put chapel-only people on `ADVANCEMENT_ALLOWED_EMAILS`.
- `music` is the Music Prospect & Award Board only. Trenton O'Neil is granted in `apps/web-next/src/lib/access.ts`. Do not put him on Enrollment or any other report list. The board has no CSV/Excel download.
- Music workflow toggles save to S3 immediately. If `MUSIC_SLATE_IMPORT_URL` is set, the same PATCH POSTs an update-only Source Format payload (`app_guid` + four music fields) with `SLATE_USERNAME` / `SLATE_PASSWORD` (portal-service). Do not point that URL at the Undergrad Application ingest format. Those three keys now exist on `amu-reporting/production/runtime` and in the ECS task secret map. Unset `MUSIC_SLATE_IMPORT_URL` and bounce ECS to disable dual-write.
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
