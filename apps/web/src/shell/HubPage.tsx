import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiFetch, fetchMe, setBearer } from '../lib/api'
import './hub.css'

const REPORTS = [
  {
    to: '/enrollment',
    title: 'Enrollment',
    desc: 'Admissions funnel, decisions, SLC, PSW, visits, and withdrawals.',
    tone: 'navy',
  },
  {
    to: '/housing',
    title: 'Housing',
    desc: 'Residence occupancy by building and gender for the current session.',
    tone: 'navy',
  },
  {
    to: '/mas',
    title: 'MA Follow-on Giving',
    desc: 'Mission Advancement outreach correlated with follow-on gifts.',
    tone: 'cream',
  },
  {
    to: '/points',
    title: 'MA Points',
    desc: 'Activity points, tiers, and leaderboard for scoped MAs.',
    tone: 'navy',
  },
  {
    to: '/alumni',
    title: 'Alumni Coverage',
    desc: 'Alumni donor coverage, touch activity, and assignment opportunity.',
    tone: 'cream',
  },
] as const

export function HubPage() {
  const [email, setEmail] = useState<string>('')

  useEffect(() => {
    fetchMe().then((me) => {
      if (me.email) setEmail(me.email)
    })
  }, [])

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    setBearer(null)
    window.location.href = '/login'
  }

  return (
    <div className="hub">
      <header className="hub-header">
        <div>
          <div className="hub-eyebrow">Ave Maria University</div>
          <h1>Reporting</h1>
          <p className="hub-sub">Internal dashboards for admissions, housing, and advancement.</p>
        </div>
        <div className="hub-user">
          {email && <span>{email}</span>}
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <div className="hub-grid">
        {REPORTS.map((r) => (
          <Link key={r.to} to={r.to} className={`hub-card ${r.tone}`}>
            <h2>{r.title}</h2>
            <p>{r.desc}</p>
            <span className="open">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
