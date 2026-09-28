import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SAFE_LOCAL_PATH_MAX_LENGTH, entraReturnPath, safeLocalPath } from "./safe-local-path";

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
});
