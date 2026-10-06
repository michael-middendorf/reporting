"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useSportFetch } from "./useSportFetch";
import {
  isBelowC,
  letterFromPercent,
  officeHoursDurationLabel,
  type AcademicsSummary,
  type AttendancePulse,
  type OfficeHoursRow,
  type OfficeHoursSource,
} from "@/lib/reports/athletics-coaching/academics";
import { formatCount, formatWhen } from "./CoachingHub";

type OfficeHoursCourse = {
  course: string;
  letter: string;
  daysBelow: number | null;
  source: OfficeHoursSource | null;
  lowerBound: boolean | null;
};

type OfficeHoursAthlete = {
  key: string;
  name: string;
  courses: OfficeHoursCourse[];
};

function officeHoursClassLabel(course: OfficeHoursCourse): string {
  const duration = officeHoursDurationLabel(course.daysBelow, course);
  return course.letter ? `${course.course} (${course.letter}, ${duration})` : `${course.course} (${duration})`;
}

function groupOfficeHoursByAthlete(rows: OfficeHoursRow[]): OfficeHoursAthlete[] {
  const order: string[] = [];
  const byKey = new Map<string, OfficeHoursAthlete>();
  for (const row of rows) {
    const course = (row.course || "").trim();
    if (!course) continue;
    const key = row.email || row.pcid || row.name || course;
    if (!key) continue;
    let group = byKey.get(key);
    if (!group) {
      group = { key, name: (row.name || "").trim() || "Unnamed", courses: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.courses.push({
      course,
      letter: row.letter,
      daysBelow: row.daysBelow,
      source: row.source,
      lowerBound: row.lowerBound,
    });
  }
  return order.map((key) => byKey.get(key)!).filter((group) => group.courses.length > 0);
}

function officeHoursMessage(courseNames: string[]): string {
  return `You have to go and see your professor for their office hours for the following classes: ${courseNames.join(", ")}`;
}

function CopyOfficeHoursButton({ courseNames }: { courseNames: string[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = officeHoursMessage(courseNames);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className="ath-text-btn" onClick={() => void copy()}>
      {copied ? "Copied" : "Copy text"}
    </button>
  );
}

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
  const { data, error, loading, mfaUrl } = useSportFetch<AcademicsSummary>(
    `/api/athletics-coaching/academics?sport=${encodeURIComponent(sportKey)}`,
    { noStore: true, mfa: true, fallbackError: "Unable to load academics" },
  );
  const [open, setOpen] = useState<string | null>(null);

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
              <small>2 or more session absences</small>
            </div>
            <div className="ath-kpi">
              <span>Courses without an A or B</span>
              <strong>{formatCount(data.officeHours.length)}</strong>
              <small>Send these athletes to office hours</small>
            </div>
          </div>

          <h3>Needs office hours</h3>
          <p>Athletes with a course that is not an A or B. Classes below a C are flagged in the roster.</p>
          {data.officeHours.length ? (
            <div className="ath-table-scroll ath-coach-academics">
              <table className="ath-table">
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Classes</th>
                    <th>Below A/B</th>
                    <th>Copy</th>
                  </tr>
                </thead>
                <tbody>
                  {groupOfficeHoursByAthlete(data.officeHours).map((row) => (
                    <tr key={row.key}>
                      <td>{row.name}</td>
                      <td>
                        {row.courses.map((course, index) => (
                          <div
                            key={`${row.key}-class-${course.course}-${index}`}
                            className={isBelowC(course.letter) ? "ath-grade-below-c" : undefined}
                          >
                            {officeHoursClassLabel(course)}
                          </div>
                        ))}
                      </td>
                      <td>
                        {row.courses.map((course, index) => (
                          <div key={`${row.key}-below-${course.course}-${index}`}>
                            {officeHoursDurationLabel(course.daysBelow, course)}
                          </div>
                        ))}
                      </td>
                      <td>
                        <CopyOfficeHoursButton courseNames={row.courses.map((course) => course.course)} />
                      </td>
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
                  </tr>
                </thead>
                <tbody>
                  {data.missingClass.map((row) => (
                    <tr key={row.email || row.pcid || row.name}>
                      <td>{row.name}</td>
                      <td>{row.sessionAbsences}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No athletes with 2 or more session absences.</p>
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
                                <table className="ath-coach-course-table">
                                  <thead>
                                    <tr>
                                      <th>Course</th>
                                      <th>Grade</th>
                                      <th>Missing assignments</th>
                                      <th>Classes missed</th>
                                      <th>Last access</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {athlete.courses.map((course, index) => {
                                      const letter = letterFromPercent(course.grade);
                                      const belowC = isBelowC(letter);
                                      return (
                                        <tr
                                          key={`${key}-course-${index}`}
                                          className={belowC ? "ath-grade-below-c" : undefined}
                                        >
                                          <td>{course.course}</td>
                                          <td>
                                            {formatGrade(course.grade, letter)}
                                            {belowC ? <span className="ath-badge">below C</span> : null}
                                          </td>
                                          <td>{course.missing ?? "—"}</td>
                                          <td title={course.timesAbsent === null ? "No roll-call for this course" : undefined}>
                                            {course.timesAbsent ?? "n/a"}
                                          </td>
                                          <td>{formatWhen(course.lastAccess)}</td>
                                        </tr>
                                      );
                                    })}
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
