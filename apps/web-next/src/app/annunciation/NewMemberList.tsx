"use client";

import { useMemo, useState } from "react";
import { formatRecurring, type AnnunciationMember } from "@/lib/reports/annunciation/shape";
import {
  formatMailingAddress,
  newMemberCsv,
  newMemberRows,
} from "@/lib/reports/annunciation/mailing";

const HELPER =
  "Members whose Annunciation Circle recurring gift started in this date range, with a current recurring amount at or above the minimum. A gift of $27.20 is included when the minimum is $25. Member since is the earliest recurring-gift start date for this project. Formal addressee uses the formal name from the contact when that field is present. Otherwise it is built from the prefixes and names on the contact. A missing title is left blank.";

export function NewMemberList({ members }: { members: AnnunciationMember[] }) {
  const [from, setFrom] = useState("2026-06-01");
  const [to, setTo] = useState("2026-09-30");
  const [minText, setMinText] = useState("25");

  const minAmount = minText.trim() === "" ? null : Number(minText);
  const rows = useMemo(
    () =>
      newMemberRows(members, {
        from,
        to,
        minAmount: minAmount != null && Number.isFinite(minAmount) ? minAmount : null,
      }),
    [members, from, to, minAmount],
  );

  function download() {
    const csv = newMemberCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "annunciation-circle-new-members.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="ac-mailing">
      <h2>New member list</h2>
      <div className="ac-toolbar">
        <div className="ac-mailing-fields">
          <label>
            From
            <input
              type="date"
              className="ac-search"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              className="ac-search"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            Minimum recurring amount
            <input
              type="number"
              min={0}
              step={0.01}
              className="ac-search"
              value={minText}
              onChange={(e) => setMinText(e.target.value)}
            />
          </label>
          <button type="button" className="ac-refresh" onClick={download} disabled={rows.length === 0}>
            Download CSV
          </button>
        </div>
        <span className="ac-count">{rows.length} members</span>
      </div>
      <p className="ac-note">{HELPER}</p>
      <div className="ac-table-wrap">
        <table className="ac-table">
          <thead>
            <tr>
              <th>Virtuous ID</th>
              <th>First name</th>
              <th>Last name</th>
              <th>Formal addressee</th>
              <th>Formal salutation</th>
              <th>Address</th>
              <th className="ac-num">Recurring gift</th>
              <th>Member since</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.member.id}>
                <td>{row.member.id}</td>
                <td>{row.firstName}</td>
                <td>{row.lastName}</td>
                <td>{row.formalAddressee}</td>
                <td>{row.formalSalutation}</td>
                <td>{formatMailingAddress(row.member)}</td>
                <td className="ac-num">{formatRecurring(row.member)}</td>
                <td>{row.member.startDate || ""}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="ac-empty">
                  No members in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
