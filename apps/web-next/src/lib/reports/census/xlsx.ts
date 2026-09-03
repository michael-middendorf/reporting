import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export type CellValue = string | number | null | undefined;

export type BorderStyle = "thin" | "medium";

export type BorderSide = { s: BorderStyle; c: string };

export type CellBorder = {
  t?: BorderSide;
  r?: BorderSide;
  b?: BorderSide;
  l?: BorderSide;
};

export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  fill?: string;
  numFmt?: "int" | "fte" | "pct" | "dec2";
  indent?: number;
  hAlign?: "center" | "left";
  vAlign?: "center" | "top" | "bottom";
  wrap?: boolean;
  border?: CellBorder;
};

type StoredCell = { value: string | number; style: CellStyle };

export class XlsxSheet {
  readonly name: string;
  gridLines = true;
  freezeRows = 0;
  autoFilter: string | null = null;
  private readonly cells = new Map<string, StoredCell>();
  private readonly colWidths = new Map<number, number>();
  private readonly rowHeights = new Map<number, number>();
  private readonly merges: string[] = [];

  constructor(name: string) {
    this.name = sanitizeSheetName(name);
  }

  width(col: number, w: number) {
    this.colWidths.set(col, w);
  }

  height(row: number, h: number) {
    this.rowHeights.set(row, h);
  }

  merge(r1: number, c1: number, r2: number, c2: number) {
    this.merges.push(`${cellRef(r1, c1)}:${cellRef(r2, c2)}`);
  }

  get(row: number, col: number): StoredCell | undefined {
    return this.cells.get(key(row, col));
  }

  set(row: number, col: number, value: CellValue, style: CellStyle = {}) {
    if (value == null || value === "") {
      if (Object.keys(style).length === 0) return;
      const prev = this.cells.get(key(row, col));
      if (!prev) {
        this.cells.set(key(row, col), { value: "", style: { ...style } });
        return;
      }
      prev.style = { ...prev.style, ...style };
      return;
    }
    const prev = this.cells.get(key(row, col));
    this.cells.set(key(row, col), {
      value,
      style: { ...(prev?.style || {}), ...style },
    });
  }

  patch(row: number, col: number, style: CellStyle) {
    const prev = this.cells.get(key(row, col));
    if (!prev) {
      this.cells.set(key(row, col), { value: "", style: { ...style } });
      return;
    }
    prev.style = {
      ...prev.style,
      ...style,
      border: style.border ? { ...prev.style.border, ...style.border } : prev.style.border,
    };
  }

  /** Navy outline + light inner grid around a table (header row through last data row). */
  box(r1: number, c1: number, r2: number, c2: number) {
    const thin: BorderSide = { s: "thin", c: "C5D4E8" };
    const med: BorderSide = { s: "medium", c: "1A3F6F" };
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        this.patch(r, c, {
          border: {
            t: r === r1 ? med : thin,
            b: r === r2 ? med : thin,
            l: c === c1 ? med : thin,
            r: c === c2 ? med : thin,
          },
        });
      }
    }
  }

  /** Used when packing. */
  _dump() {
    return {
      name: this.name,
      gridLines: this.gridLines,
      freezeRows: this.freezeRows,
      autoFilter: this.autoFilter,
      cells: this.cells,
      colWidths: this.colWidths,
      rowHeights: this.rowHeights,
      merges: this.merges,
    };
  }
}

export class XlsxWorkbook {
  readonly sheets: XlsxSheet[] = [];

  addSheet(name: string): XlsxSheet {
    const sheet = new XlsxSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }

  writeBuffer(): Buffer {
    return packXlsx(this.sheets);
  }
}

function key(row: number, col: number): string {
  return `${row}:${col}`;
}

