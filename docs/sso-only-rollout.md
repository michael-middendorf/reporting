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
