import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipEntries } from "../census/xlsx";
import { PCID_PATTERN, buildMajorsPayload, type MajorsReady } from "./shape";
import { FIXTURE_NOW, fixtureSources } from "./test-fixtures";
import { buildMajorsWorkbook, majorsFileName } from "./workbook";

function payload(): MajorsReady {
  const p = buildMajorsPayload(fixtureSources(), {}, FIXTURE_NOW);
  assert.equal(p.status, "ready");
  return p as MajorsReady;
}

describe("majors workbook", () => {
  it("has the five aggregate sheets", () => {
    const files = unzipEntries(buildMajorsWorkbook(payload()));
    const book = files["xl/workbook.xml"] ?? "";
    const names = [...book.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(names, ["Incoming 2027", "Majors", "Majors incl Undeclared", "Minors", "Trends"]);
  });

  it("carries labels and contains no person identifiers", () => {
    const files = unzipEntries(buildMajorsWorkbook(payload()));
    const all = Object.values(files).join("\n");
    assert.match(all, /Mechanical Engineering/);
    assert.match(all, /Grand Total/);
    assert.doesNotMatch(all, PCID_PATTERN);
    assert.equal(all.includes("PEOPLE_CODE_ID"), false);
  });

  it("names the file after the term and incoming year", () => {
    assert.equal(majorsFileName(payload()), "Majors_and_Minors_Fall_2026_Incoming_2027.xlsx");
  });
});