export function cellRef(row: number, col: number): string {
  return `${colLetter(col)}${row}`;
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

function sideKey(side?: BorderSide): string {
  return side ? `${side.s}:${side.c}` : "";
}

function styleKey(s: CellStyle): string {
  const b = s.border;
  return [
    s.bold ? "b" : "",
    s.italic ? "i" : "",
    s.size || 11,
    s.color || "",
    s.fill || "",
    s.numFmt || "",
    s.indent || 0,
    s.hAlign || "",
    s.vAlign || "",
    s.wrap ? "w" : "",
    b ? [sideKey(b.t), sideKey(b.r), sideKey(b.b), sideKey(b.l)].join("/") : "",
  ].join("|");
}

const NUM_FMTS: Record<string, string> = {
  int: "#,##0",
  fte: "#,##0.0",
  pct: "0.0%",
  dec2: "0.00",
};

function packXlsx(sheets: XlsxSheet[]): Buffer {
  const styleIndex = new Map<string, number>();
  const styles: CellStyle[] = [{}];
  styleIndex.set(styleKey({}), 0);

  function xfOf(s: CellStyle): number {
    const k = styleKey(s);
    const hit = styleIndex.get(k);
    if (hit != null) return hit;
    const id = styles.length;
    styles.push(s);
    styleIndex.set(k, id);
    return id;
  }

  const files: { name: string; data: Buffer }[] = [];
  files.push({ name: "[Content_Types].xml", data: contentTypes(sheets.length) });
  files.push({ name: "_rels/.rels", data: Buffer.from(RELS_ROOT) });
  files.push({ name: "xl/_rels/workbook.xml.rels", data: workbookRels(sheets.length) });
  files.push({ name: "xl/workbook.xml", data: workbookXml(sheets) });

  for (let i = 0; i < sheets.length; i++) {
    files.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(sheets[i], xfOf)),
    });
  }
  files.push({ name: "xl/styles.xml", data: Buffer.from(stylesXml(styles)) });

  return zipStore(files);
}

function contentTypes(count: number): Buffer {
  const overrides = Array.from({ length: count }, (_, i) => {
    return `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      overrides +
      `</Types>`,
  );
}

const RELS_ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function workbookRels(n: number): Buffer {
  const rels = Array.from({ length: n }, (_, i) => {
    return `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  }).join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
}

function workbookXml(sheets: XlsxSheet[]): Buffer {
  const sheetEls = sheets
    .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<bookViews><workbookView/></bookViews>` +
      `<sheets>${sheetEls}</sheets></workbook>`,
  );
}

function sheetXml(sheet: XlsxSheet, xfOf: (s: CellStyle) => number): string {
  const d = sheet._dump();
  let maxR = 1;
  let maxC = 1;
  const byRow = new Map<number, { col: number; cell: StoredCell }[]>();
  for (const [k, cell] of d.cells) {
    const [rs, cs] = k.split(":");
    const row = Number(rs);
    const col = Number(cs);
    maxR = Math.max(maxR, row);
    maxC = Math.max(maxC, col);
    const list = byRow.get(row) || [];
    list.push({ col, cell });
    byRow.set(row, list);
  }
  for (const list of byRow.values()) list.sort((a, b) => a.col - b.col);

  const cols =
    d.colWidths.size === 0
      ? ""
      : `<cols>${[...d.colWidths.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`)
          .join("")}</cols>`;

  const rowXml: string[] = [];
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  for (const r of rows) {
    const ht = d.rowHeights.get(r);
    const htAttr = ht != null ? ` ht="${ht}" customHeight="1"` : "";
    const cells = (byRow.get(r) || [])
      .map(({ col, cell }) => cellXml(r, col, cell, xfOf(cell.style)))
      .join("");
    rowXml.push(`<row r="${r}"${htAttr}>${cells}</row>`);
  }

  const paneXml =
    d.freezeRows > 0
      ? `<pane ySplit="${d.freezeRows}" topLeftCell="A${d.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
      : "";
  const grid = d.gridLines ? "" : ` showGridLines="0"`;
  const merges =
    d.merges.length === 0
      ? ""
      : `<mergeCells count="${d.merges.length}">${d.merges
          .map((ref) => `<mergeCell ref="${ref}"/>`)
          .join("")}</mergeCells>`;
  const filter = d.autoFilter ? `<autoFilter ref="${xmlEscape(d.autoFilter)}"/>` : "";

  // ECMA-376 worksheet child order: dimension, sheetViews, cols, sheetData,
  // autoFilter, mergeCells. Excel repairs the file if this is wrong.
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${cellRef(maxR, maxC)}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${grid}>${paneXml}</sheetView></sheetViews>` +
    cols +
    `<sheetData>${rowXml.join("")}</sheetData>` +
    filter +
    merges +
    `</worksheet>`
  );
}

function cellXml(row: number, col: number, cell: StoredCell, xf: number): string {
  const ref = cellRef(row, col);
  const sAttr = xf ? ` s="${xf}"` : "";
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
    return `<c r="${ref}"${sAttr}><v>${cell.value}</v></c>`;
  }
  const t = xmlEscape(String(cell.value));
  return `<c r="${ref}" t="inlineStr"${sAttr}><is><t xml:space="preserve">${t}</t></is></c>`;
}

