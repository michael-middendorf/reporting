"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AthleticsRecord } from "@/lib/reports/athletics/types";

export type AthleticsColumn = {
  key: keyof AthleticsRecord;
  label: string;
  render?: (record: AthleticsRecord) => ReactNode;
};

function csvCell(input: unknown) {
  let text = String(input ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportCsv(filename: string, rows: AthleticsRecord[], columns: AthleticsColumn[]) {
  const csv = [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataTable({ rows, columns, rowColor, limit = 250 }: {
  rows: AthleticsRecord[];
  columns: AthleticsColumn[];
  rowColor?: (row: AthleticsRecord) => string;
  limit?: number;
}) {
  const [sortKey, setSortKey] = useState<keyof AthleticsRecord>(columns[0]?.key || "lastName");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const sorted = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => !query || columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(query)))
      .sort((a, b) => {
        const left = a[sortKey];
        const right = b[sortKey];
        const result = typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
        return direction === "asc" ? result : -result;
      });
  }, [rows, columns, search, sortKey, direction]);

  function sort(column: AthleticsColumn) {
    if (sortKey === column.key) setDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(column.key); setDirection("asc"); }
  }

  return (
    <div className="ath-table-wrap">
      <div className="ath-table-tools">
        <label><span className="sr-only">Search table</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this list…" /></label>
        <span>{sorted.length.toLocaleString()} records{sorted.length > limit ? ` · showing first ${limit.toLocaleString()}` : ""}</span>
      </div>
      <div className="ath-table-scroll">
        <table className="ath-table">
          <thead><tr>{columns.map((column) => <th key={String(column.key)}><button type="button" onClick={() => sort(column)}>{column.label}{sortKey === column.key ? direction === "asc" ? " ↑" : " ↓" : ""}</button></th>)}</tr></thead>
          <tbody>
            {sorted.slice(0, limit).map((row) => (
              <tr key={`${row.kind}-${row.id}`} style={rowColor ? { background: rowColor(row) } : undefined}>
                {columns.map((column) => <td key={String(column.key)}>{column.render ? column.render(row) : String(row[column.key] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sorted.length && <div className="ath-empty">No records match the current filters.</div>}
    </div>
  );
}

export const formatCurrency = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
