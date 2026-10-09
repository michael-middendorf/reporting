import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiveFileKey,
  compareTermKeys,
  contentDisposition,
  groupArchive,
  isArchiveId,
  type ArchiveFile,
} from "./archive";

function file(partial: Partial<ArchiveFile> & Pick<ArchiveFile, "id" | "name">): ArchiveFile {
  return {
    folder: "",
    bytes: 10,
    ext: "xlsx",
    kind: "workbook",
    season: "other",
    year: null,
    contentType: "application/octet-stream",
    sheets: ["Summary"],
    ...partial,
  };
}

test("archive ids stay inside the census prefix", () => {
  assert.equal(isArchiveId("fa-26-census-fall-2026-census-xlsx"), true);
  assert.equal(isArchiveId("../students"), false);
  assert.equal(isArchiveId("FA26"), false);
  assert.equal(isArchiveId(""), false);
  assert.equal(archiveFileKey("fa-26-census-fall-2026-census-xlsx"), "cache/census/archive/files/fa-26-census-fall-2026-census-xlsx");
  assert.throws(() => archiveFileKey("../students"));
});

test("terms run newest fall first, then that year's spring", () => {
  const groups = groupArchive([
    file({ id: "s25", name: "S25 Census.xlsx", season: "spring", year: 2025, folder: "SP 25 Census" }),
    file({ id: "other", name: "STUDENT RESIDENCY.xlsx", season: "other", year: null }),
    file({ id: "fa11", name: "Fall 2011.pdf", kind: "pdf", season: "fall", year: 2011, ext: "pdf", sheets: [] }),
    file({ id: "fa26", name: "Fall 2026 Census.xlsx", season: "fall", year: 2026, folder: "FA 26 Census" }),
    file({ id: "s26", name: "S26 Census.xlsx", season: "spring", year: 2026, folder: "SP 26 Census" }),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["Fall 2026", "Spring 2026", "Spring 2025", "Fall 2011", "Other files"]);
  assert.equal(compareTermKeys("other", "fall-2026"), 1);
});

test("the named census file stays ahead of a side workbook", () => {
  const [group] = groupArchive([
    file({ id: "ipeds", name: "IPEDS Data S26.xlsx", season: "spring", year: 2026 }),
    file({
      id: "s26",
      name: "S26 Census.xlsx",
      kind: "other",
      season: "spring",
      year: 2026,
      sheets: [],
    }),
  ]);
  assert.equal(group.files[0].name, "S26 Census.xlsx");
});

test("the official workbook is chosen over copies", () => {
  const [group] = groupArchive([
    file({ id: "copy", name: "Fall 2023 Census - Copy.xlsx", season: "fall", year: 2023 }),
    file({ id: "eric", name: "Fall 2023 Census Eric.xlsx", season: "fall", year: 2023 }),
    file({ id: "main", name: "Fall 2023 Census.xlsx", season: "fall", year: 2023 }),
  ]);
  assert.equal(group.files[0].name, "Fall 2023 Census.xlsx");
});

test("download names keep spaces and drop quotes", () => {
  const header = contentDisposition('Fall 2020 "Final".xlsx', "attachment");
  assert.match(header, /^attachment; filename="Fall 2020 _Final_.xlsx"/);
  assert.match(header, /filename\*=UTF-8''Fall%202020%20%22Final%22\.xlsx$/);
});