function stylesXml(styles: CellStyle[]): string {
  const fonts = new Map<string, number>();
  const fills = new Map<string, number>([
    ["none", 0],
    ["gray125", 1],
  ]);
  const fontList: string[] = [
    `<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>`,
  ];
  const fillList: string[] = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
  ];
  const borderList: string[] = [
    `<border><left/><right/><top/><bottom/><diagonal/></border>`,
  ];
  const borderIndex = new Map<string, number>([["", 0]]);
  fonts.set("11|||", 0);

  function edgeXml(name: string, side?: BorderSide): string {
    if (!side) return `<${name}/>`;
    return `<${name} style="${side.s}"><color rgb="FF${side.c}"/></${name}>`;
  }

  function borderId(s: CellStyle): number {
    const b = s.border;
    if (!b) return 0;
    const k = [sideKey(b.t), sideKey(b.r), sideKey(b.b), sideKey(b.l)].join("/");
    const hit = borderIndex.get(k);
    if (hit != null) return hit;
    const id = borderList.length;
    borderList.push(
      `<border>${edgeXml("left", b.l)}${edgeXml("right", b.r)}${edgeXml("top", b.t)}${edgeXml("bottom", b.b)}<diagonal/></border>`,
    );
    borderIndex.set(k, id);
    return id;
  }

  function fontId(s: CellStyle): number {
    const size = s.size || 11;
    const color = s.color || "";
    const k = `${size}|${s.bold ? "b" : ""}|${s.italic ? "i" : ""}|${color}`;
    const hit = fonts.get(k);
    if (hit != null) return hit;
    const id = fontList.length;
    const colorEl = color ? `<color rgb="FF${color}"/>` : `<color theme="1"/>`;
    fontList.push(
      `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}<sz val="${size}"/>${colorEl}<name val="Calibri"/></font>`,
    );
    fonts.set(k, id);
    return id;
  }

  function fillId(s: CellStyle): number {
    if (!s.fill) return 0;
    const hit = fills.get(s.fill);
    if (hit != null) return hit;
    const id = fillList.length;
    fillList.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor rgb="FF${s.fill}"/></patternFill></fill>`);
    fills.set(s.fill, id);
    return id;
  }

  const numFmts = Object.entries(NUM_FMTS)
    .map(([k, fmt], i) => `<numFmt numFmtId="${164 + i}" formatCode="${xmlEscape(fmt)}"/>`)
    .join("");
  const numFmtId: Record<string, number> = Object.fromEntries(
    Object.keys(NUM_FMTS).map((k, i) => [k, 164 + i]),
  );

  const xfs = styles
    .map((s) => {
      const nId = s.numFmt ? numFmtId[s.numFmt] : 0;
      const n = s.numFmt ? ` applyNumberFormat="1"` : "";
      const applyFont = fontId(s) !== 0 ? ` applyFont="1"` : "";
      const applyFill = fillId(s) !== 0 ? ` applyFill="1"` : "";
      const bId = borderId(s);
      const applyBorder = bId !== 0 ? ` applyBorder="1"` : "";
      const alignParts: string[] = [];
      if (s.hAlign) alignParts.push(`horizontal="${s.hAlign}"`);
      if (s.vAlign) alignParts.push(`vertical="${s.vAlign}"`);
      if (s.indent) alignParts.push(`indent="${s.indent}"`);
      if (s.wrap) alignParts.push(`wrapText="1"`);
      const align = alignParts.length ? `<alignment ${alignParts.join(" ")}/>` : "";
      const applyAlign = align ? ` applyAlignment="1"` : "";
      return `<xf numFmtId="${nId}" fontId="${fontId(s)}" fillId="${fillId(s)}" borderId="${bId}" xfId="0"${n}${applyFont}${applyFill}${applyBorder}${applyAlign}>${align}</xf>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="${Object.keys(NUM_FMTS).length}">${numFmts}</numFmts>` +
    `<fonts count="${fontList.length}">${fontList.join("")}</fonts>` +
    `<fills count="${fillList.length}">${fillList.join("")}</fills>` +
    `<borders count="${borderList.length}">${borderList.join("")}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${styles.length}">${xfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const now = new Date();
  const dosTime =
    ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = file.data;
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }

  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

/** Read uncompressed file bytes from a zip we wrote (deflate). */
export function unzipEntries(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    const payload = buf.subarray(start, start + compSize);
    const data = method === 8 ? inflateRawSync(payload) : payload;
    out[name] = data.toString("utf8");
    i = start + compSize;
  }
  return out;
}
