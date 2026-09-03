import Link from "next/link";
import type { SportDef } from "@/lib/reports/athletics-coaching/sports";

export function CoachingDenied({ message }: { message?: string }) {
  return (
    <div className="ath-state">
      <p>{message || "You do not have access to this report."}</p>
      <Link href="/athletics">Back to Athletics</Link>
    </div>
  );
}

export function TeamPicker({ sports, title, description }: { sports: SportDef[]; title: string; description: string }) {
  const ordered = [...sports].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {ordered.length ? (
        <div className="ath-hub-grid">
          {ordered.map((sport) => (
            <Link key={sport.key} href={`/athletics/coaching/${sport.key}`} className="ath-hub-card">
              <h2>{sport.label}</h2>
              <p>Team dashboard for fundraising, enrollment, and academics.</p>
              <strong>Open →</strong>
            </Link>
          ))}
        </div>
      ) : (
        <p className="ath-empty">No teams are assigned to this account yet.</p>
      )}
    </main>
  );
}

export function CoachingBands({ sportLabel }: { sportLabel: string }) {
  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <h1>{sportLabel}</h1>
          <p>Team dashboard. Data for this sport is not in the report yet.</p>
        </div>
      </div>
      <div className="ath-coach-bands">
        <section className="ath-coach-band">
          <h2>Fundraising</h2>
          <p>Gift totals for this team are coming. Nothing is shown here until the fundraising feed is live.</p>
        </section>
        <section className="ath-coach-band">
          <h2>Enrollment</h2>
          <p>Roster and recruiting counts are coming. Nothing is shown here until the enrollment feed is live.</p>
        </section>
        <section className="ath-coach-band">
          <h2>Academics</h2>
          <p>Academic standing for this team is coming. Named student rows are not part of this report yet.</p>
        </section>
      </div>
    </main>
  );
}
