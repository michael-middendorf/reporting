import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXCEL_CELL_MAX_CHARS, XlsxWorkbook, excelCellText, unzipEntries } from "./xlsx";

function sheetXml(value: string): string {
  const wb = new XlsxWorkbook();
  wb.addSheet("Data").set(1, 1, value);
  return unzipEntries(wb.writeBuffer())["xl/worksheets/sheet1.xml"]!;
}

describe("xlsx cell text", () => {
  it("strips XML-illegal characters, including U+FFFE and U+FFFF", () => {
    const xml = sheetXml("ok\u0001￾￿done\ttab & <b>");
    assert.match(xml, /<t xml:space="preserve">okdone\ttab &amp; &lt;b&gt;<\/t>/);
    assert.doesNotMatch(xml, /[\u0001￾￿]/);
  });

  it("keeps text at the Excel limit and truncates longer text with a trailing ...", () => {
    const exact = "a".repeat(EXCEL_CELL_MAX_CHARS);
    assert.equal(excelCellText(exact), exact);
    const long = excelCellText("b".repeat(EXCEL_CELL_MAX_CHARS + 50));
    assert.equal(long.length, EXCEL_CELL_MAX_CHARS);
    assert.ok(long.endsWith("bbb..."));
    const xml = sheetXml("c".repeat(40_000));
    const text = /<t xml:space="preserve">([^<]*)<\/t>/.exec(xml)![1]!;
    assert.equal(text.length, EXCEL_CELL_MAX_CHARS);
    assert.ok(text.endsWith("..."));
  });

  it("does not split a surrogate pair when truncating", () => {
    const cutAt = EXCEL_CELL_MAX_CHARS - 3;
    const value = "x".repeat(cutAt - 1) + "\u{1F600}" + "y".repeat(100);
    const out = excelCellText(value);
    assert.ok(out.endsWith("x..."));
    assert.ok(out.length <= EXCEL_CELL_MAX_CHARS);
  });

  it("leaves numbers and ordinary strings unchanged", () => {
    const wb = new XlsxWorkbook();
    const ws = wb.addSheet("Data");
    ws.set(1, 1, 42);
    ws.set(1, 2, "Plain text");
    const xml = unzipEntries(wb.writeBuffer())["xl/worksheets/sheet1.xml"]!;
    assert.match(xml, /<c r="A1"><v>42<\/v><\/c>/);
    assert.match(xml, /<t xml:space="preserve">Plain text<\/t>/);
  });
});
