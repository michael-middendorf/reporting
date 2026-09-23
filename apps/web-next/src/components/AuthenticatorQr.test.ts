import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import jsQR from "jsqr";
import { otpauthUrl } from "../lib/totp";
import { AuthenticatorSetup, groupedSecret } from "./AuthenticatorQr";

const SAMPLE_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SAMPLE_URL = otpauthUrl("person@avemaria.edu", SAMPLE_SECRET);

function enrollmentMarkup(otpauth?: string) {
  return renderToStaticMarkup(
    createElement(AuthenticatorSetup, {
      secret: SAMPLE_SECRET,
      otpauth,
      label: "Authenticator key",
      copied: false,
    }),
  );
}

function decodeQrSvg(svg: string): string {
  const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(viewBox, "QR svg is missing a viewBox");
  const numCells = Number(viewBox[1]);
  assert.equal(viewBox[2], viewBox[1]);
  const dark = svg.match(/fill="#000000" d="([^"]*)"/);
  assert.ok(dark, "QR svg is missing black modules");
  const grid = Array.from({ length: numCells }, () => Array<boolean>(numCells).fill(false));
  const rects = /M(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?) *h(-?\d+(?:\.\d+)?)v(-?\d+(?:\.\d+)?)H(-?\d+(?:\.\d+)?)z/g;
  let painted = 0;
  for (const match of dark[1].matchAll(rects)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const w = Number(match[3]);
    const h = Number(match[4]);
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        assert.ok(row >= 0 && col >= 0 && row < numCells && col < numCells);
        grid[row][col] = true;
        painted += 1;
      }
    }
  }
  assert.ok(painted > 0, "QR svg painted no modules");
  const quiet = quietZone(grid);
  assert.ok(quiet >= 2, `quiet zone was ${quiet} modules`);

  const scale = 8;
  const size = numCells * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < numCells; row += 1) {
    for (let col = 0; col < numCells; col += 1) {
      const value = grid[row][col] ? 0 : 255;
      for (let dy = 0; dy < scale; dy += 1) {
        const y = row * scale + dy;
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = (y * size + col * scale + dx) * 4;
          data[offset] = value;
          data[offset + 1] = value;
          data[offset + 2] = value;
          data[offset + 3] = 255;
        }
      }
    }
  }
  const decoded = jsQR(data, size, size, { inversionAttempts: "dontInvert" });
  assert.ok(decoded, "QR svg did not decode");
  return decoded.data;
}

function quietZone(grid: boolean[][]) {
  const size = grid.length;
  let quiet = size;
  for (let i = 0; i < size; i += 1) {
    if (grid[0][i] || grid[size - 1][i] || grid[i][0] || grid[i][size - 1]) return 0;
  }
  for (let edge = 0; edge < size; edge += 1) {
    const rowDark = grid[edge].some(Boolean) || grid[size - 1 - edge].some(Boolean);
    const colDark = grid.some((row) => row[edge] || row[size - 1 - edge]);
    if (rowDark || colDark) {
      quiet = edge;
      break;
    }
  }
  return quiet;
}

test("authenticator QR decodes to the enroll otpauth URL and keeps the manual key", () => {
  const html = enrollmentMarkup(SAMPLE_URL);
  const svg = html.match(/<svg[\s\S]*?<\/svg>/);
  assert.ok(svg, "enrollment setup did not render a QR svg");
  assert.equal(decodeQrSvg(svg[0]), SAMPLE_URL);
  assert.match(svg[0], /width="220"/);
  assert.match(svg[0], /height="220"/);
  assert.match(svg[0], /fill="#ffffff"/);
  assert.match(svg[0], /fill="#000000"/);
  assert.match(svg[0], /aria-label="Authenticator QR code"/);
  assert.match(svg[0], /<title>Authenticator QR code<\/title>/);
  assert.equal(svg[0].includes(SAMPLE_SECRET), false);
  assert.equal(svg[0].includes(SAMPLE_URL), false);
  assert.equal(svg[0].includes("otpauth"), false);

  const key = groupedSecret(SAMPLE_SECRET);
  const keyAt = html.indexOf(key);
  assert.ok(keyAt > html.indexOf("<svg"), "manual key should sit below the QR");
  assert.match(html, /Authenticator key/);
  assert.match(html, />Copy key</);
});

test("enrollment setup still shows the manual key when otpauth is missing", () => {
  for (const otpauth of [undefined, ""]) {
    const html = enrollmentMarkup(otpauth);
    assert.equal(html.includes("<svg"), false);
    assert.match(html, new RegExp(groupedSecret(SAMPLE_SECRET)));
    assert.match(html, />Copy key</);
    assert.equal(html.includes(SAMPLE_SECRET), false);
  }
});

test("live enrollment screens render the shared setup and the retired page does not", () => {
  const hub = readFileSync(path.join(process.cwd(), "src/app/auth/mfa/page.tsx"), "utf8");
  const coaching = readFileSync(path.join(process.cwd(), "src/app/athletics/coaching/mfa/page.tsx"), "utf8");
  const aspiredu = readFileSync(path.join(process.cwd(), "src/app/aspiredu/mfa/page.tsx"), "utf8");
  for (const source of [hub, coaching]) {
    const flat = source.replace(/\s+/g, " ");
    assert.match(flat, /AuthenticatorSetup/);
    assert.match(flat, /Scan this code/);
    assert.match(flat, /type the key/);
    assert.doesNotMatch(source, /otpauth:\/\//);
  }
  assert.match(hub, /passkey on Security/);
  assert.match(aspiredu, /redirect\(/);
  assert.doesNotMatch(aspiredu, /AuthenticatorSetup/);
  assert.doesNotMatch(aspiredu, /Copy key/);
});
