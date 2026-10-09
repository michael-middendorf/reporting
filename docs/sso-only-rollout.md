# SSO-only rollout
Code is staged with SSO_ONLY=false. Deploy core auth_context support first.
For an approved activation deploy, set SSO_ONLY=true and SSO_CUTOVER_AT to
that deployment's UTC ISO timestamp. Advance the cutoff for each approved
activation deployment to require fresh sign-in. Only verified Entra sessions
created at or after the cutoff are accepted; missing metadata or invalid cutoff
fails closed. Rollback: restore the previous image and SSO_ONLY=false.
Preserve existing authorization and staff MFA. Verify Microsoft sign-in,
existing roles, rejected old sessions, and issuance/redeem rejection before
proceeding to the next app.

## Reporting Microsoft-only source release

Direct Michael request, no Services ticket. The login and anonymous home entry offer only Microsoft sign-in, including a visible unavailable/failure state with no emailed-link fallback. Runtime enforcement is a separate reviewed activation: source controls stay false with an empty cutoff until normal staff Microsoft acceptance and the exact deployment field gate are approved.

Both /auth/mfa and /athletics/coaching/mfa describe Microsoft Authenticator using six numbered steps: open/install, + (Add account), Other account, camera/QR or manual key, the new AMU Academic Affairs entry's six-digit code, then Verify. The existing University entry remains. Existing TOTP, passkeys, recovery controls, QR payloads, eligibility and report permissions remain. Aspiredu's retired MFA page continues redirecting to the shared flow.

The Microsoft callback now validates actual original Core Entra method and aware finite timestamp, including calendar validity and bounded future skew, independently of rollout flags. It preserves the exact timestamp through both signed full-session and pending-session branches and mandatory TOTP/passkey completion. Temporary Core credentials remain server-only and finally-revoked on success/failure. No account mapping or permission changes are inferred from Microsoft sign-in.

Visible thirty-second/focus checks use own /api/auth/me without extending session lifetime. First confirmed401 on private pages hides children and returns to Microsoft login with path/query; login/MFA and anonymous landing do not loop. A known authenticated landing expires on later401. Own host session cookie only is expired, stale Bearer retries a fresh cookie, and403/5xx/network/config outages retain known state. Pending MFA, AspirEDU and shared Core cookies remain.

Local validation:52 Entra/session/lifecycle tests,32 MFA/rendered-instruction tests,55 Cyber tests passed; TypeScript and production build passed. Changed-source lint has zero errors with existing font and two explicit-logout warnings. npmci reported zero vulnerabilities. No production identities, secrets or data were read by these synthetic tests.

Release holds: exact-head independent review and configured security CI, captain's scoped web deployment/persistence gate, existing runtime eligibility/configuration and normal staff Microsoft/MFA acceptance, then separately approved SSO cutoff activation. The current main push workflow republishes SST and changes worker asset references, so this app-source work alone is not permission to run that deployment. No deployment, migration, tenant, role, account or key changes have been executed by this author.

The home report cards now consume the same verified provider identity as the private-page observer. A confirmed401 cannot race a separate cached home identity; a verification outage keeps the provider's known identity and anonymous home remains the Microsoft entry. The actual home render regression verifies known report cards, retained outage state and confirmed401 Microsoft-only output without a second authentication request.
