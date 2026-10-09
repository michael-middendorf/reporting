"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { groupArchive, type ArchiveFile, type ArchiveManifest, type ArchiveSheet } from "@/lib/reports/census/archive";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cellClass(value: string): string {
  return /^-?[\d,]+(\.\d+)?%?$/.test(value.trim()) ? "num" : "";
}

export function CensusArchive() {
  const [manifest, setManifest] = useState<ArchiveManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [fileId, setFileId] = useState("");
  const [sheet, setSheet] = useState(0);
  const [preview, setPreview] = useState<ArchiveSheet | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/census-archive");
        const json = (await res.json()) as ArchiveManifest & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(json.error || "Census files are unavailable");
          return;
        }
        setManifest(json);
        const groups = groupArchive(json.files || []);
        const first = groups[0];
        if (first) {
          setTerm(first.key);
          setFileId(first.files[0]?.id || "");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => groupArchive(manifest?.files || []), [manifest]);
  const group = groups.find((item) => item.key === term) || groups[0];
  const file = group?.files.find((item) => item.id === fileId) || group?.files[0];

  useEffect(() => {
    if (!file || file.kind !== "workbook") return;
    let alive = true;
    const id = file.id;
    const index = sheet;
    const key = `${id}:${index}`;
    (async () => {
      try {
        const res = await apiFetch(`/api/census-archive/preview?id=${encodeURIComponent(id)}&sheet=${index}`);
        const json = (await res.json()) as ArchiveSheet & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setPreviewError({ key, message: json.error || "This sheet could not be opened" });
          return;
        }
        setPreview(json);
        setPreviewKey(key);
      } catch (e) {
        if (alive) setPreviewError({ key, message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, sheet]);

  const requestKey = file ? `${file.id}:${sheet}` : "";
  const sheetError = previewError?.key === requestKey ? previewError.message : null;
  const sheetReady = Boolean(file && file.kind === "workbook" && previewKey === requestKey && preview);
  const rows = useMemo(() => {
    const all = sheetReady ? preview?.rows || [] : [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)));
  }, [preview, query, sheetReady]);

  async function download(current: ArchiveFile) {
    setDownloadError(null);
    setDownloading(true);
    try {
      const res = await apiFetch(`/api/census-archive/file?id=${encodeURIComponent(current.id)}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = current.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  if (error) return <p className="export-error">{error}</p>;
  if (!manifest) return <p className="archive-note">Loading census files…</p>;
  if (!groups.length) {
    return <p className="archive-note">No census files are published yet.</p>;
  }

  const wide = (preview?.colCount || 0) > 8 || (preview?.rowCount || 0) > 40;
  const openingSheet = file?.kind === "workbook" && !sheetReady && !sheetError;

  return (
    <div className="archive">
      <div className="sheet-head">
        <h2>Census files</h2>
        <p className="sheet-n">
          Saved workbooks from the census folder. The other tabs stay the live Fall 2026 census.
        </p>
      </div>
      <div className="archive-bar">
        <label>
          Census
          <select
            aria-label="Census"
            value={group?.key || ""}
            onChange={(e) => {
              const next = groups.find((item) => item.key === e.target.value);
              setTerm(e.target.value);
              setFileId(next?.files[0]?.id || "");
              setSheet(0);
              setQuery("");
            }}
          >
            {groups.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {group && group.files.length > 1 && (
          <label>
            File
            <select
              aria-label="File"
              value={file?.id || ""}
              onChange={(e) => {
                setFileId(e.target.value);
                setSheet(0);
                setQuery("");
              }}
            >
              {group.files.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({formatBytes(item.bytes)})
                </option>
              ))}
            </select>
          </label>
        )}
        {file && (
          <button type="button" className="download" disabled={downloading} onClick={() => download(file)}>
            {downloading ? "Downloading…" : "Download"}
          </button>
        )}
      </div>
      {downloadError && <p className="export-error">{downloadError}</p>}
      {file && group && group.files.length === 1 && (
        <p className="archive-note">
          {file.folder ? `${file.folder} / ` : ""}
          {file.name} · {formatBytes(file.bytes)}
        </p>
      )}
      {file?.note && <p className="archive-note">{file.note}</p>}

      {file?.kind === "workbook" && file.sheets.length > 0 && (
        <div className="tabs archive-sheets">
          {file.sheets.map((name, index) => (
            <button
              key={`${file.id}-${name}-${index}`}
              type="button"
              className={sheet === index ? "active" : ""}
              onClick={() => {
                setSheet(index);
                setQuery("");
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {file?.kind === "pdf" && (
        <p className="archive-note">This census is a PDF. Download it to open the report.</p>
      )}
      {file && file.kind === "other" && (
        <p className="archive-note">
          This file opens in its own program. Download {file.name} to view it.
        </p>
      )}
      {openingSheet && <p className="archive-note">Opening sheet…</p>}
      {sheetError && <p className="export-error">{sheetError}</p>}

      {sheetReady && preview && (
        <div className="sheet">
          <div className="sheet-head">
            <h2>{preview.name}</h2>
            <p className="sheet-n">
              {preview.rowCount.toLocaleString()} rows
              {preview.truncated ? " · sheet cut off after the published row limit" : ""}
            </p>
          </div>
          {preview.rowCount > 30 && (
            <input
              className="sheet-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this sheet"
              aria-label="Search this sheet"
            />
          )}
          {rows.length === 0 ? (
            <p className="archive-note">{query ? "No matching rows." : "This sheet is empty."}</p>
          ) : (
            <div className={wide ? "sheet-list" : "sheet-table"}>
              <table>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, colIndex) => (
                        <td key={colIndex} className={cellClass(cell)}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
