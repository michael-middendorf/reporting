# Reporting authentication operations

The reporting site uses passwordless magic-link authentication, plus an optional "Sign in with Microsoft" button (see [Microsoft sign-in](#microsoft-sign-in)). It does not use a password form for hub sign-in.

Academic Affairs users (admins plus the `aspiredu` allowlist, including daniel.davy@avemaria.edu, maria.t.gomez@avemaria.edu, and alexandra.r.baalman@avemaria.edu) and athletics coaching users complete a second factor at sign-in: a TOTP authenticator code, or a passkey they set up after the first sign-in. The passkey replaces the 6-digit code at the next sign-in. It does not replace the email magic link.

Enrollment, housing, census, and other users without Academic Affairs or coaching access keep magic-link-only sign-in. There is no second MFA wall on Academic Affairs pages after the hub session exists. Coaching named-athlete academics use that same hub MFA (or a leftover `amu_aspiredu_mfa` cookie on older coaching sessions). Staff do not get a Cognito password. The unused `amu-reporting-aspiredu` Cognito user pool remains in the stack and is not used for this sign-in.

The only URL to send people is **https://reporting.avemaria.edu**. After they sign in, the hub shows the reports their email is allowed to open. Do not send `/enrollment`, `/advancement`, `/annunciation`, `/advancement/chapel-naming`, `/advancement/mgo-top-prospects`, `/advancement/stained-glass-windows`, `/advancement/points`, or CloudFront links.

## Sign-in

There is no daily sign-in email and no unsolicited magic-link blast. People bookmark the hub.

- Unauthenticated visitors see the hub login form and request a magic link for their allowlisted work email.
- That on-demand link expires in 15 minutes (`AUTH_MAGIC_LINK_TTL_MINUTES`) and is single-use. Consume is still POST-only; the magic page auto-completes once the tab is visible so email scanners that only GET do not burn the nonce.
- Users who do not need MFA at sign-in get an HttpOnly session cookie (`amu_reporting_session`) for 14 days (`AUTH_SESSION_TTL_DAYS`) immediately after the magic page completes.
- Academic Affairs and coaching users get a short-lived `amu_reporting_mfa_pending` cookie instead, then finish TOTP or passkey on `/auth/mfa`. Success mints the same 14-day `amu_reporting_session` with an `mfa` claim. Existing enrolled TOTP secrets in Dynamo (`totp#enrolled#<email>` on `amu-reporting-aspiredu-sessions`) keep working. `/athletics/coaching/mfa` remains as a fallback for older coaching sessions that still have `amu_aspiredu_mfa`.
- After sign-in, Academic Affairs users can add a passkey at `/settings/security`. Passkeys are stored in the same Dynamo table as TOTP, as base64url credential ids and public keys. WebAuthn RP id and origin come from `APP_BASE_URL` (`reporting.avemaria.edu`).
- Notification mail (for example new Annunciation Circle members) must link to the hub with no `?token=`.
- Old inbox messages titled "Your AMU Reporting sign-in link" are expired login tokens, not the report. Send people to the hub instead.

## Microsoft sign-in

"Sign in with Microsoft" (Entra ID) is a second way to prove the same work email. The magic link always stays available. Reporting keeps its own `amu_reporting_session`; it does not use core sessions.

### Flow

1. The login form shows a plain link to `GET /api/auth/microsoft` (optionally `?next=<same-origin path>`). It sets four short-lived cookies (`amu_reporting_entra_state`, `_verifier`, `_nonce`, `_from`; HttpOnly, Secure, SameSite=Lax, Path=`/api/auth/microsoft`, 10 minutes) and 302s to `login.microsoftonline.com` with PKCE S256, `response_mode=query`, `prompt=select_account`.
2. Microsoft returns to `GET /api/auth/microsoft/callback?code&state`. The route checks `state` against its cookie, then POSTs `{code, code_verifier, redirect_uri, nonce}` to core `POST /user-sessions/from-entra`. Core holds the only Entra client secret and verifies the ID token.
3. Core answers 201 with a `session_token` Set-Cookie. Reporting uses that core token once for `GET /users/me` to read the verified email, then always calls `DELETE /user-sessions/current`, so no core session is left behind. The token and code are never logged or sent to the browser.
4. The email must pass `canLogin()`, the same allowlist the magic link uses. Then the same code as `POST /api/auth/complete` (`src/lib/sign-in-after-verification.ts`) decides the result:
   - Academic Affairs and coaching users get `amu_reporting_mfa_pending` and go to `/auth/mfa`. **MFA is still required.** Microsoft sign-in never sets the `mfa` claim, because core does not pass Microsoft's `amr` claim.
   - Everyone else gets the 14-day `amu_reporting_session` (no `mfa` claim) and returns to the saved `next` path, or `/`.
5. Any failure clears the four cookies and redirects to `/login?microsoft=failed`, which tells the user to use the email link or contact IT.

### Redirect URI

Exactly one: `https://reporting.avemaria.edu/api/auth/microsoft/callback`. It is built from `APP_BASE_URL`, never from Host or `x-forwarded-*` headers, with no trailing slash. It must be byte-identical in the Entra app registration ("AMU Apps Sign-In"), core `REDIRECT_URI_APPS` (avemaria-api), and this app. There is no localhost entry: `http://localhost:3000` belongs to another app in core.

### Environment

The button shows, and both routes work, only when `NODE_ENV=production` **and** all of these are set on the web task:

| Variable | Value |
|---|---|
| `ENTRA_TENANT_ID` | `7f4bc07b-d9b5-43c4-a1d6-bce660187973` (public) |
| `ENTRA_CLIENT_ID` | `66a8909d-d22e-41bf-9092-4dbe06e393b0` (public) |
| `CORE_API_URL` | `https://core.avemaria.edu` |

`APP_BASE_URL` (already set to `https://reporting.avemaria.edu`) supplies the redirect URI. No secret is needed in this app. With any variable missing the login page shows only the email form and `/api/auth/microsoft` redirects to `/login`.

### Identity

The email is the Entra UPN as core records it. A person whose UPN differs from the address on the report allowlists is refused (sent to `/login?microsoft=failed`); they are never mapped to another account. Add the UPN to the allowlist only if that person should have access.

### Debugging `/login?microsoft=failed`

- Reporting logs (`/ecs/amu-reporting/web-v3`, filter `"[entra]"`) name the failing step without the code, token, or email: `state`, `missing_cookies`, `microsoft_error`, `core_exchange` (with core's status), `not_permitted`, or `disabled`.
- Core logs: `/ecs/avemaria-api`, filter `"from-entra"`. No line means reporting failed before calling core. 503 means core's Entra settings are missing. 401 for everyone means the redirect URI is not on core's allowlist, the Entra client secret expired, or clock skew. 201 followed by `not_permitted` means the verified email is not on any report list.

## Authorization model

- The runtime configuration is the AWS Secrets Manager secret `amu-reporting/production/runtime` in `us-east-2`.
- `ALLOWED_EMAILS` must contain every person who may complete a magic-link sign-in.
- Each report also has its own CSV allowlist: `ENROLLMENT_ALLOWED_EMAILS`, `CENSUS_ALLOWED_EMAILS`, `ATHLETICS_ALLOWED_EMAILS`, `HOUSING_ALLOWED_EMAILS`, `INSTITUTE_ALLOWED_EMAILS`, `MAS_ALLOWED_EMAILS`, `POINTS_ALLOWED_EMAILS`, `ALUMNI_ALLOWED_EMAILS`, `ADVANCEMENT_ALLOWED_EMAILS`, `CHAPEL_ALLOWED_EMAILS`, and `ANNUNCIATION_ALLOWED_EMAILS`.
- `chapel` is Chapel Naming + Stained Glass only. Advancement grants include chapel. Do not put chapel-only people on `ADVANCEMENT_ALLOWED_EMAILS`.
- The Music Prospect & Award Board is not a reporting product. It lives at https://hub.avemaria.edu/music. `/music` on this host 308s there. Do not grant Trenton O'Neil reporting access for Music.
- An email must be in at least one report list to receive a magic link. Add it to the specific report lists it should access; add it to every report list for full reporting access.
- `ADMIN_EMAILS` in `apps/web-next/src/lib/access.ts` are source-controlled, full-access administrators. Do not add a normal report user there.

## Athletics sport scoping

Athletics Master is sport-scoped for head coaches. Hub admins (`ADMIN_EMAILS`) and athletics leadership (`eric.vanheusen@avemaria.edu`, `john.weisbrod@avemaria.edu`, `elizabeth.feger@avemaria.edu`) see every sport, including rows with an empty sport. They stay on `REPORT_ALLOWED.athletics` and the unrestricted-athletics set; they are not hub admins.

Head coaches are listed in `REPORT_ALLOWED.athletics` and the assignment map in `apps/web-next/src/lib/access.ts`. They may request a magic link and receive only matching `GET /api/athletics-data` rows: Slate PersonSport (ungendered names such as Basketball), plus Gender `M` / `F` when the assignment is men's or women's. Empty-sport rows are hidden from coaches. An athletics-allowlisted address with no map entry gets zero rows, not all sports.

Do not add coaches to `ADMIN_EMAILS`. Do not invent an email for Ty Kaufman (interim golf). Filtering happens on the API after the process-wide unfiltered cache; the cache never stores a user-filtered copy.

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
