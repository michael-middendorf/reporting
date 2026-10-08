/** Runtime rollout policy. Metadata must come from core or a verified app session. */
export type AuthContext = { method: 'entra' | 'magic_link' | 'otp' | 'api_key' | null; created_at: string } | null;
export function ssoOnlyEnabled(): boolean {
  const value = process.env.SSO_ONLY?.trim().toLowerCase();
  return value !== undefined && value !== '' && value !== 'false';
}
export function ssoSessionAccepted(context: unknown): boolean {
  if (!ssoOnlyEnabled()) return true;
  if (process.env.SSO_ONLY?.trim().toLowerCase() !== 'true') return false;
  const cutoff = process.env.SSO_CUTOVER_AT ?? '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(cutoff)) return false;
  const at = Date.parse(cutoff);
  if (!Number.isFinite(at) || !context || typeof context !== 'object') return false;
  const auth = context as { method?: unknown; created_at?: unknown };
  if (auth.method !== 'entra' || typeof auth.created_at !== 'string') return false;
  const issued = Date.parse(auth.created_at);
  return Number.isFinite(issued) && issued >= at && issued <= Date.now() + 60_000;
}
