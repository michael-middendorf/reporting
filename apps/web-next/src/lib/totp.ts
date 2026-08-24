import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  return toBase32(randomBytes(20));
}

export function totpAt(secret: string, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", fromBase32(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function verifyTotp(secret: string, code: string, atMs = Date.now(), window = 1): boolean {
  const expected = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(expected)) return false;
  const presented = Buffer.from(expected);
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = Buffer.from(totpAt(secret, atMs + drift * STEP_SECONDS * 1000));
    if (candidate.length === presented.length && timingSafeEqual(candidate, presented)) return true;
  }
  return false;
}

export function otpauthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`AMU Academic Affairs:${email}`);
  const issuer = encodeURIComponent("AMU Academic Affairs");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
