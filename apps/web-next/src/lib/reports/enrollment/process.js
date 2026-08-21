/** Enrollment data processors — ported from admissions hub, no DOM. */
export const DATA = {
  api: (typeof window !== 'undefined' && window.AMU_DASHBOARD_API) || '/api/dashboard',
  // Logical hub keys → keys in report_presigned_urls
  reports: {
    admissions: 'admissions',
    decisions:  'app_decisions',
    psw:        'psw',
    slc:        'slc',
    islc:       'islc',
    withdrawn:  'withdrawn',
    campus:     'campus_visits',
    ame:        'ame',
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
const AC_SHORT = {
  'abel.cordero': 'Abel C',
  'annie.esposito': 'Annie E',
  'caroline.g.savoie': 'Caroline S',
  'christine.m.gulas': 'Christine G',
  'lillian.doyle': 'Lillian D',
  'madelyn.r.byers': 'Madelyn B',
  'michael.j.mcgrath': 'Michael M',
  'joseph.r.pinho': 'Joseph P',
  'katherine.n.lyons': 'Katherine L',
};
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
const _isPresent = v => String(v == null ? '' : v).trim() !== '';
/** Trailing 7 days ending at asOf, inclusive — Qlik Floor(Today())-6 .. Floor(Today()). */
function _inLast7(dateStr, asOf) {
  const d = _parseDate(dateStr);
  if (!d || !asOf) return false;
  const a = _dateOnly(asOf);
  const lo = new Date(a); lo.setDate(lo.getDate() - 7);
  const x = _dateOnly(d);
  return x > lo && x <= a;
}
function _leDate(dateStr, cutoff) {
  const d = _parseDate(dateStr);
  return !!(d && cutoff && _dateOnly(d) <= _dateOnly(cutoff));
}
/** Term-specific interview-completed date (Qlik Interviewed Date FA25/FA26 Apps). */
function _interviewDate(r, termYear) {
  if (termYear === 2025) return r.InterviewedDateFA25Apps || null;
  if (termYear === 2026) return r.InterviewedDateFA26Apps || null;
  return r.InterviewedDateFA27Apps || r.InterviewedDateFA26Apps || null;
}
function _asOfDay(asOf) {
  if (!asOf) return _dateOnly(new Date());
  const parsed = _parseDate(asOf);
  if (parsed) return _dateOnly(parsed);
  const d = new Date(asOf);
  return Number.isNaN(+d) ? _dateOnly(new Date()) : _dateOnly(d);
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
function _termYear(term) {
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
function _acSlug(ac) {
  return (ac || 'unassigned').replace(/\./g, '-');
}
function _acLabel(ac) {
  if (!ac) return 'Unassigned';
  return AC_SHORT[ac] || ac.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function _emptyChg() {
  return {
    created: 0, submitted: 0, accepted: 0, conditional: 0, interviewed: 0,
    depositsGross: 0, depositsWithdrawn: 0, deposits: 0, acceptRate: null, yield: null,
  };
}

function _attachDemoAndAid(out, rows, acc, depNet) {
  out.catholic = rows.filter(r => r.Religion === 'Catholic').length;
  out.catholicAcc = acc.filter(r => r.Religion === 'Catholic').length;
  out.catholicDep = depNet.filter(r => r.Religion === 'Catholic').length;
  out.male = rows.filter(r => r.Gender === 'M').length;
  out.female = rows.filter(r => r.Gender === 'F').length;
  out.maleAcc = acc.filter(r => r.Gender === 'M').length;
  out.femaleAcc = acc.filter(r => r.Gender === 'F').length;
  out.maleDep = depNet.filter(r => r.Gender === 'M').length;
  out.femaleDep = depNet.filter(r => r.Gender === 'F').length;
  out.aidAcc = _aidStats(acc);
  out.aidDep = _aidStats(depNet);
  return out;
}

/**
 * Point-in-time snapshot for a prior cycle "as of" cutoff (Qlik YoY flags:
 * event date <= AddYears(Today(), -1)). Blank dates do not count.
 */
export function _termStatsAsOf(rows, cutoff, termYear) {
  const accRows = rows.filter(r => _isPresent(r.AcceptCode) && _leDate(r.AcceptDate, cutoff));
  const depGrossRows = rows.filter(r => _isPresent(r.DepositDate) && _leDate(r.DepositDate, cutoff));
  const depWithdrawnRows = depGrossRows.filter(r => _isPresent(r.WithdrawnDate) && _leDate(r.WithdrawnDate, cutoff));
  const depNetRows = depGrossRows.filter(r => !(_isPresent(r.WithdrawnDate) && _leDate(r.WithdrawnDate, cutoff)));
  const created = rows.filter(r => _leDate(r.CreatedDate, cutoff)).length;
  const submitted = rows.filter(r => _leDate(r.ApplicationSubmittedDate, cutoff)).length;
  const accepted = accRows.length;
  const codes = {};
  accRows.forEach(r => { codes[r.AcceptCode] = (codes[r.AcceptCode] || 0) + 1; });
  const acceptRate = submitted ? accepted / submitted * 100 : null;
  const yieldRate = accepted ? depGrossRows.length / accepted * 100 : null;
  const byAC = {};
  rows.forEach(r => {
    if (!_leDate(r.CreatedDate, cutoff)) return;
    const ac = r.ApplicationACAssignment || '';
    if (!byAC[ac]) byAC[ac] = { created: 0, submitted: 0, accepted: 0, deposited: 0, denied: 0, interviewed: 0 };
    byAC[ac].created++;
    if (_leDate(r.ApplicationSubmittedDate, cutoff)) byAC[ac].submitted++;
    if (_isPresent(r.AcceptCode) && _leDate(r.AcceptDate, cutoff)) byAC[ac].accepted++;
    if (_isPresent(r.DepositDate) && _leDate(r.DepositDate, cutoff) && !(_isPresent(r.WithdrawnDate) && _leDate(r.WithdrawnDate, cutoff))) {
      byAC[ac].deposited++;
    }
    if (_isPresent(r.DeniedCode) && _leDate(r.DeniedDate, cutoff)) byAC[ac].denied++;
    if (r.InterviewStatus === 'Interviewed' && _leDate(_interviewDate(r, termYear), cutoff)) byAC[ac].interviewed++;
  });
  const gpas = rows.map(r => _parseNum(r['Self-ReportedHSGPA'])).filter(v => v !== null && v > 0 && v <= 5);
  const acts = rows.map(r => _parseNum(r.ACT)).filter(v => v !== null && v > 0);
  const sats = rows.map(r => _parseNum(r.SAT)).filter(v => v !== null && v > 0);
  const clts = rows.map(r => _parseNum(r.CLT)).filter(v => v !== null && v > 0);
  return _attachDemoAndAid({
    created,
    submitted,
    accepted,
    conditional: rows.filter(r => r.AcceptCode === 'CA' && _leDate(r.AcceptDate, cutoff)).length,
    interviewed: rows.filter(r => _leDate(_interviewDate(r, termYear), cutoff)).length,
    depositsGross: depGrossRows.length,
    depositsWithdrawn: depWithdrawnRows.length,
    deposits: depNetRows.length,
    denied: rows.filter(r => _isPresent(r.DeniedCode) && _leDate(r.DeniedDate, cutoff)).length,
    withdrawn: rows.filter(r => _isPresent(r.WithdrawnDate) && _leDate(r.WithdrawnDate, cutoff)).length,
    acceptRate,
    yield: yieldRate,
    yieldRate,
    codes,
    gpa: _avg(gpas),
    act: _avg(acts),
    sat: _avg(sats),
    clt: _avg(clts),
    daysSubmitAccept: null,
    daysAcceptDeposit: null,
    byAC,
    chg: _emptyChg(),
    withdrawalCutoff: cutoff ? _dateOnly(cutoff).toISOString().slice(0, 10) : null,
  }, rows.filter(r => _leDate(r.CreatedDate, cutoff)), accRows, depNetRows);
}

/**
 * Qlik current-term funnel: count rows with the field present (not point-in-time).
 * 7-day column is events in the trailing 7 days, not a stock delta.
 */
export function _termStats(rows, termYear, asOf) {
  const cutoff = _withdrawalCutoff(termYear, asOf);
  const acc = rows.filter(r => _isPresent(r.AcceptCode));
  const depGrossRows = rows.filter(r => _isPresent(r.DepositDate));
  const depWithdrawnRows = depGrossRows.filter(r => _isPresent(r.WithdrawnDate));
  const depNetRows = depGrossRows.filter(r => !_isPresent(r.WithdrawnDate));
  const den = rows.filter(r => _isPresent(r.DeniedCode));
  const created = rows.filter(r => _isPresent(r.CreatedDate)).length;
  const submitted = rows.filter(r => _isPresent(r.ApplicationSubmittedDate)).length;
  const accepted = acc.length;
  const codes = {};
  acc.forEach(r => { codes[r.AcceptCode] = (codes[r.AcceptCode] || 0) + 1; });
  const gpas = rows.map(r => _parseNum(r['Self-ReportedHSGPA'])).filter(v => v !== null && v > 0 && v <= 5);
  const acts = rows.map(r => _parseNum(r.ACT)).filter(v => v !== null && v > 0);
  const sats = rows.map(r => _parseNum(r.SAT)).filter(v => v !== null && v > 0);
  const clts = rows.map(r => _parseNum(r.CLT)).filter(v => v !== null && v > 0);
  const subToAcc = [];
  const accToDep = [];
  acc.forEach(r => {
    const a = _parseDate(r.ApplicationSubmittedDate), b = _parseDate(r.AcceptDate);
    if (a && b && b >= a) subToAcc.push((b - a) / 86400000);
  });
  depNetRows.forEach(r => {
    const a = _parseDate(r.AcceptDate), b = _parseDate(r.DepositDate);
    if (a && b && b >= a) accToDep.push((b - a) / 86400000);
  });
  const byAC = {};
  rows.forEach(r => {
    const ac = r.ApplicationACAssignment || '';
    if (!byAC[ac]) byAC[ac] = { created: 0, submitted: 0, accepted: 0, deposited: 0, denied: 0, interviewed: 0 };
    byAC[ac].created++;
    if (_isPresent(r.ApplicationSubmittedDate)) byAC[ac].submitted++;
    if (_isPresent(r.AcceptCode)) byAC[ac].accepted++;
    if (_isPresent(r.DepositDate) && !_isPresent(r.WithdrawnDate)) byAC[ac].deposited++;
    if (_isPresent(r.DeniedCode)) byAC[ac].denied++;
    if (r.InterviewStatus === 'Interviewed') byAC[ac].interviewed++;
  });

  const chgGross = rows.filter(r => _inLast7(r.DepositDate, asOf)).length;
  const chgWd = depGrossRows.filter(r => _inLast7(r.WithdrawnDate, asOf)).length;
  // Qlik total-deposits 7d: deposited in window and currently not withdrawn.
  const chgNet = rows.filter(r => _inLast7(r.DepositDate, asOf) && !_isPresent(r.WithdrawnDate)).length;
  const acceptRate = submitted ? accepted / submitted * 100 : null;
  const yieldRate = accepted ? depGrossRows.length / accepted * 100 : null;

  const d6 = asOf ? new Date(asOf) : new Date();
  d6.setDate(d6.getDate() - 6);
  const asOf7 = _termStatsAsOf(rows, d6, termYear);
  const chg = {
    created: rows.filter(r => _inLast7(r.CreatedDate, asOf)).length,
    submitted: rows.filter(r => _inLast7(r.ApplicationSubmittedDate, asOf)).length,
    accepted: rows.filter(r => _inLast7(r.AcceptDate, asOf)).length,
    conditional: rows.filter(r => r.AcceptCode === 'CA' && _inLast7(r.AcceptDate, asOf)).length,
    interviewed: rows.filter(r => _inLast7(_interviewDate(r, termYear), asOf)).length,
    depositsGross: chgGross,
    depositsWithdrawn: chgWd,
    deposits: chgNet,
    acceptRate: (acceptRate != null && asOf7.acceptRate != null) ? acceptRate - asOf7.acceptRate : null,
    yield: (yieldRate != null && asOf7.yield != null) ? yieldRate - asOf7.yield : null,
  };

  return _attachDemoAndAid({
    created,
    submitted,
    interviewed: rows.filter(r => r.InterviewStatus === 'Interviewed').length,
    accepted,
    deposits: depNetRows.length,
    depositsGross: depGrossRows.length,
    depositsWithdrawn: depWithdrawnRows.length,
    denied: den.length,
    withdrawn: rows.filter(r => _isPresent(r.WithdrawnDate)).length,
    acceptRate,
    yield: yieldRate,
    yieldRate,
    conditional: codes.CA || 0,
    codes,
    gpa: _avg(gpas),
    act: _avg(acts),
    sat: _avg(sats),
    clt: _avg(clts),
    daysSubmitAccept: _median(subToAcc),
    daysAcceptDeposit: _median(accToDep),
    byAC,
    chg,
    withdrawalCutoff: cutoff.toISOString().slice(0, 10),
  }, rows, acc, depNetRows);
}

export function _procAdm(rows, asOf) {
  const asOfDay = _asOfDay(asOf);
  const lastYear = new Date(asOfDay);
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  const byTerm = {};
  ['Fall 2024', 'Fall 2025', 'Fall 2026', 'Fall 2027'].forEach(t => {
    byTerm[t] = _termStats(rows.filter(r => r.ApplicationTerm === t), _termYear(t), asOfDay);
  });
  const fa25Rows = rows.filter(r => r.ApplicationTerm === 'Fall 2025');
  const fa26Rows = rows.filter(r => r.ApplicationTerm === 'Fall 2026');
  const fa27Rows = rows.filter(r => r.ApplicationTerm === 'Fall 2027');
  const d6 = new Date(asOfDay);
  d6.setDate(d6.getDate() - 6);
  return {
    fa24: byTerm['Fall 2024'],
    fa25: byTerm['Fall 2025'],
    fa26: byTerm['Fall 2026'],
    fa27: byTerm['Fall 2027'],
    fa25Yoy: _termStatsAsOf(fa25Rows, lastYear, 2025),
    fa26Yoy: _termStatsAsOf(fa26Rows, lastYear, 2026),
    fa26_7d: _termStatsAsOf(fa26Rows, d6, 2026),
    fa27_7d: _termStatsAsOf(fa27Rows, d6, 2027),
    allRows: rows,
  };
}

/** January YYYY PSW event → Fall YYYY (Qlik counts by Form Start Date, not Term). */
function _pswCycleKey(r) {
  const d = _parseDate(r.FormStartDateTime);
  if (!d) return r.Term || '';
  return `Fall ${d.getFullYear()}`;
}

function _bumpPsw(map, key, r) {
  if (!map[key]) map[key] = { att: 0, total: 0 };
  map[key].total++;
  if (r.RegistrationStatus === 'Attended') map[key].att++;
}

export function _procPSW(rows) {
  const byTerm = {};
  const byCycle = {};
  rows.forEach(r => {
    _bumpPsw(byTerm, r.Term || '', r);
    _bumpPsw(byCycle, _pswCycleKey(r), r);
  });
  return { byTerm, byCycle };
}

export function _procSLC(rows, islcRows = []) {
  const byClass = {};
  ['Freshman', 'Sophomore', 'Junior', 'Senior'].forEach(c => {
    byClass[c] = { applied: 0, accepted: 0, registered: 0, denied: 0 };
  });
  const bySess = {};
  const bins = {};
  rows.forEach(r => {
    const cl = r.SLC_Hs_Class_Year;
    // SLC_RegistrationStatus is the live field; SLC_Registered is always blank
    const regStatus = r.SLC_RegistrationStatus || '';
    const isReg = regStatus === 'Registered' || regStatus === 'Attended';
    if (byClass[cl]) {
      byClass[cl].applied++;
      if (r.SLC_Accepted === 'Accepted') byClass[cl].accepted++;
      if (isReg) byClass[cl].registered++;
      if (r.SLC_Denied === 'Denied') byClass[cl].denied++;
    }
    if (isReg) {
      const raw = (r.SLC_FormStartDateTime || '').slice(0, 10);
      const sess = raw.replace(/\//g, '-');
      if (!bySess[sess]) bySess[sess] = { Female: 0, Male: 0, total: 0 };
      bySess[sess][r.SLC_Sex === 'Male' ? 'Male' : 'Female']++;
      bySess[sess].total++;
    }
    const b = r.SLC_WorkflowRecordsSummerLeadershipBin || '';
    bins[b] = (bins[b] || 0) + 1;
  });
  const slcReg = rows.filter(r => { const s = r.SLC_RegistrationStatus || ''; return s === 'Registered' || s === 'Attended'; }).length;
  const slcAtt = rows.filter(r => r.SLC_RegistrationStatus === 'Attended').length;
  const islcList = islcRows || [];
  const islcAtt = islcList.filter(r => r.ISLCRegistrationStatus === 'Attended').length;
  return {
    applied: rows.length,
    accepted: rows.filter(r => r.SLC_Accepted === 'Accepted').length,
    registered: slcReg,
    attended: slcAtt,
    denied: rows.filter(r => r.SLC_Denied === 'Denied').length,
    byClass, bySess, bins,
    byTerm: {
      'Fall 2025': { registered: islcList.length, attended: islcAtt },
      'Fall 2026': { registered: slcReg, attended: slcAtt },
      'Fall 2027': { registered: 0, attended: 0 },
    },
  };
}

export function _procWD(rows) {
  const byAC = {};
  const byTerm = {};
  rows.forEach(r => {
    const ac = r.ACAssignment || '';
    byAC[ac] = (byAC[ac] || 0) + 1;
    const term = r.ApplicationTerm || r.Term || '';
    if (term) byTerm[term] = (byTerm[term] || 0) + 1;
  });
  return {
    total: rows.length,
    noDecision: rows.filter(r => r.WithdrawnType === 'Withdrawn No Decision').length,
    postAccept: rows.filter(r => r.WithdrawnType === 'Withdrawn Accepted').length,
    hasTerm: rows.some(r => r.ApplicationTerm || r.Term),
    byTerm, byAC, rows,
  };
}

export function _procCampus(rows) {
  // Group by month. Fall months (Sep/Oct/Nov) of year Y → FA Fall (Y+1).
  // Spring months (Feb/Mar/Apr) of year Y → FA Fall Y.
  const MONTH_LABELS = { 2:'Feb', 3:'Mar', 4:'Apr', 9:'Sep', 10:'Oct', 11:'Nov' };

  function buildByCycle(signUpCutoff) {
    const bc = {};
    rows.forEach(r => {
      if (signUpCutoff) {
        const su = r['TourSign-upDate'];
        if (su && new Date(su) > signUpCutoff) return;
      }
      const date = r.FormStartDate || '';
      if (!date) return;
      const [y, mo] = date.slice(0, 7).split('-').map(Number);
      const label = MONTH_LABELS[mo];
      if (!label) return;
      const faYear = (mo >= 9) ? y + 1 : y;
      const faKey = `Fall ${faYear}`;
      if (!bc[faKey]) bc[faKey] = {};
      if (!bc[faKey][label]) bc[faKey][label] = { attended: 0, registered: 0 };
      if (r.RegistrationStatus === 'Attended') bc[faKey][label].attended++;
      else if (r.RegistrationStatus === 'Registered') bc[faKey][label].registered++;
    });
    return bc;
  }

  const today = new Date();
  const lastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return {
    total: rows.length,
    attended: rows.filter(r => r.RegistrationStatus === 'Attended').length,
    registered: rows.filter(r => r.RegistrationStatus === 'Registered').length,
    cancelled: rows.filter(r => r.RegistrationStatus === 'Cancelled').length,
    noShow: rows.filter(r => r.RegistrationStatus === 'No Show').length,
    byCycle: buildByCycle(null),
    byCycleYoy: buildByCycle(lastYear),
    byCycle7d: buildByCycle(sevenDaysAgo),
  };
}

export function _procAME(rows, asOf) {
  const MONTH_LABELS = { 2:'Feb', 3:'Mar', 4:'Apr', 9:'Sep', 10:'Oct', 11:'Nov' };
  const FALL = new Set(['Sep', 'Oct', 'Nov']);
  const asOfDay = _asOfDay(asOf);

  function emptyMonth() {
    return { attended: 0, registered: 0, chg: 0 };
  }

  // Qlik groups AME by event month → recruiting cycle, not the person's Term.
  const byCycle = {};
  rows.forEach(r => {
    const eventDate = r.FormStartDateTime || '';
    if (!eventDate) return;
    const y = parseInt(eventDate.slice(0, 4), 10);
    const mo = parseInt(eventDate.slice(5, 7), 10);
    const label = MONTH_LABELS[mo];
    if (!y || !label) return;
    const faYear = (mo >= 9) ? y + 1 : y;
    const faKey = `Fall ${faYear}`;
    if (!byCycle[faKey]) byCycle[faKey] = {};
    if (!byCycle[faKey][label]) byCycle[faKey][label] = emptyMonth();
    const status = r.RegistrationStatus || '';
    if (status === 'Attended') byCycle[faKey][label].attended++;
    else if (status === 'Registered') byCycle[faKey][label].registered++;
    const inWindow = FALL.has(label)
      ? status === 'Attended'
      : (status === 'Attended' || status === 'Registered');
    if (inWindow && _inLast7(r.SubmissionDate, asOfDay)) byCycle[faKey][label].chg++;
  });

  return {
    total: rows.length,
    byCycle,
    byCycleYoy: byCycle,
    byCycle7d: byCycle,
  };
}
