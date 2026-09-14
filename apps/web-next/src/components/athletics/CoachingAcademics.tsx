"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  letterFromPercent,
  type AcademicsSummary,
  type AttendancePulse,
} from "@/lib/reports/athletics-coaching/academics";
import { formatCount, formatWhen } from "./CoachingHub";

function pulseLabel(band: "attending" | "watch" | "inactive"): string {
  if (band === "attending") return "Attending";
  if (band === "watch") return "Watch";
  return "Inactive";
}

function pulseCell(pulse: AttendancePulse | null): string {
  if (!pulse) return "—";
  const bits: string[] = [];
  if (pulse.present != null) bits.push(`${pulse.present} present`);
  if (pulse.absent != null) bits.push(`${pulse.absent} absent`);
  if (pulse.late != null && pulse.late > 0) bits.push(`${pulse.late} late`);
  const label = pulseLabel(pulse.band);
  return bits.length ? `${label} (${bits.join(", ")})` : label;
}

function formatGrade(grade: number | null, letter?: string): string {
  const shown = letter || letterFromPercent(grade);
  if (grade === null) return shown || "None";
  const pct = Number.isInteger(grade) ? String(grade) : String(Number(grade.toFixed(1)));
  return `${shown}  ${pct}%`;
}

function formatGpa(value: number | null): string {
  if (value === null) return "n/a";
  return value.toFixed(2);
}

function formatPercent(value: number | null): string {
  if (value === null) return "n/a";
  return `${value.toFixed(1)}%`;
}

export function AcademicsPage({ sportKey }: { sportKey: string }) {
  const [data, setData] = useState<AcademicsSummary | null>(null);
  const [mfaUrl, setMfaUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMfaUrl(null);
    apiFetch(`/api/athletics-coaching/academics?sport=${encodeURIComponent(sportKey)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (response.status === 401 && body.mfaUrl) {
          if (!cancelled) setMfaUrl(String(body.mfaUrl));
          return;
        }
        if (!response.ok) throw new Error(body.error || "Unable to load academics");
        if (!cancelled) setData(body as AcademicsSummary);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sportKey]);

  return (
    <section className="ath-coach-band">
      <h2>Academics</h2>
      {loading ? <p>Loading academic snapshots…</p> : null}
      {mfaUrl ? (
        <p>
          Named athlete academics need an authenticator code.{" "}
          <Link href={mfaUrl}>Continue with authenticator</Link>
        </p>
      ) : null}
      {error ? <p>{error}</p> : null}
      {!loading && !error && !mfaUrl && data && !data.rosterAvailable ? (
        <p>The roster feed is not in yet. Named student academics cannot be shown until the roster lands.</p>
      ) : null}
      {!loading && !error && !mfaUrl && data?.rosterAvailable ? (
        <>
          <p>
            {data.matchedCount} of {data.rosterCount} rostered athletes have an academic snapshot
            {data.asOf ? ` as of ${formatWhen(data.asOf)}` : ""}.
          </p>
          <div className="ath-coach-kpis">
            <div className="ath-kpi">
              <span>Team GPA</span>
              <strong>{formatGpa(data.teamGpa)}</strong>
              <small>from current course grades, unweighted</small>
            </div>
            <div className="ath-kpi">
              <span>Team avg grade</span>
              <strong>{formatPercent(data.teamAvgPercent)}</strong>
              <small>Mean of current course percents</small>
            </div>
            <div className="ath-kpi">
              <span>Athletes missing class</span>
              <strong>
                {data.peopleMissingClass} of {data.matchedCount}
              </strong>
              <small>{data.totalAbsenceSessions} session absences</small>
            </div>
            <div className="ath-kpi">
              <span>Class sections with absences</span>
              <strong>{formatCount(data.classesWithAbsences)}</strong>
              <small>Courses with at least one absence</small>
            </div>
            <div className="ath-kpi">
              <span>Courses without an A or B</span>
              <strong>{formatCount(data.officeHours.length)}</strong>
              <small>Send these athletes to office hours</small>
            </div>
          </div>

          <h3>Needs office hours</h3>
          <p>Athletes with a course that is not an A or B (or has no grade yet).</p>
          {data.officeHours.length ? (
            <div className="ath-table-scroll ath-coach-academics">
              <table className="ath-table">
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Course</th>
                    <th>Grade</th>
                    <th>Missing assignments</th>
                  </tr>
                </thead>
                <tbody>
                  {data.officeHours.map((row, index) => (
                    <tr key={`${row.email}-${row.course}-${index}`}>
                      <td>{row.name}</td>
                      <td>{row.course}</td>
                      <td>{formatGrade(row.grade, row.letter)}</td>
                      <td>{row.missing ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Every graded course is an A or B.</p>
          )}

          <h3>Missing class</h3>
          {data.missingClass.length ? (
            <div className="ath-table-scroll ath-coach-academics">
              <table className="ath-table">
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Session absences</th>
                    <th>Courses with absences</th>
                  </tr>
                </thead>
                <tbody>
                  {data.missingClass.map((row) => (
                    <tr key={row.email || row.pcid || row.name}>
                      <td>{row.name}</td>
                      <td>{row.sessionAbsences}</td>
                      <td>
                        {row.coursesWithAbsences.length
                          ? row.coursesWithAbsences
                              .map((course) => `${course.course} (${course.timesAbsent})`)
                              .join(", ")
                          : "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No recorded absences on this snapshot.</p>
          )}

          <h3>Roster</h3>
          {data.athletes.length ? (
            <div className="ath-table-scroll ath-coach-academics">
              <table className="ath-table">
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Risk</th>
                    <th>Attendance pulse</th>
                    <th>Last attended</th>
                  </tr>
                </thead>
                <tbody>
                  {data.athletes.map((athlete) => {
                    const key = athlete.email || athlete.pcid || athlete.name;
                    const expanded = open === key;
                    return (
                      <Fragment key={key}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="ath-text-btn"
                              onClick={() => setOpen(expanded ? null : key)}
                              disabled={!athlete.matched}
                            >
                              {athlete.name}
                            </button>
                            {!athlete.matched ? (
                              <span className="ath-badge">no academic snapshot</span>
                            ) : null}
                          </td>
                          <td>{athlete.matched ? athlete.risk || "—" : "—"}</td>
                          <td>{pulseCell(athlete.pulse)}</td>
                          <td>{formatWhen(athlete.lastAttended)}</td>
                        </tr>
                        {expanded ? (
                          <tr className="ath-coach-courses">
                            <td colSpan={4}>
                              {athlete.courses.length ? (
                                <table className="ath-table">
                                  <thead>
                                    <tr>
                                      <th>Course</th>
                                      <th>Grade</th>
                                      <th>Missing assignments</th>
                                      <th>Absences</th>
                                      <th>Last access</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {athlete.courses.map((course, index) => (
                                      <tr key={`${key}-course-${index}`}>
                                        <td>{course.course}</td>
                                        <td>{formatGrade(course.grade)}</td>
                                        <td>{course.missing ?? "—"}</td>
                                        <td>{course.timesAbsent ?? "—"}</td>
                                        <td>{formatWhen(course.lastAccess)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p>No course rows in this snapshot.</p>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No rostered athletes for this team.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
