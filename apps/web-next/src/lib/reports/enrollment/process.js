/** Enrollment data processors — ported from admissions hub, no DOM. */
import { isUndergraduateRow } from "./student-type";
import {
  emptyAcFunnel,
  isActivityCounselorKey,
  UG_COUNSELOR_USERNAMES,
} from "./counselors";

export const DATA = {
  api: (typeof window !== 'undefined' && window.AMU_DASHBOARD_API) || '/api/dashboard',
  // Logical hub keys → keys in report_presigned_urls
  reports: {
    admissions: 'admissions',
    decisions:  'app_decisions',
    psw:        'psw',
    slc:        'slc',
    withdrawn:  'withdrawn',
    campus:     'campus_visits',
  },
};

/** Fetch a (possibly gzipped) JSON URL and return parsed object. */
export async function _fetchJsonMaybeGzip(url, fetchImpl = fetch) {
  const r = await fetchImpl(url, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for report URL`);
  // If the server already decoded Content-Encoding:gzip, body is plain JSON.
  const encoding = (r.headers.get("content-encoding") || "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") {
    // Some runtimes auto-decompress; prefer text() when body is already decoded.
    // Fall through to byte check when needed.
  }
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Raw gzip magic → decompress in-session (DecompressionStream).
  let text;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error(
        "Browser lacks DecompressionStream — use a current Chromium/Firefox/Safari",
      );
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder("utf-8").decode(bytes);
  }
  return JSON.parse(text);
}

export async function _loadDashboardSession(fetchImpl = fetch) {
  const r = await fetchImpl(DATA.api, {
    credentials: "include",
  });
  if (r.status === 401) {
    throw new Error("Authentication required");
  }
  if (!r.ok) throw new Error(`Dashboard API ${r.status}`);
  const session = await r.json();
  if (!session.success) throw new Error(session.error || "Dashboard API failed");
  return session;
}

/**
 * Load a report dataset.
 * Prefer same-origin /api/enrollment/:name (no S3 CORS). Fall back to
 * legacy presigned gzip URLs from the dashboard session when provided.
 */
export async function _dataFetch(name, session, fetchImpl = fetch) {
  const key = DATA.reports[name];
  if (!key) throw new Error(`Unknown dataset: ${name}`);

  try {
    const payload = await _fetchJsonMaybeGzip(`/api/enrollment/${name}`, fetchImpl);
    return payload.row || [];
  } catch (proxyErr) {
    const urls =
      (session?.report_presigned_urls || {})[key] ||
      (session?.report_presigned_urls || {})[name];
    if (!urls?.json_gzip) {
      throw proxyErr instanceof Error
        ? proxyErr
        : new Error(`Enrollment proxy failed for ${name}`);
    }
    const payload = await _fetchJsonMaybeGzip(urls.json_gzip, fetchImpl);
    return payload.row || [];
  }
}

// ── processors ───────────────────────────────────────────
const TUITION = 33315;
const ACCEPT_CODE_LABEL = {
  AT: 'Accept (Full Accept)',
  CA: 'Conditional Accept',
  ADMI: 'Admin Accept',
  CMRV: 'Committee Accept',
  CTA: 'Contingent Accept',
};

export function _parseNum(s) {
  if (s === null || s === undefined || s === '') return null;
  const n = parseFloat(String(s).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
export function _parseDate(s) {
  if (!s) return null;
  const t = String(s).slice(0, 10);
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function _dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Fall YYYY → calendar cutoff = as-of month/day in YYYY (capped at asOf). */
export function _withdrawalCutoff(termYear, asOf) {
  const asOfDay = _dateOnly(asOf || new Date());
  if (!termYear) return asOfDay;
  const cut = new Date(termYear, asOfDay.getMonth(), asOfDay.getDate());
  return cut > asOfDay ? asOfDay : cut;
}
/** Point-in-time net deposit: deposited on/before cutoff, not withdrawn on/before cutoff. */
export function _isDepositAsOf(r, cutoff) {
  if (!r.DepositCode || !cutoff) return false;
  const dd = _parseDate(r.DepositDate);
  return !!(dd && _dateOnly(dd) <= _dateOnly(cutoff));
}
export function _isWithdrawnAsOf(r, cutoff) {
  if (!r.WithdrawnCode || !cutoff) return false;
  const wd = _parseDate(r.WithdrawnDate);
  return !!(wd && _dateOnly(wd) <= _dateOnly(cutoff));
}
export function _isNetDeposit(r, cutoff) {
  return _isDepositAsOf(r, cutoff) && !_isWithdrawnAsOf(r, cutoff);
}
export function _termYear(term) {
  const m = String(term || '').match(/(\d{4})/);
  return m ? +m[1] : null;
}
export function _avg(vals) {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function _median(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function _aidStats(grp) {
  const ua = _avg(grp.map(r => _parseNum(r.UnfundedAid)).filter(v => v !== null && v > 0));
  const tot = _avg(grp.map(r => _parseNum(r.ScholarshipAmount)).filter(v => v !== null && v > 0));
  const fund = (ua !== null && tot !== null) ? tot - ua : null;
  return {
    ua, tot, fund,
    drUa: ua !== null ? ua / TUITION * 100 : null,
    drTot: tot !== null ? tot / TUITION * 100 : null,
  };
}
export function _termStats(rows, termYear, asOf) {
  const ug = rows.filter(isUndergraduateRow);
  const cutoff = _withdrawalCutoff(termYear, asOf);
  const acc = ug.filter(r => r.AcceptCode);
  const depG = ug.filter(r => _isDepositAsOf(r, cutoff));
  const dep = depG.filter(r => !_isWithdrawnAsOf(r, cutoff));
  const den = ug.filter(r => r.DeniedCode);
  const codes = {};
  acc.forEach(r => { codes[r.AcceptCode] = (codes[r.AcceptCode] || 0) + 1; });
  const gpas = ug.map(r => _parseNum(r['Self-ReportedHSGPA'])).filter(v => v !== null && v > 0 && v <= 5);
  const acts = ug.map(r => _parseNum(r.ACT)).filter(v => v !== null && v > 0);
  const sats = ug.map(r => _parseNum(r.SAT)).filter(v => v !== null && v > 0);
  const clts = ug.map(r => _parseNum(r.CLT)).filter(v => v !== null && v > 0);
  const subToAcc = [];
  const accToDep = [];
  acc.forEach(r => {
    const a = _parseDate(r.ApplicationSubmittedDate), b = _parseDate(r.AcceptDate);
    if (a && b && b >= a) subToAcc.push((b - a) / 86400000);
  });
  dep.forEach(r => {
    const a = _parseDate(r.AcceptDate), b = _parseDate(r.DepositDate);
    if (a && b && b >= a) accToDep.push((b - a) / 86400000);
  });
  const byAC = {};
  UG_COUNSELOR_USERNAMES.forEach((ac) => {
    byAC[ac] = emptyAcFunnel();
  });
  byAC[''] = emptyAcFunnel();
  ug.forEach(r => {
    const ac = r.ApplicationACAssignment || '';
    if (!isActivityCounselorKey(ac)) return;
    byAC[ac].created++;
    byAC[ac].submitted++;
    if (r.AcceptCode) byAC[ac].accepted++;
    if (_isNetDeposit(r, cutoff)) byAC[ac].deposited++;
    if (r.DeniedCode) byAC[ac].denied++;
    if (r.InterviewStatus === 'Interviewed') byAC[ac].interviewed++;
  });
  if (byAC[''].created === 0) delete byAC[''];
  return {
    created: ug.length,
    submitted: ug.length,
    interviewed: ug.filter(r => r.InterviewStatus === 'Interviewed').length,
    accepted: acc.length,
    deposits: dep.length,
    depositsGross: depG.length,
    depositsWithdrawn: depG.length - dep.length,
    denied: den.length,
    withdrawn: ug.filter(r => r.WithdrawnCode).length,
    acceptRate: ug.length ? acc.length / ug.length * 100 : null,
    conditional: codes.CA || 0,
    codes,
    gpa: _avg(gpas),
    act: _avg(acts),
    sat: _avg(sats),
    clt: _avg(clts),
    daysSubmitAccept: _median(subToAcc),
    daysAcceptDeposit: _median(accToDep),
    catholic: ug.filter(r => r.Religion === 'Catholic').length,
    male: ug.filter(r => r.Gender === 'M').length,
    female: ug.filter(r => r.Gender === 'F').length,
    aidAcc: _aidStats(acc),
    aidDep: _aidStats(dep),
    byAC,
    withdrawalCutoff: cutoff.toISOString().slice(0, 10),
  };
}

export function _procAdm(rows, asOf) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const asOfDay = Number.isNaN(+asOfDate) ? new Date() : asOfDate;
  const byTerm = {};
  ['Fall 2024', 'Fall 2025', 'Fall 2026', 'Fall 2027'].forEach(t => {
    byTerm[t] = _termStats(rows.filter(r => r.ApplicationTerm === t), _termYear(t), asOfDay);
  });
  return {
    fa24: byTerm['Fall 2024'],
    fa25: byTerm['Fall 2025'],
    fa26: byTerm['Fall 2026'],
    fa27: byTerm['Fall 2027'],
    allRows: rows,
  };
}

export function _procPSW(rows) {
  const m = {};
  rows.forEach(r => {
    const t = r.Term || '';
    if (!m[t]) m[t] = { att: 0, total: 0 };
    m[t].total++;
    if (r.RegistrationStatus === 'Attended') m[t].att++;
  });
  return m;
}

export function _procSLC(rows) {
  const byClass = {};
  ['Freshman', 'Sophomore', 'Junior', 'Senior'].forEach(c => {
    byClass[c] = { applied: 0, accepted: 0, registered: 0, denied: 0 };
  });
  const bySess = {};
  const bins = {};
  rows.forEach(r => {
    const cl = r.SLC_Hs_Class_Year;
    if (byClass[cl]) {
      byClass[cl].applied++;
      if (r.SLC_Accepted === 'Accepted') byClass[cl].accepted++;
      if (r.SLC_Registered === 'Registered') byClass[cl].registered++;
      if (r.SLC_Denied === 'Denied') byClass[cl].denied++;
    }
    if (r.SLC_Registered === 'Registered') {
      // Keep full MM-DD-YYYY so keys match HTML data-k attributes
      const raw = (r.SLC_FormStartDateTime || '').slice(0, 10);
      const sess = raw.replace(/\//g, '-');
      if (!bySess[sess]) bySess[sess] = { Female: 0, Male: 0, total: 0 };
      bySess[sess][r.SLC_Sex === 'Male' ? 'Male' : 'Female']++;
      bySess[sess].total++;
    }
    const b = r.SLC_WorkflowRecordsSummerLeadershipBin || '';
    bins[b] = (bins[b] || 0) + 1;
  });
  return {
    applied: rows.length,
    accepted: rows.filter(r => r.SLC_Accepted === 'Accepted').length,
    registered: rows.filter(r => r.SLC_Registered === 'Registered').length,
    denied: rows.filter(r => r.SLC_Denied === 'Denied').length,
    byClass, bySess, bins,
  };
}

export function _procCampus(rows) {
  return {
    total: rows.length,
    attended: rows.filter(r => r.RegistrationStatus === 'Attended').length,
    registered: rows.filter(r => r.RegistrationStatus === 'Registered').length,
    cancelled: rows.filter(r => r.RegistrationStatus === 'Cancelled').length,
    noShow: rows.filter(r => r.RegistrationStatus === 'No Show').length,
  };
}
