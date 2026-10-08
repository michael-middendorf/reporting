import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ssoOnlyEnabled, ssoSessionAccepted } from './sso-policy';
test('SSO rollout rejects unknown, emailed, old sessions and invalid deployment configuration', () => {
  const flag = process.env.SSO_ONLY, cutoff = process.env.SSO_CUTOVER_AT;
  try {
    process.env.SSO_ONLY = 'false';
    assert.equal(ssoSessionAccepted(null), true);
    for (const value of [undefined, '', '   ', 'false', ' FALSE ']) {
      if (value === undefined) delete process.env.SSO_ONLY; else process.env.SSO_ONLY = value;
      assert.equal(ssoOnlyEnabled(), false, String(value));
      assert.equal(ssoSessionAccepted(null), true, String(value));
    }
    process.env.SSO_CUTOVER_AT = '2026-01-01T00:00:00Z';
    for (const value of ['TRUE', ' true ']) {
      process.env.SSO_ONLY = value;
      assert.equal(ssoOnlyEnabled(), true, value);
      assert.equal(ssoSessionAccepted(null), false, value);
      assert.equal(ssoSessionAccepted({method: 'entra', created_at: '2026-01-01T00:00:00Z'}), true, value);
    }
    for (const value of ['typo', '1', 'yes']) {
      process.env.SSO_ONLY = value;
      assert.equal(ssoOnlyEnabled(), true, value);
      assert.equal(ssoSessionAccepted(null), false, value);
      assert.equal(ssoSessionAccepted({method: 'entra', created_at: new Date().toISOString()}), false, value);
    }
    process.env.SSO_ONLY = 'true';

    process.env.SSO_CUTOVER_AT = '2026-01-01T00:00:00Z';
    assert.equal(ssoSessionAccepted(null), false);
    assert.equal(ssoSessionAccepted({method: null, created_at: new Date().toISOString()}), false);
    for (const method of ['otp', 'magic_link', 'api_key']) assert.equal(ssoSessionAccepted({method, created_at: new Date().toISOString()}), false);
    assert.equal(ssoSessionAccepted({method: 'entra', created_at: '2025-12-31T23:59:59Z'}), false);
    assert.equal(ssoSessionAccepted({method: 'entra', created_at: '2026-01-01T00:00:00Z'}), true);
    assert.equal(ssoSessionAccepted({method: 'entra', created_at: new Date().toISOString()}), true);
    assert.equal(ssoSessionAccepted({method: 'entra', created_at: 'invalid'}), false);
    process.env.SSO_CUTOVER_AT = '';
    assert.equal(ssoSessionAccepted({method: 'entra', created_at: new Date().toISOString()}), false);
  } finally {
    if (flag === undefined) delete process.env.SSO_ONLY; else process.env.SSO_ONLY = flag;
    if (cutoff === undefined) delete process.env.SSO_CUTOVER_AT; else process.env.SSO_CUTOVER_AT = cutoff;
  }
});
