"use client";

import { useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import {
  cycleTerm,
  isMusicCycle,
  type AuditionReview,
  type MusicBoardPayload,
  type MusicCycle,
  type MusicRow,
  type ProgramAcceptance,
  type WorkflowState,
} from "@/lib/reports/music/types";
import styles from "./music.module.css";

const CYCLES: { id: MusicCycle; label: string }[] = [
  { id: "fa27", label: "Fall 2027" },
  { id: "fa26", label: "Fall 2026" },
  { id: "fa25", label: "Fall 2025" },
];

function statusClass(status: string): string {
  if (status === "Deposited" || status === "Attended" || status === "Accepted") return styles.pillOk;
  if (status === "Registered" || status === "Submitted") return styles.pillWarn;
  return styles.pill;
}

function Board() {
  const [data, setData] = useState<MusicBoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<MusicCycle>("fa27");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiFetch("/api/music-data")
      .then(async (r) => {
        const json = (await r.json()) as MusicBoardPayload & { error?: string };
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const rows = useMemo(() => {
    const term = cycleTerm(cycle).toLowerCase();
    const needle = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      if (row.term && !row.term.toLowerCase().includes(term)) return false;
      if (!needle) return true;
      const hay = [row.first, row.last, row.email, row.major, row.minor, row.enrollmentStatus]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [data, cycle, q]);

  async function patchRow(row: MusicRow, body: Partial<WorkflowState>) {
    setSaving(row.applicationId);
    try {
      const res = await apiFetch("/api/music-workflow", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: row.applicationId,
          personId: row.personId,
          ...body,
        }),
      });
      const json = (await res.json()) as {
        workflow?: WorkflowState;
        error?: string;
        slate?: { ok: boolean; skipped: boolean };
      };
      if (!res.ok || !json.workflow) throw new Error(json.error || `Error ${res.status}`);
      if (json.slate && !json.slate.ok && !json.slate.skipped) {
        setError("Saved on the board. Slate import did not land. Retry the toggle.");
      }
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.applicationId === row.applicationId ? { ...r, workflow: json.workflow! } : r,
          ),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <div>
          <h1>Music Prospect & Award Board</h1>
          <p className={styles.lede}>
            Applicants whose intended major is Music, from the live admissions extract in AWS.
            AME status is joined from the campus-visit extract. Audition review, program
            acceptance, award, and LOI can be updated here. This board has no download.
          </p>
        </div>
        <div className={styles.controls}>
          <label>
            Cycle
            <select
              value={cycle}
              onChange={(e) => {
                const v = e.target.value;
                if (isMusicCycle(v)) setCycle(v);
              }}
            >
              {CYCLES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name or email"
            />
          </label>
        </div>
      </div>
      <p className={styles.meta}>
        {loading ? "Loading…" : `${rows.length} student${rows.length === 1 ? "" : "s"}`}
        {data?.generatedAt ? ` · updated ${data.generatedAt.slice(0, 16).replace("T", " ")} UTC` : ""}
      </p>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.tableWrap}>
        {!loading && rows.length === 0 ? (
          <p className={styles.empty}>No music applicants in this cycle yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Major / Minor</th>
                <th>Enrollment</th>
                <th>AME</th>
                <th>Audition request</th>
                <th>Audition review</th>
                <th>Program acceptance</th>
                <th>Music award</th>
                <th>LOI / award accepted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <StudentRow
                  key={row.applicationId}
                  row={row}
                  disabled={saving === row.applicationId}
                  onPatch={patchRow}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StudentRow({
  row,
  disabled,
  onPatch,
}: {
  row: MusicRow;
  disabled: boolean;
  onPatch: (row: MusicRow, body: Partial<WorkflowState>) => void;
}) {
  const intent = [row.major && `Major: ${row.major}`, row.minor && `Minor: ${row.minor}`]
    .filter(Boolean)
    .join(" · ");
  const ame = row.ameStatus
    ? `${row.ameStatus}${row.ameEvent ? ` (${row.ameEvent})` : ""}`
    : "None";
  const audition = row.auditionRequested
    ? `${row.auditionDate || "Submitted"}${row.auditionInstrument ? ` · ${row.auditionInstrument}` : ""}`
    : "No";

  return (
    <tr>
      <td>
        <div className={styles.name}>
          {row.last || row.first
            ? `${row.last || "—"}${row.first ? `, ${row.first}` : ""}`
            : `Applicant ${row.applicationId.slice(0, 8)}`}
        </div>
        <div className={styles.muted}>{row.email}</div>
        {row.phone ? <div className={styles.muted}>{row.phone}</div> : null}
      </td>
      <td>{intent || "—"}</td>
      <td>
        <span className={`${styles.pill} ${statusClass(row.enrollmentStatus)}`}>
          {row.enrollmentStatus}
          {row.acceptCode ? ` ${row.acceptCode}` : ""}
        </span>
      </td>
      <td>
        <span className={`${styles.pill} ${statusClass(row.ameStatus)}`}>{ame}</span>
      </td>
      <td>{audition}</td>
      <td>
        <select
          className={styles.cellSelect}
          value={row.workflow.auditionReview}
          disabled={disabled}
          onChange={(e) =>
            onPatch(row, { auditionReview: e.target.value as AuditionReview })
          }
        >
          <option value="none">None</option>
          <option value="in_review">In review</option>
          <option value="complete">Complete</option>
        </select>
      </td>
      <td>
        <select
          className={styles.cellSelect}
          value={row.workflow.programAcceptance}
          disabled={disabled}
          onChange={(e) =>
            onPatch(row, {
              programAcceptance: e.target.value as ProgramAcceptance,
            })
          }
        >
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="denied">Denied</option>
        </select>
      </td>
      <td>
        <input
          key={`${row.applicationId}:${row.workflow.updatedAt || row.workflow.musicAward}`}
          className={styles.cellInput}
          defaultValue={row.workflow.musicAward}
          disabled={disabled}
          onBlur={(e) => {
            if (e.target.value !== row.workflow.musicAward) {
              onPatch(row, { musicAward: e.target.value });
            }
          }}
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={row.workflow.loiSigned}
          disabled={disabled}
          onChange={(e) => onPatch(row, { loiSigned: e.target.checked })}
          aria-label={`LOI signed for ${row.last}`}
        />
        {row.loiFromSlate ? <span className={styles.muted}> Slate LOIA</span> : null}
      </td>
    </tr>
  );
}

export default function MusicPage() {
  return (
    <AccessGate report="music">
      <ReportTopBar title="Music" nav={[]} />
      <Board />
    </AccessGate>
  );
}
