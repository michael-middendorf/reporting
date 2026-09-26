"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import type { AttendancePulse } from "@/lib/reports/athletics-coaching/academics";
import {
  isYesFlag,
  sessionBucket,
  type AssociationStatus,
  type StudentProfile,
} from "@/lib/reports/aspiredu/student-profile";
import styles from "../../aspiredu.module.css";
import s from "../students.module.css";
import { EMPTY, formatDate, formatDateTime, formatNumber, formatPercent } from "../format";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; profile: StudentProfile }
  | { kind: "awaiting" }
  | { kind: "not_found" }
  | { kind: "not_enabled"; message: string }
  | { kind: "error"; message: string };

function officeHoursMessage(courses: string[]): string {
  return `You have to go and see your professor for their office hours for the following classes: ${courses.join(", ")}`;
}

function CopyOfficeHours({ courses }: { courses: string[] }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(officeHoursMessage(courses));
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" className={`${styles.button} ${styles.secondary} ${s.smallBtn}`} onClick={() => void copy()}>
      {copied ? "Copied" : "Copy office-hours text"}
    </button>
  );
}

function pulseLabel(pulse: AttendancePulse): string {
  if (pulse.band === "attending") return "Attending";
  if (pulse.band === "watch") return "Watch";
  return "Inactive";
}

function pulseDetail(pulse: AttendancePulse): string {
  const bits: string[] = [];
  if (pulse.present != null) bits.push(`${pulse.present} present`);
  if (pulse.absent != null) bits.push(`${pulse.absent} absent`);
  if (pulse.late != null && pulse.late > 0) bits.push(`${pulse.late} late`);
  if (pulse.lastAttended) bits.push(`last attended ${formatDate(pulse.lastAttended)}`);
  return bits.join(", ");
}

function sessionClass(status: string): string {
  const bucket = sessionBucket(status);
  if (bucket === "present") return s.statusOk;
  if (bucket === "late") return s.statusWarn;
  if (bucket === "absent") return s.statusBad;
  return "";
}

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className={s.kpi}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === "" ? EMPTY : value}</dd>
    </>
  );
}

function AssociationBlock({
  title,
  source,
  status,
  asOf,
  children,
}: {
  title: string;
  source: string;
  status: AssociationStatus;
  asOf: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className={s.assocBlock}>
      <div className={s.assocHead}>
        <h3>{title}</h3>
        <span className={s.asOf}>{status === "matched" ? `As of ${formatDate(asOf)}` : source}</span>
      </div>
      {status === "matched" ? (
        <dl className={s.fields}>{children}</dl>
      ) : status === "not_found" ? (
        <p className={s.muted}>Not found in {source}.</p>
      ) : (
        <p className={s.muted}>{source} is not available right now.</p>
      )}
    </div>
  );
}

