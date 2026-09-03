/** Minimal browser-safe xlsx writer (ZIP STORE). No extra dependencies. */

export type CellValue = string | number | null | undefined;

type Sheet = {
  name: string;
  rows: CellValue[][];
};

const encoder = new TextEncoder();

export class SimpleXlsx {
  private readonly sheets: Sheet[] = [];

  addSheet(name: string, rows: CellValue[][]): this {
    this.sheets.push({ name: sanitizeSheetName(name), rows });
    return this;
  }

  write(): Uint8Array {
    if (this.sheets.length === 0) {
      throw new Error("Workbook needs at least one sheet");
    }
    const files: { name: string; data: Uint8Array }[] = [
      { name: "[Content_Types].xml", data: utf8(contentTypes(this.sheets.length)) },
      { name: "_rels/.rels", data: utf8(RELS_ROOT) },
      { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels(this.sheets.length)) },
      { name: "xl/workbook.xml", data: utf8(workbookXml(this.sheets)) },
    ];
    this.sheets.forEach((sheet, i) => {
      files.push({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: utf8(sheetXml(sheet)),
      });
    });
    return zipStore(files);
  }
}

export function triggerXlsxDownload(filename: string, bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
  return cleaned || "Sheet";
}

function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function cellRef(row: number, col: number): string {
  return `${colLetter(col)}${row}`;
}

function contentTypes(count: number): string {
  const overrides = Array.from({ length: count }, (_, i) => {
    return `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    overrides +
    `</Types>`
  );
}

const RELS_ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function workbookRels(n: number): string {
  const rels = Array.from({ length: n }, (_, i) => {
    return `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  }).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels +
    `</Relationships>`
  );
}

function workbookXml(sheets: Sheet[]): string {
  const sheetEls = sheets
    .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheetEls}</sheets></workbook>`
  );
}

function sheetXml(sheet: Sheet): string {
  let maxR = 1;
  let maxC = 1;
  const rowXml: string[] = [];
  sheet.rows.forEach((row, rIdx) => {
    const r = rIdx + 1;
    maxR = Math.max(maxR, r);
    const cells: string[] = [];
    row.forEach((value, cIdx) => {
      if (value === undefined || value === null || value === "") return;
      const c = cIdx + 1;
      maxC = Math.max(maxC, c);
      const ref = cellRef(r, c);
      if (typeof value === "number" && Number.isFinite(value)) {
        cells.push(`<c r="${ref}"><v>${value}</v></c>`);
        return;
      }
      const t = xmlEscape(String(value));
      cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${t}</t></is></c>`);
    });
    if (cells.length === 0) return;
    rowXml.push(`<row r="${r}">${cells.join("")}</row>`);
  });
  const pane =
    sheet.rows.length > 0
      ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
      : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${cellRef(maxR, maxC)}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetData>${rowXml.join("")}</sheetData>` +
    `</worksheet>`
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const now = new Date();
  const dosTime =
    ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
  const dosDate =
    (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = file.data;
    const crc = crc32(raw);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, raw.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, raw);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, raw.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + raw.length;
  }

  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return concat([...locals, ...centrals, eocd]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Read uncompressed ZIP STORE entries written by this module. */
export function unzipStore(buf: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 0;
  const decoder = new TextDecoder("utf-8");
  while (i + 4 <= buf.length && view.getUint32(i, true) === 0x04034b50) {
    const method = view.getUint16(i + 8, true);
    const size = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const name = decoder.decode(buf.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extraLen;
    const payload = buf.subarray(start, start + size);
    if (method !== 0) throw new Error(`Unsupported zip method ${method} for ${name}`);
    out[name] = decoder.decode(payload);
    i = start + size;
  }
  return out;
}
