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
  religions,
}: {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  sports: string[];
  majors: string[];
  religions: string[];
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
      <label>
        Retention
        <select
          value={filters.retention}
          onChange={(e) => set("retention", e.target.value as ReportFilters["retention"])}
        >
          <option value="enrolled">Enrolled (Fall 2026)</option>
          <option value="unretained">Unretained</option>
        </select>
      </label>
      <MultiFilter
        label="Sports"
        emptyLabel="All sports"
        options={sports}
        selected={filters.includedSports}
        onChange={(includedSports) =>
          onChange({
            ...filters,
            includedSports,
            excludedSports: filters.excludedSports.filter((s) => !includedSports.includes(s)),
          })
        }
      />
      <MultiFilter
        label="Hide sports"
        emptyLabel="Don't hide any"
        options={sports}
        selected={filters.excludedSports}
        onChange={(excludedSports) =>
          onChange({
            ...filters,
            excludedSports,
            includedSports: filters.includedSports.filter((s) => !excludedSports.includes(s)),
          })
        }
      />
      {(() => {
        const withoutFootball = filters.excludedSports.some((s) => s.toLowerCase() === "football");
        return (
          <button
            type="button"
            className={withoutFootball ? "filter-chip on" : "filter-chip"}
            onClick={() => {
              const next = withoutFootball
                ? filters.excludedSports.filter((s) => s.toLowerCase() !== "football")
                : [...filters.excludedSports.filter((s) => s.toLowerCase() !== "football"), "Football"];
              onChange({
                ...filters,
                includedSports: filters.includedSports.filter((s) => s.toLowerCase() !== "football"),
                excludedSports: next,
              });
            }}
          >
            W/O football
          </button>
        );
      })()}
      <button
        type="button"
        className={filters.retention === "unretained" ? "filter-chip on" : "filter-chip"}
        onClick={() => set("retention", filters.retention === "unretained" ? "enrolled" : "unretained")}
      >
        Unretained
      </button>
      <MultiFilter
        label="Religion"
        emptyLabel="All religions"
        options={religions}
        selected={filters.religions}
        onChange={(next) => set("religions", next)}
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