function CensusSections({
  census,
  status,
}: {
  census: StudentProfile["associations"]["census"];
  status: AssociationStatus;
}) {
  if (status !== "matched" || !census) {
    return (
      <p className={s.muted}>
        {status === "not_found" ? "Not found in the census list." : "The census list is not available right now."}
      </p>
    );
  }
  return (
    <div className={s.censusGroups}>
      <p className={s.asOf}>Census as of {formatDate(census.asOf)}</p>
      {census.groups.map((group) => (
        <details key={group.group} className={s.censusGroup} open={group.open}>
          <summary>
            {group.group}
            {!group.open && <small>{group.fields.length} {group.fields.length === 1 ? "field" : "fields"}</small>}
          </summary>
          <dl className={s.fields}>
            {group.fields.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </dl>
        </details>
      ))}
    </div>
  );
}

function badgeList(profile: StudentProfile): string[] {
  const { athletics, housing, census } = profile.associations;
  const badges: string[] = [];
  for (const sport of athletics?.sports ?? []) badges.push(sport);
  if (housing?.hall) badges.push(housing.room ? `${housing.hall} ${housing.room}` : housing.hall);
  else if (housing?.residency) badges.push(housing.residency);
  else if (census?.residency && isYesFlag(census.residency)) badges.push(census.residency);
  if (census?.institute && isYesFlag(census.institute)) badges.push(`Institute: ${census.institute}`);
  if (census?.household && isYesFlag(census.household)) badges.push(`Household: ${census.household}`);
  if (census?.honors && isYesFlag(census.honors)) badges.push("Honors");
  if (census?.fsp && isYesFlag(census.fsp)) badges.push("FSP");
  if (census?.marines && isYesFlag(census.marines)) badges.push("Marines");
  return badges;
}

function ProfileView({ profile }: { profile: StudentProfile }) {
  const { identity, kpis, courses, sessions, pulse, notes, alerts, associations, associationStatus } = profile;
  const belowAb = courses.filter((c) => c.belowAB);
  const badges = badgeList(profile);
  const { athletics, housing, census } = associations;

  return (
    <>
      <section className={s.headerCard}>
        <div className={s.headerMain}>
          <h1>{identity.name}</h1>
          <p className={s.headerMeta}>
            {[identity.email, identity.pcid, identity.classYear].filter(Boolean).join("  ·  ") || EMPTY}
          </p>
          {badges.length > 0 && (
            <ul className={s.badges} aria-label="Associations">
              {badges.map((badge) => (
                <li key={badge} className={s.badge}>{badge}</li>
              ))}
            </ul>
          )}
        </div>
        <p className={s.headerAsOf}>AspireDU data as of {formatDateTime(profile.asOf.courses)}</p>
      </section>

      <div className={s.kpiStrip}>
        <Kpi label="GPA estimate" value={formatNumber(kpis.gpaEstimate)} hint="Current course grades, unweighted" />
        <Kpi label="Average grade" value={formatPercent(kpis.avgGrade)} hint={`${kpis.gradedCourses} of ${kpis.courseCount} classes graded`} />
        <Kpi label="Below A/B" value={kpis.belowAbCount} hint="Graded classes under 80%" />
        <Kpi label="Classes missed" value={kpis.totalAbsences ?? EMPTY} hint="Across all classes" />
        <Kpi label="Missing work" value={kpis.totalMissing ?? EMPTY} hint="Missing assignments" />
        <Kpi
          label="Overall risk"
          value={kpis.risk ?? EMPTY}
          hint={kpis.riskTrend !== null ? `Trend ${kpis.riskTrend > 0 ? "+" : ""}${kpis.riskTrend}` : "AspireDU score"}
        />
      </div>

      <section className={styles.panel}>
        <div className={s.sectionHead}>
          <h2>Classes</h2>
          {belowAb.length > 0 && <CopyOfficeHours courses={belowAb.map((c) => c.course)} />}
        </div>
        {courses.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Grade</th>
                  <th className={s.num}>Missing</th>
                  <th className={s.num}>Classes missed</th>
                  <th className={s.num}>Attended</th>
                  <th>Last access</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course, index) => (
                  <tr key={`${course.courseSisId || course.course}-${index}`} className={course.belowAB ? s.rowWarn : undefined}>
                    <td>
                      <strong className={s.courseName}>{course.course}</strong>
                      {course.term && <span className={s.subtle}>{course.term}</span>}
                    </td>
                    <td>
                      {course.grade === null ? (
                        <span className={s.muted}>Not graded</span>
                      ) : (
                        <>
                          <span className={course.belowAB ? s.letterBad : s.letter}>{course.letter}</span>{" "}
                          <span className={s.muted}>{formatPercent(course.grade)}</span>
                        </>
                      )}
                    </td>
                    <td className={s.num}>{course.missing ?? EMPTY}</td>
                    <td className={s.num} title={course.timesAbsent === null ? "No roll call for this class" : undefined}>
                      {course.timesAbsent ?? EMPTY}
                    </td>
                    <td
                      className={s.num}
                      title={course.attendanceDerived ? "From recorded class sessions" : undefined}
                    >
                      {formatPercent(course.percentageAttendance, 0)}
                    </td>
                    <td>{formatDate(course.lastAccess)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={s.muted}>No classes in the current AspireDU snapshot.</p>
        )}
      </section>

      <div className={s.twoCol}>
        <section className={styles.panel}>
          <div className={s.sectionHead}>
            <h2>Attendance</h2>
            <span className={s.asOf}>As of {formatDate(profile.asOf.attendance ?? profile.asOf.attendanceSummary)}</span>
          </div>
          {pulse ? (
            <p className={s.pulse}>
              <span className={`${s.pulseBand} ${s[`pulse_${pulse.band}`] || ""}`}>{pulseLabel(pulse)}</span>
              <span className={s.muted}>{pulseDetail(pulse)}</span>
            </p>
          ) : (
            <p className={s.muted}>No attendance pulse for this student.</p>
          )}
          {sessions.length ? (
            <ul className={s.sessionList}>
              {sessions.map((session, index) => (
                <li key={`${session.classDate}-${session.course}-${index}`}>
                  <span className={s.sessionDate}>{formatDate(session.classDate)}</span>
                  <span className={s.sessionCourse}>{session.course || EMPTY}</span>
                  <span className={`${s.sessionStatus} ${sessionClass(session.status)}`}>{session.status || EMPTY}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.muted}>No recorded class sessions.</p>
          )}
        </section>

        <section className={styles.panel}>
          <div className={s.sectionHead}>
            <h2>Early alerts and notes</h2>
          </div>
          {alerts.length === 0 && notes.length === 0 && <p className={s.muted}>No early alerts or notes.</p>}
          {alerts.length > 0 && (
            <ul className={s.noteList}>
              {alerts.map((alert, index) => (
                <li key={`alert-${index}`} className={s.alertItem}>
                  <div className={s.noteMeta}>
                    <span className={s.alertTag}>Alert</span>
                    {[formatDate(alert.datetime), alert.course, alert.author].filter((v) => v && v !== EMPTY).join("  ·  ")}
                  </div>
                  <p>{alert.text}</p>
                </li>
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <ul className={s.noteList}>
              {notes.map((note, index) => (
                <li key={`note-${index}`}>
                  <div className={s.noteMeta}>
                    {[formatDate(note.datetime), note.course, note.author].filter((v) => v && v !== EMPTY).join("  ·  ")}
                    {note.tags && <span className={s.noteTags}>{note.tags}</span>}
                  </div>
                  <p>{note.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={styles.panel}>
        <h2>Associations</h2>
        <div className={s.assocGrid}>
          <AssociationBlock title="Athletics" source="the athletics roster" status={associationStatus.athletics} asOf={athletics?.asOf}>
            <Field label="Sport" value={athletics?.primarySport} />
            <Field label="Second sport" value={athletics?.secondSport} />
            <Field label="AMU status" value={athletics?.amuStatus} />
            <Field label="Class year" value={athletics?.classYear} />
            <Field label="Incoming or returning" value={athletics?.incomingReturning} />
          </AssociationBlock>
          <AssociationBlock title="Housing" source="eRez housing" status={associationStatus.housing} asOf={housing?.asOf}>
            <Field label="Hall" value={housing?.hall} />
            <Field label="Room" value={housing?.room} />
            <Field label="Residency" value={housing?.residency} />
            <Field label="Session" value={housing?.session} />
            <Field label="Move-in" value={housing?.moveIn ? formatDate(housing.moveIn) : null} />
          </AssociationBlock>
        </div>
        <CensusSections census={census} status={associationStatus.census} />
        <p className={s.note}>
          Census fields come from the census list, which is refreshed by hand and can lag behind.
        </p>
      </section>

      <p className={s.gaps}>
        <strong>Not available in any feed:</strong> {profile.gaps.join("; ")}.
      </p>
    </>
  );
}

export default function StudentProfilePage() {
  const params = useParams<{ studentKey: string }>();
  const studentKey = typeof params?.studentKey === "string" ? params.studentKey : "";
  // Keyed by studentKey so moving between profiles shows "loading" without a
  // synchronous setState inside the effect.
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result && result.key === studentKey ? result.state : { kind: "loading" };

  useEffect(() => {
    if (!studentKey) return;
    let cancelled = false;
    const setState = (next: LoadState) => setResult({ key: studentKey, state: next });
    apiFetch(`/aspiredu/api/students/${encodeURIComponent(studentKey)}/profile`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { profile?: StudentProfile | null; status?: string; error?: string }
          | null;
        if (cancelled) return;
        if (response.ok && body?.status === "awaiting_first_delivery") return setState({ kind: "awaiting" });
        if (response.ok && body?.profile) return setState({ kind: "ready", profile: body.profile });
        if (response.status === 404 || response.status === 400) return setState({ kind: "not_found" });
        if (response.status === 401) {
          return setState({ kind: "error", message: "Your session has expired. Return to Reports and sign in again." });
        }
        if (response.status === 403) {
          return setState({ kind: "error", message: body?.error || "You do not have access to student records." });
        }
        if (response.status === 503 && body?.error && /not enabled/i.test(body.error)) {
          return setState({ kind: "not_enabled", message: body.error });
        }
        setState({ kind: "error", message: body?.error || "Unable to load the student profile." });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Unable to reach the server. Check your connection." });
      });
    return () => {
      cancelled = true;
    };
  }, [studentKey]);

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar
          title="Academic Affairs"
          nav={ASPIREDU_NAV}
          currentLabel={state.kind === "ready" ? state.profile.identity.name : "Student profile"}
        />
        <main className={styles.content}>
          <Link href="/aspiredu" className={s.backLink}>
            ← Back to students
          </Link>
          {state.kind === "loading" && <p className={s.stateBox}>Loading student profile…</p>}
          {state.kind === "awaiting" && (
            <p className={s.stateBox}>Awaiting the first AspireDU statistics delivery.</p>
          )}
          {state.kind === "not_found" && (
            <p className={s.stateBox}>
              This student is not in the current AspireDU snapshot. Return to the search and pick them again.
            </p>
          )}
          {state.kind === "not_enabled" && <p className={s.stateBox}>{state.message}</p>}
          {state.kind === "error" && <p className={s.bannerError} role="alert">{state.message}</p>}
          {state.kind === "ready" && <ProfileView profile={state.profile} />}
        </main>
      </div>
    </AccessGate>
  );
}
