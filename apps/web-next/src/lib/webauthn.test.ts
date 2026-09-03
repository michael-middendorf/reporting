import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { base64UrlToBytes, bytesToBase64Url, webauthnRelyingParty } from "./webauthn";

describe("webauthnRelyingParty", () => {
  it("derives rpID and origin from APP_BASE_URL and never defaults to localhost", () => {
    const rp = webauthnRelyingParty("https://reporting.avemaria.edu");
    assert.equal(rp.rpName, "AMU Reporting");
    assert.equal(rp.rpID, "reporting.avemaria.edu");
    assert.equal(rp.origin, "https://reporting.avemaria.edu");
    assert.notEqual(rp.rpID, "localhost");
    assert.throws(() => webauthnRelyingParty(""), /APP_BASE_URL is not configured/);
    assert.throws(() => webauthnRelyingParty(undefined), /APP_BASE_URL is not configured/);
    assert.throws(() => webauthnRelyingParty("not a url"), /APP_BASE_URL is invalid/);
  });
});

describe("credential id encoding", () => {
  it("round-trips bytes as base64url and does not UTF-8-encode the id", () => {
    const idBytes = new Uint8Array([0xff, 0x00, 0x80, 0x01, 250]);
    const encoded = bytesToBase64Url(idBytes);
    assert.equal(isoBase64URL.isBase64URL(encoded), true);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.equal(encoded.includes("+"), false);
    assert.equal(encoded.includes("/"), false);
    assert.equal(encoded.includes("="), false);
    assert.deepEqual([...base64UrlToBytes(encoded)], [...idBytes]);
    const asUtf8 = Buffer.from(idBytes).toString("utf8");
    assert.notEqual(asUtf8, encoded);
    assert.notDeepEqual([...Buffer.from(asUtf8, "utf8")], [...idBytes]);
  });
});
