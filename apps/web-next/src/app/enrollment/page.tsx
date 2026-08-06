"use client";

import Link from "next/link";
import { useEnrollment } from "./EnrollmentProvider";
import { Delta } from "@/components/enrollment/ui";
import { fmt } from "@/lib/reports/enrollment/load";

export default function EnrollmentHubPage() {
  const { data, error, loading, cycle } = useEnrollment();
  if (loading)
    return (
      <div className="view active">
        <p>Loading dashboard data…</p>
      </div>
    );
  if (error)
    return (
      <div className="view active">
        <p>Error: {error}</p>
      </div>
    );
  if (!data) return null;

  const fa26 = data.admissions.fa26;
  const fa27 = data.admissions.fa27;
  const fa25 = data.admissions.fa25;
  const cur = cycle === "fa26" ? fa26 : fa27;
  const prv = cycle === "fa26" ? fa25 : fa26;
  const label = cycle === "fa26" ? "FA26" : "FA27";
  const vs = cycle === "fa26" ? "FA25" : "FA26";
  const pswTerms = Object.entries(data.psw);

  return (
    <div className="view active">
      <div className="hub-intro">
        <h1 className="hub-h1">Admissions Hub</h1>
        <p className="hub-sub">
          {label} view · vs {vs} · net deposits <Delta cur={cur.deposits} prv={prv.deposits} />
        </p>
      </div>

      <div className="sec-row">
        <span className="sec-lbl">Enrollment</span>
        <span className="sec-rule" />
      </div>
      <div className="g2">
        <Link href="/enrollment/admissions" className="card enroll-26" style={{ ["--c" as string]: "var(--gold)" }}>
          <div className="card-head">
            <div className="card-title">FA26 Enrollment YOY</div>
            <span className="pill" style={{ ["--pb" as string]: "#DDEAF7", ["--pf" as string]: "var(--blue)" }}>
              FA26
            </span>
          </div>
          <div className="card-desc">Funnel and profile for FA26 vs FA25.</div>
          <div className="krow k3">
            <div className="ks">
              <div className="kn">{fmt(fa26.deposits)}</div>
              <div className="kl">Net deposits</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(fa26.accepted)}</div>
              <div className="kl">Accepted</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(fa26.created)}</div>
              <div className="kl">Created</div>
            </div>
          </div>
          <div className="card-foot">
            <span className="ctag">
              Accept rate {fa26.acceptRate != null ? `${fa26.acceptRate.toFixed(1)}%` : "—"} ·{" "}
              <Delta cur={fa26.deposits} prv={fa25.deposits} />
            </span>
            <span className="open">Open →</span>
          </div>
        </Link>
        <Link href="/enrollment/admissions" className="card enroll-27" style={{ ["--c" as string]: "var(--blue-mid)" }}>
          <div className="card-head">
            <div className="card-title">FA27 Enrollment YOY</div>
            <span className="pill">FA27</span>
          </div>
          <div className="card-desc">Early FA27 funnel vs FA26 at same point.</div>
          <div className="krow k3">
            <div className="ks">
              <div className="kn">{fmt(fa27.deposits)}</div>
              <div className="kl">Net deposits</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(fa27.accepted)}</div>
              <div className="kl">Accepted</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(fa27.created)}</div>
              <div className="kl">Created</div>
            </div>
          </div>
          <div className="card-foot">
            <span className="open">Open →</span>
          </div>
        </Link>
      </div>

      <div className="sec-row">
        <span className="sec-lbl">Events & Visits</span>
        <span className="sec-rule" />
      </div>
      <div className="g3">
        <Link href="/enrollment/slc" className="card" style={{ ["--c" as string]: "var(--teal)" }}>
          <div className="card-title">Summer Leadership Conference</div>
          <div className="card-desc">Applied, accepted, and registered.</div>
          <div className="krow k3">
            <div className="ks">
              <div className="kn">{fmt(data.slc.registered)}</div>
              <div className="kl">Registered</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(data.slc.accepted)}</div>
              <div className="kl">Accepted</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(data.slc.applied)}</div>
              <div className="kl">Applied</div>
            </div>
          </div>
          <div className="card-foot">
            <span className="open">Open →</span>
          </div>
        </Link>
        <Link href="/enrollment/campus" className="card" style={{ ["--c" as string]: "var(--purple)" }}>
          <div className="card-title">AME / Campus Visits</div>
          <div className="card-desc">Visit registration outcomes.</div>
          <div className="krow k3">
            <div className="ks">
              <div className="kn">{fmt(data.campus.attended)}</div>
              <div className="kl">Attended</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(data.campus.registered)}</div>
              <div className="kl">Registered</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(data.campus.total)}</div>
              <div className="kl">Total</div>
            </div>
          </div>
          <div className="card-foot">
            <span className="open">Open →</span>
          </div>
        </Link>
        <Link href="/enrollment/psw" className="card" style={{ ["--c" as string]: "var(--blue-mid)" }}>
          <div className="card-title">President’s Scholarship Weekend</div>
          <div className="card-desc">Attendance by term.</div>
          <div className="krow k3">
            {pswTerms.slice(0, 3).map(([term, v]) => (
              <div className="ks" key={term}>
                <div className="kn">
                  {(v as { att: number }).att}/{(v as { total: number }).total}
                </div>
                <div className="kl">{term || "Term"}</div>
              </div>
            ))}
          </div>
          <div className="card-foot">
            <span className="open">Open →</span>
          </div>
        </Link>
      </div>

      <div className="sec-row">
        <span className="sec-lbl">Counselors & Activity</span>
        <span className="sec-rule" />
      </div>
      <div className="g2">
        <Link href="/enrollment/activity" className="card" style={{ ["--c" as string]: "var(--blue)" }}>
          <div className="card-title">Counselor Activity</div>
          <div className="card-desc">Funnel and interviews by AC.</div>
          <div className="krow k3">
            <div className="ks">
              <div className="kn">{fmt(cur.deposits)}</div>
              <div className="kl">Net deposits</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(cur.interviewed)}</div>
              <div className="kl">Interviews</div>
            </div>
            <div className="ks">
              <div className="kn">{Object.keys(cur.byAC || {}).length}</div>
              <div className="kl">Counselors</div>
            </div>
          </div>
          <div className="card-foot">
            <span className="open">Open →</span>
          </div>
        </Link>
        <Link href="/enrollment/withdrawals" className="card" style={{ ["--c" as string]: "var(--red)" }}>
          <div className="card-title">Withdrawals</div>
          <div className="card-desc">Withdrawn applications by type and counselor.</div>
          <div className="krow k3">
            <div className="ks">
              <div className="kn">{fmt(data.withdrawn.total)}</div>
              <div className="kl">Total</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(data.withdrawn.postAccept)}</div>
              <div className="kl">Post-accept</div>
            </div>
            <div className="ks">
              <div className="kn">{fmt(data.withdrawn.noDecision)}</div>
              <div className="kl">No decision</div>
            </div>
          </div>
          <div className="card-foot">
            <span className="open">Open →</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
