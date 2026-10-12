import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAFE_LOCAL_PATH_MAX_LENGTH,
  carriedReturnPath,
  entraReturnPath,
  safeLocalPath,
  withNextParam,
} from "./safe-local-path";

// Every value here must never survive as a return path.
const HOSTILE = [
  "//evil.com",
  "///evil.com",
  "/\\evil.com",
  "/\\/evil.com",
  "/..//evil.com",
  "/./evil.com",
  "/%2e%2e//evil.com",
  "/a/../..//evil.com",
  "https://evil.com",
  "http:/evil.com",
  "javascript:alert(1)",
  "evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/a\u0000b",
  "/a\u007fb",
  "/..%2f/evil",
  "/a%2f..%2f..",
  "/..%5C/evil",
];

describe("safeLocalPath", () => {
  it("keeps same-origin paths", () => {
    assert.equal(safeLocalPath("/"), "/");
    assert.equal(safeLocalPath("/enrollment"), "/enrollment");
    assert.equal(safeLocalPath("/advancement/points?tab=1#x"), "/advancement/points?tab=1#x");
  });

  it("falls back to / for missing or non-path values", () => {
    for (const raw of [null, undefined, "", "enrollment", "https://evil.example", "javascript:alert(1)", " /x"]) {
      assert.equal(safeLocalPath(raw), "/", String(raw));
    }
  });

  it("rejects protocol-relative and backslash tricks", () => {
    for (const raw of ["//evil.example", "///evil.example", "/\\evil.example", "/a\\b"]) {
      assert.equal(safeLocalPath(raw), "/", raw);
    }
  });

  it("rejects control characters", () => {
    for (const raw of ["/\t/evil.example", "/a\nb", "/a\rb", "/a\u0000b", "/a\u007fb"]) {
      assert.equal(safeLocalPath(raw), "/", JSON.stringify(raw));
    }
  });

  it("rejects dot segments that normalize to //evil.com", () => {
    for (const raw of ["/..//evil.com", "/./evil.com", "/%2e%2e//evil.com", "/%2E/x", "/a/../..//evil.com", "/.."]) {
      assert.equal(safeLocalPath(raw), "/", raw);
    }
    // Dots inside a segment, or in the query, are fine.
    assert.equal(safeLocalPath("/files/report.v2"), "/files/report.v2");
    assert.equal(safeLocalPath("/x?path=../y"), "/x?path=../y");
  });

  it("rejects percent-encoded / or \\ in the path, any case", () => {
    for (const raw of [
      "/..%2f/evil",
      "/..%2F/evil",
      "/a%2f..%2f..",
      "/a%2F..%2F..",
      "/%2fevil.com",
      "/%2F%2Fevil.com",
      "/..%5c/evil",
      "/..%5C/evil",
      "/a%5cb",
      "/census%2fx?term=FA26",
    ]) {
      assert.equal(safeLocalPath(raw), "/", raw);
      assert.equal(entraReturnPath(raw), null, raw);
      assert.equal(carriedReturnPath(raw), null, raw);
    }
  });

  it("leaves dots and encoded values in the query and fragment alone", () => {
    for (const raw of [
      "/census?file=..%2f..%2fx",
      "/census?path=a%2Fb%5Cc",
      "/x?path=../y&v=1.2",
      "/advancement/points#a%2fb",
      "/files/report.v2?q=%2e%2e",
    ]) {
      assert.equal(safeLocalPath(raw), raw, raw);
      assert.equal(carriedReturnPath(raw), raw, raw);
    }
  });

  it("caps the length", () => {
    const ok = `/${"a".repeat(SAFE_LOCAL_PATH_MAX_LENGTH - 1)}`;
    assert.equal(safeLocalPath(ok), ok);
    assert.equal(safeLocalPath(`${ok}a`), "/");
  });
});

describe("entraReturnPath", () => {
  it("keeps safe paths and drops unsafe ones instead of coercing", () => {
    assert.equal(entraReturnPath("/census"), "/census");
    assert.equal(entraReturnPath("/"), "/");
    assert.equal(entraReturnPath("//evil.example"), null);
    assert.equal(entraReturnPath("https://evil.example"), null);
    assert.equal(entraReturnPath(""), null);
    assert.equal(entraReturnPath(null), null);
  });

  it("drops every hostile value", () => {
    for (const raw of HOSTILE) assert.equal(entraReturnPath(raw), null, JSON.stringify(raw));
  });
});

describe("carriedReturnPath", () => {
  it("keeps a safe path with its query and fragment", () => {
    assert.equal(carriedReturnPath("/enrollment?term=FA26&x=1"), "/enrollment?term=FA26&x=1");
    assert.equal(carriedReturnPath("/advancement/points?tab=1#x"), "/advancement/points?tab=1#x");
  });

  it("drops hostile values", () => {
    for (const raw of HOSTILE) assert.equal(carriedReturnPath(raw), null, JSON.stringify(raw));
  });

  it("drops the default and sign-in pages", () => {
    for (const raw of ["/", "/?x=1", "/login", "/login?next=%2Fx", "/login/", "/login/anything", "/auth/mfa", "/auth/magic?token=t", null, undefined, ""]) {
      assert.equal(carriedReturnPath(raw), null, String(raw));
    }
  });

  it("keeps paths that only start with the same letters", () => {
    assert.equal(carriedReturnPath("/loginhelp"), "/loginhelp");
    assert.equal(carriedReturnPath("/authors"), "/authors");
  });
});

describe("withNextParam", () => {
  it("appends an encoded next with ? or &", () => {
    assert.equal(withNextParam("/auth/mfa", "/census?a=1&b=2"), "/auth/mfa?next=%2Fcensus%3Fa%3D1%26b%3D2");
    assert.equal(withNextParam("/login?microsoft=failed", "/census"), "/login?microsoft=failed&next=%2Fcensus");
  });

  it("returns the base unchanged for hostile, default, or sign-in paths", () => {
    for (const raw of [...HOSTILE, "/", "/login?x=1", "/auth/mfa", null, undefined]) {
      assert.equal(withNextParam("/auth/mfa", raw), "/auth/mfa", JSON.stringify(raw));
    }
  });
});
