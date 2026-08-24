import assert from "node:assert/strict";
import test from "node:test";
import { generateTotpSecret, otpauthUrl, totpAt, verifyTotp } from "./totp";

test("generates a 32-character base32 secret and matching otpauth URL", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const url = otpauthUrl("michael.t.middendorf@avemaria.edu", secret);
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.equal(url.includes(secret), true);
  assert.equal(url.includes("AMU%20Academic%20Affairs"), true);
});

test("verifies the current TOTP window and rejects a wrong code", () => {
  const secret = generateTotpSecret();
  const now = Date.parse("2026-08-24T15:00:00Z");
  const code = totpAt(secret, now);
  assert.equal(code.length, 6);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, totpAt(secret, now - 30_000), now), true);
  assert.equal(verifyTotp(secret, "000000", now), false);
  assert.equal(verifyTotp(secret, "abcdef", now), false);
});
