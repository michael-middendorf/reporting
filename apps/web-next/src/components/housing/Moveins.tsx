import { useMemo, useState } from "react";
import { META, fmtDate, srcLabel, statusLabel } from "@/lib/reports/housing/model";
import type { Resident } from "@/lib/reports/housing/types";
import styles from "./housing.module.css";

function chipDate(d: string): string {
  const [y, mo, da] = d.split("-");
  return new Date(Number(y), Number(mo) - 1, Number(da)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function Moveins({
  residents,
  onOpenRoom,
}: {
  residents: Resident[];
  onOpenRoom: (building: string, room: string) => void;
}) {
  const [day, setDay] = useState("");
  const [q, setQ] = useState("");
  const days = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of residents) {
      if (!p.move_in) continue;
      m[p.move_in] = (m[p.move_in] || 0) + 1;
    }
    return Object.keys(m)
      .sort()
      .map((d) => ({ date: d, count: m[d] }));
  }, [residents]);
  const total = days.reduce((a, d) => a + d.count, 0);

  const rows = useMemo(() => {
    let list = residents.filter((p) => p.building && p.room);
    if (day) list = list.filter((p) => p.move_in === day);
    const needle = q.toLowerCase();
    if (needle) {
      list = list.filter((p) =>
        `${p.name || ""} ${p.building || ""} ${p.room || ""} ${p.sport || ""} ${p.early_reason || ""} ${p.student_type || ""} ${p.class_status || ""}`
          .toLowerCase()
          .includes(needle),
      );
    }
    return [...list].sort(
      (a, b) =>
        (a.move_in || "").localeCompare(b.move_in || "") ||
        (a.building || "").localeCompare(b.building || "") ||
        (a.room || "").localeCompare(b.room || "", undefined, { numeric: true }) ||
        (a.name || "").localeCompare(b.name || ""),
    );
  }, [residents, day, q]);

  return (
    <div className={styles.wrap}>
      <div className={styles.sectitle}>
        Move-in Schedule<span className={styles.rule} />
        <span>{days.length} move-in days · {total.toLocaleString()} residents</span>
      </div>
      <div className={styles.datebar}>
        <span className={styles.lab} style={{ margin: 0 }}>Move-in day</span>
        <button type="button" className={`${styles.db} ${day === "" ? styles.dbOn : ""}`} onClick={() => setDay("")}>
          All · {total}
        </button>
        {days.map((d) => (
          <button
            type="button"
            key={d.date}
            className={`${styles.db} ${day === d.date ? styles.dbOn : ""}`}
            onClick={() => setDay(d.date)}
          >
            {chipDate(d.date)} · {d.count}
          </button>
        ))}
      </div>
      <div className={styles.verbar}>
        <span>{day ? `${fmtDate(day)} · ${rows.length} moving in` : `All assignments · ${rows.length}`}</span>
        <input className={styles.filter} placeholder="Filter by name, room, sport, or reason…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className={styles.vertableWrap}>
        <table className={styles.vertable}>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th>Status</th>
              <th>Building · Room</th>
              <th>Sport</th>
              <th>Early arrival</th>
              <th>Move-in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const hall = META[p.building || ""]?.abbr || p.building || "—";
              return (
                <tr
                  key={`${p.pcid}-${p.building}-${p.room}`}
                  className={styles.clickRow}
                  onClick={() => p.building && p.room && onOpenRoom(p.building, p.room)}
                >
                  <td>
                    <div className={styles.vname}>{p.name || "(name unavailable)"}</div>
                    <div className={styles.vpc}>{p.pcid}{p.gender ? ` · ${p.gender}` : ""}</div>
                  </td>
                  <td>{p.class_status || "—"}</td>
                  <td>{statusLabel(p)}</td>
                  <td>{hall} {p.room}</td>
                  <td>{p.sport || "—"}</td>
                  <td>{p.early_reason || "—"}</td>
                  <td>
                    {fmtDate(p.move_in)}
                    {p.move_in_source && p.move_in_source !== "class-default" ? (
                      <span className={styles.badge}>{srcLabel(p.move_in_source)}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7} style={{ padding: 16, color: "var(--dim)" }}>No residents match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
