"use client";

import {
  DEFAULT_FILTERS,
  DEGREE_OPTIONS,
  filtersActive,
  type ReportFilters,
} from "@/lib/reports/census/report";

export function fmtN(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function SheetTable({
  title,
  headers,
  rows,
  note,
  scroll,
}: {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  note?: string;
  scroll?: boolean;
}) {
  return (
    <div className={scroll ? "sheet-table sheet-list" : "sheet-table"}>
      {title ? <div className="sheet-caption">{title}</div> : null}
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} className={i === 0 ? "" : "num"}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row[0] === "Total" || row[0] === "Totals" ? "total" : ""}>
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? "" : "num"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="note">{note}</p>}
    </div>
  );
}

function MultiFilter({
  label,
  options,
  selected,
  onChange,
  emptyLabel,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  const set = new Set(selected);
  return (
    <details className="filter-menu">
      <summary>
        {label}
        {selected.length ? ` (${selected.length})` : ""}
      </summary>
      <div className="filter-menu-body">
        <button type="button" className="filter-link" onClick={() => onChange([])}>
          {emptyLabel}
        </button>
        {options.map((opt) => (
          <label key={opt}>
            <input
              type="checkbox"
              checked={set.has(opt)}
              onChange={() => {
                const next = new Set(set);
                if (next.has(opt)) next.delete(opt);
                else next.add(opt);
                onChange([...next].sort((a, b) => a.localeCompare(b)));
              }}
            />
            {opt}
          </label>
        ))}
      </div>
    </details>
  );
}

export function FilterBar({
  filters,
  onChange,
  sports,
  majors,
}: {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  sports: string[];
  majors: string[];
}) {
  function set<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    onChange({ ...filters, [key]: value });
  }
  const active = filtersActive(filters);
  return (
    <div className="filter-bar">
      <label>
        Gender
        <select value={filters.gender} onChange={(e) => set("gender", e.target.value as ReportFilters["gender"])}>
          <option value="all">All</option>
          <option value="Female">Female</option>
          <option value="Male">Male</option>
        </select>
      </label>
      <label>
        Athletes
        <select value={filters.athlete} onChange={(e) => set("athlete", e.target.value as ReportFilters["athlete"])}>
          <option value="all">All</option>
          <option value="Athlete">Athletes only</option>
          <option value="Non-Athlete">Non-athletes only</option>
        </select>
      </label>
      <label>
        Degree type
        <select value={filters.degree} onChange={(e) => set("degree", e.target.value as ReportFilters["degree"])}>
          {DEGREE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <MultiFilter
        label="Hide sports from counts"
        emptyLabel="Show all sports"
        options={sports}
        selected={filters.excludedSports}
        onChange={(excludedSports) => set("excludedSports", excludedSports)}
      />
      <MultiFilter
        label="Majors"
        emptyLabel="All majors"
        options={majors}
        selected={filters.majors}
        onChange={(next) => set("majors", next)}
      />
      {active && (
        <button type="button" className="filter-reset" onClick={() => onChange(DEFAULT_FILTERS)}>
          Reset to census view
        </button>
      )}
    </div>
  );
}
