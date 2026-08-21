import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, getBearer } from "@/lib/api";
import { shortReason } from "@/lib/reports/housing/model";
import type { VerificationCandidate, VerificationEdit, VerificationState } from "@/lib/reports/housing/types";
import styles from "./housing.module.css";

const STATUSES = ["Pending", "Confirmed", "Needs fix"];

export function Verification() {
  const [candidates, setCandidates] = useState<VerificationCandidate[]>([]);
  const [edits, setEdits] = useState<Record<string, VerificationEdit>>({});
  const [save, setSave] = useState("Loading…");
  const [filter, setFilter] = useState("");
  const [upStatus, setUpStatus] = useState("Spreadsheets → grade levels, move-in dates, and this list.");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiFetch("/api/verification")
      .then((r) => r.json())
      .then((d: { candidates?: VerificationCandidate[]; state?: VerificationState }) => {
        setCandidates(d.candidates || []);
        setEdits(d.state?.edits || {});
        setSave("All changes saved automatically");
      })
      .catch(() => setSave("Could not load verification data."));
  }, []);

  function persist(next: Record<string, VerificationEdit>) {
    setSave("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await apiFetch("/api/verification", {
          method: "POST",
          body: JSON.stringify({ edits: next, notes: [] }),
        }).then((x) => x.json());
        setSave(r?.ok ? "Saved" : "Save failed");
      } catch {
        setSave("Save failed");
      }
    }, 600);
  }

  function edit(pcid: string, field: keyof VerificationEdit, value: string) {
    const next = { ...edits, [pcid]: { ...(edits[pcid] || {}), [field]: value } };
    setEdits(next);
    persist(next);
  }

  async function upload(kind: string, file: File | undefined) {
    if (!file) return;
    setUpStatus(`Uploading ${file.name}…`);
    try {
      const headers: Record<string, string> = {
        "Content-Type": file.type || "application/octet-stream",
      };
      const bearer = getBearer();
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      const r = await fetch(`/api/upload/${kind}`, {
        method: "POST",
        credentials: "include",
        headers,
        body: file,
      }).then((x) => x.json());
      if (!r?.ok) {
        setUpStatus(`Upload failed: ${r?.error || ""}`);
        return;
      }
      setUpStatus(`Uploaded (${r.persisted}) — rebuilding data, this takes a moment…`);
      const before = r.generated_before || "";
      const start = Date.now();
      while (Date.now() - start < 180000) {
        await new Promise((res) => setTimeout(res, 4000));
        const d = await apiFetch("/data/residents.json").then((x) => x.json());
        if (d && !d.error && d.generated && d.generated !== before) break;
      }
      setUpStatus(`${file.name} applied — reloading`);
      window.location.reload();
    } catch {
      setUpStatus("Upload failed");
    }
  }

  const rows = useMemo(() => {
    const q = filter.toLowerCase();
    return candidates.filter((c) => {
      if (!q) return true;
      return `${c.name || ""} ${(c.groups || []).join(" ")} ${(c.reasons || []).join(" ")} ${c.class_status || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [candidates, filter]);

  const summary = useMemo(() => {
    let c = 0;
    let n = 0;
    let p = 0;
    for (const cand of candidates) {
      const st = edits[cand.pcid]?.status || "Pending";
      if (st === "Confirmed") c++;
      else if (st === "Needs fix") n++;
      else p++;
    }
    return `${candidates.length} flagged · ${c} confirmed · ${n} needs fix · ${p} pending`;
  }, [candidates, edits]);

  return (
    <div className={styles.wrap}>
      <div className={styles.sectitle}>
        Student Verification · Early Arrivals<span className={styles.rule} />
        <span>{summary}</span>
      </div>
      <div className={styles.upbar}>
        <span className={styles.lab} style={{ margin: 0 }}>Upload spreadsheets</span>
        <label className={styles.upbtn}>
          Registration Status
          <input type="file" accept=".xlsx" onChange={(e) => upload("registration", e.target.files?.[0])} />
        </label>
        <label className={styles.upbtn}>
          Early Arrivals
          <input type="file" accept=".xlsx" onChange={(e) => upload("early-arrivals", e.target.files?.[0])} />
        </label>
        <span className={styles.upstatus}>{upStatus}</span>
      </div>
      <div className={styles.verbar}>
        <span>{save}</span>
        <input className={styles.filter} placeholder="Filter by name, group, or reason…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className={styles.vertableWrap}>
        <table className={styles.vertable}>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th>G</th>
              <th>Group(s)</th>
              <th>Flag reason</th>
              <th>Status</th>
              <th>Move-in</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const e = edits[c.pcid] || {};
              const st = e.status || "Pending";
              return (
                <tr key={c.pcid} className={st === "Confirmed" ? styles.rowConfirmed : undefined}>
                  <td>
                    <div className={styles.vname}>{c.name}</div>
                    <div className={styles.vpc}>{c.pcid}{c.building ? ` · ${c.building}${c.room ? ` ${c.room}` : ""}` : ""}</div>
                  </td>
                  <td>
                    {c.class_status || "—"}
                    <div className={styles.vpc}>{c.student_type || ""}</div>
                  </td>
                  <td>{c.gender || "—"}</td>
                  <td>{(c.groups || []).join(", ")}</td>
                  <td>
                    {(c.reasons || []).map((r) => (
                      <span key={r} className={styles.badgeReason} title={r}>{shortReason(r)}</span>
                    ))}
                  </td>
                  <td>
                    <select className={styles.vsel} value={st} onChange={(ev) => edit(c.pcid, "status", ev.target.value)}>
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className={styles.vdate} type="date" value={e.move_in || c.move_in || ""} onChange={(ev) => edit(c.pcid, "move_in", ev.target.value)} />
                  </td>
                  <td>
                    <input className={styles.vnote} value={e.note || ""} placeholder="add note…" onChange={(ev) => edit(c.pcid, "note", ev.target.value)} />
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={8} style={{ padding: 16, color: "var(--dim)" }}>No matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
