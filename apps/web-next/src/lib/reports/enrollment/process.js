/** Enrollment data processors — ported from admissions hub, no DOM. */
export const DATA = {
  api: (typeof window !== 'undefined' && window.AMU_DASHBOARD_API) || '/api/dashboard',
  // Logical hub keys → keys in report_presigned_urls
  reports: {
    admissions:  'admissions',
    decisions:   'app_decisions',
    psw:         'psw',
    slc:         'slc',
    islc:        'islc',
    withdrawn:   'withdrawn',
    campus:      'campus_visits',
    ame:         'ame',
    messages:    'messages',
    interactions: 'interactions',
  },
};

/**
 * Interaction codes counted as a counselor touchpoint, mapped to a channel.
 * Excludes system/marketing noise (SOURCE, direct mail, vendor imports) which
 * make up the bulk of the raw Slate Interactions feed.
 */
export const TOUCHPOINT_INTERACTION_CODES = {
  contact_out_call: 'call',
  contact_out_call_parent: 'call',
  voicemail: 'call',
  inbox_sms_sent: 'sms',
  sms_message_sent: 'sms',
  sms_message_replied: 'sms',
  video_message_sent: 'video',
  internal_note: 'note',
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

/** Athlete flag is this field only. Sport and Athletic Decision are not athletes. */
function _isAthlete(r) {
  return r.AthleteorNonAthlete === 'Athlete';
}

/** Viable = Catholic (incl. Eastern Rite) with a plausible HS GPA above 3.1. */
export function _isViable(r) {
  const catholic = r.Religion === 'Catholic' || r.Religion === 'Eastern Rite Catholic';
  if (!catholic) return false;
  const gpa = _parseNum(r['Self-ReportedHSGPA']);
  return gpa !== null && gpa > 3.1 && gpa <= 5;
}

/**
 * Per-counselor touchpoints for one term's applicant cohort (calls/SMS/video/notes
 * from the interactions feed). The feed has no actor field, so attribution is via
 * each applicant's current AC assignment.
 */
function _touchpointsByAC(termRows, interactionRows) {
  const personAc = new Map();
  termRows.forEach(r => {
    const pid = r.PersonReferenceID;
    if (pid) personAc.set(pid, r.ApplicationACAssignment || '');
  });

  const byAC = {};
  const touchedPersons = {};
  (interactionRows || []).forEach(ia => {
    const pid = ia.PersonReferenceID;
    if (!personAc.has(pid)) return;
    if (!TOUCHPOINT_INTERACTION_CODES[ia.InteractionCode]) return;
    const ac = personAc.get(pid);
    if (!byAC[ac]) byAC[ac] = { touchpoints: 0, touchpointsPerApp: null };
    if (!touchedPersons[ac]) touchedPersons[ac] = new Set();
    byAC[ac].touchpoints++;
    touchedPersons[ac].add(pid);
  });

  Object.keys(byAC).forEach(ac => {
    const touched = touchedPersons[ac].size;
    byAC[ac].touchpointsPerApp = touched ? byAC[ac].touchpoints / touched : null;
  });
  return byAC;
}

export const SHARED_TEXT_LINE = '__shared__';

/**
 * 1:1 SMS conversations per counselor from the Slate messages feed (a rolling
 * window — the query only returns recent messages). Ad Hoc Message = counselor's
 * 1:1 text from their Slate number; External Message = inbound student text to
 * that number. Bulk Deliver campaigns are excluded.
 *
 * Each Slate number is attributed to the counselor who is assigned to >=80% of
 * the students it talks to; lower-concentration numbers are shared office lines.
 *
 * Reply time: per (number, student) thread, the clock starts at the first unanswered
 * student text and stops at the counselor's next 1:1 text. Dates have no time of
 * day, so a same-day counselor text counts as a same-day reply.
 */
export function _procTexting(admRows, messageRows) {
  const adm = new Map();
  (admRows || []).forEach(r => {
    if (r.PersonReferenceID && !adm.has(r.PersonReferenceID)) adm.set(r.PersonReferenceID, r);
  });

  const events = [];
  let from = null;
  let to = null;
  (messageRows || []).forEach(m => {
    if (m.MessageMethod !== 'SMS') return;
    const d = _parseDate(m.MessageDeliveredDate);
    const pid = m.MessagePersonReferenceID;
    if (!d || !pid) return;
    let line;
    let out;
    if (m.MessageType === 'Ad Hoc Message') {
      line = m.MessageSender;
      out = true;
    } else if (m.MessageType === 'External Message') {
      line = m.MessageRecipient;
      out = false;
    } else {
      return;
    }
    if (!line) return;
    events.push({ line, pid, d, out });
    if (!from || d < from) from = d;
    if (!to || d > to) to = d;
  });

  const tally = new Map();
  events.forEach(e => {
    const ac = adm.get(e.pid)?.ApplicationACAssignment || '';
    if (!tally.has(e.line)) tally.set(e.line, new Map());
    const t = tally.get(e.line);
    t.set(ac, (t.get(ac) || 0) + 1);
  });
  const owner = new Map();
  tally.forEach((t, line) => {
    let total = 0;
    let top = '';
    let topN = 0;
    t.forEach((n, ac) => {
      total += n;
      if (n > topN) { top = ac; topN = n; }
    });
    owner.set(line, total >= 20 && topN / total >= 0.8 ? top : SHARED_TEXT_LINE);
  });

  const threads = new Map();
  events.forEach(e => {
    const key = `${e.line}\u0000${e.pid}`;
    if (!threads.has(key)) threads.set(key, { line: e.line, pid: e.pid, items: [] });
    threads.get(key).items.push(e);
  });

  const acc = {};
  const ensure = ac => {
    if (!acc[ac]) {
      acc[ac] = { sent: 0, received: 0, students: new Set(), viable: new Set(), waits: [], awaiting: 0 };
    }
    return acc[ac];
  };
  threads.forEach(({ line, pid, items }) => {
    const a = ensure(owner.get(line));
    // Same day: inbound sorts before outbound so a same-day counselor text closes it.
    items.sort((x, y) => (x.d - y.d) || (x.out - y.out));
    let clock = null;
    items.forEach(e => {
      if (e.out) {
        a.sent++;
        a.students.add(pid);
        const r = adm.get(pid);
        if (r && _isViable(r)) a.viable.add(pid);
        if (clock) {
          a.waits.push(Math.round((e.d - clock) / 86400000));
          clock = null;
        }
      } else {
        a.received++;
        if (!clock) clock = e.d;
      }
    });
    if (clock) a.awaiting++;
  });

  const byAC = {};
  Object.entries(acc).forEach(([ac, a]) => {
    const n = a.waits.length;
    byAC[ac] = {
      sent: a.sent,
      studentsTexted: a.students.size,
      viableTexted: a.viable.size,
      received: a.received,
      replies: n,
      sameDayPct: n ? a.waits.filter(w => w === 0).length / n * 100 : null,
      within1DayPct: n ? a.waits.filter(w => w <= 1).length / n * 100 : null,
      avgReplyDays: n ? _avg(a.waits) : null,
      awaiting: a.awaiting,
    };
  });
  const iso = d => (d ? _dateOnly(d).toISOString().slice(0, 10) : null);
  return { byAC, from: iso(from), to: iso(to) };
}

/** 25/26 rating_1-4 only. Do not score 24/25 leftover (rating_0-3). */
const AC_REC_KEYS_26 = [
  'InterviewACRating',
  'PersonInterview-ACReccomendations2526',
  'Interview - AC Reccomendations (25/26)',
  'PersonInterview-ACRating',
];

function _leadingInt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  const m = String(v).trim().match(/^(-?\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Leading integer from the 25/26 1-4 AC rec field, or null if missing. */
export function _acRecScore(row) {
  if (!row) return null;
  for (const key of AC_REC_KEYS_26) {
    const n = _leadingInt(row[key]);
    if (n != null) return n;
  }
  return null;
}

function _acRecCounts(rows, dateGate) {
  let acRec3 = 0;
  let acRec4 = 0;
  for (const r of rows) {
    const s = _acRecScore(r);
    if (s !== 3 && s !== 4) continue;
    if (dateGate && !dateGate(r)) continue;
    if (s === 3) acRec3++;
    else acRec4++;
  }
  return { acRec3, acRec4, acRec34: acRec3 + acRec4 };
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
    interviewedAthletes: 0, interviewedAthletePct: null,
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
  const interviewed = rows.filter(r => _leDate(_interviewDate(r, termYear), cutoff)).length;
  const interviewedAthletes = rows.filter(r => _leDate(_interviewDate(r, termYear), cutoff) && _isAthlete(r)).length;
  const interviewedAthletePct = interviewed ? interviewedAthletes / interviewed * 100 : null;
  const byAC = {};
  rows.forEach(r => {
    if (!_leDate(r.CreatedDate, cutoff)) return;
    const ac = r.ApplicationACAssignment || '';
    if (!byAC[ac]) byAC[ac] = { created: 0, submitted: 0, accepted: 0, deposited: 0, denied: 0, interviewed: 0, viable: 0 };
    byAC[ac].created++;
    if (_leDate(r.ApplicationSubmittedDate, cutoff)) byAC[ac].submitted++;
    if (_isPresent(r.AcceptCode) && _leDate(r.AcceptDate, cutoff)) byAC[ac].accepted++;
    if (_isPresent(r.DepositDate) && _leDate(r.DepositDate, cutoff) && !(_isPresent(r.WithdrawnDate) && _leDate(r.WithdrawnDate, cutoff))) {
      byAC[ac].deposited++;
    }
    if (_isPresent(r.DeniedCode) && _leDate(r.DeniedDate, cutoff)) byAC[ac].denied++;
    if (r.InterviewStatus === 'Interviewed' && _leDate(_interviewDate(r, termYear), cutoff)) byAC[ac].interviewed++;
    if (_isViable(r)) byAC[ac].viable++;
  });
  const gpas = rows.map(r => _parseNum(r['Self-ReportedHSGPA'])).filter(v => v !== null && v > 0 && v <= 5);
  const acts = rows.map(r => _parseNum(r.ACT)).filter(v => v !== null && v > 0);
  const sats = rows.map(r => _parseNum(r.SAT)).filter(v => v !== null && v > 0);
  const clts = rows.map(r => _parseNum(r.CLT)).filter(v => v !== null && v > 0);
  // 1-4 rec field starts FA26 / 25-26. Do not count person-scoped current recs on FA24/FA25.
  const rec = termYear < 2026
    ? { acRec3: 0, acRec4: 0, acRec34: 0 }
    : _acRecCounts(rows, r => _leDate(_interviewDate(r, termYear), cutoff));
  return _attachDemoAndAid({
    created,
    submitted,
    accepted,
    conditional: rows.filter(r => r.AcceptCode === 'CA' && _leDate(r.AcceptDate, cutoff)).length,
    interviewed,
    interviewedAthletes,
    interviewedAthletePct,
    acRec3: rec.acRec3,
    acRec4: rec.acRec4,
    acRec34: rec.acRec34,
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
    if (!byAC[ac]) byAC[ac] = { created: 0, submitted: 0, accepted: 0, deposited: 0, denied: 0, interviewed: 0, viable: 0 };
    byAC[ac].created++;
    if (_isPresent(r.ApplicationSubmittedDate)) byAC[ac].submitted++;
    if (_isPresent(r.AcceptCode)) byAC[ac].accepted++;
    if (_isPresent(r.DepositDate) && !_isPresent(r.WithdrawnDate)) byAC[ac].deposited++;
    if (_isPresent(r.DeniedCode)) byAC[ac].denied++;
    if (r.InterviewStatus === 'Interviewed') byAC[ac].interviewed++;
    if (_isViable(r)) byAC[ac].viable++;
  });

  const chgGross = rows.filter(r => _inLast7(r.DepositDate, asOf)).length;
  const chgWd = depGrossRows.filter(r => _inLast7(r.WithdrawnDate, asOf)).length;
  // Qlik total-deposits 7d: deposited in window and currently not withdrawn.
  const chgNet = rows.filter(r => _inLast7(r.DepositDate, asOf) && !_isPresent(r.WithdrawnDate)).length;
  const acceptRate = submitted ? accepted / submitted * 100 : null;
  const yieldRate = accepted ? depGrossRows.length / accepted * 100 : null;
  const interviewed = rows.filter(r => r.InterviewStatus === 'Interviewed').length;
  const interviewedAthletes = rows.filter(r => r.InterviewStatus === 'Interviewed' && _isAthlete(r)).length;
  const interviewedAthletePct = interviewed ? interviewedAthletes / interviewed * 100 : null;
  // 1-4 rec field starts FA26 / 25-26. Do not count person-scoped current recs on FA24/FA25.
  const rec = termYear < 2026
    ? { acRec3: 0, acRec4: 0, acRec34: 0 }
    : _acRecCounts(rows);

  const d6 = asOf ? new Date(asOf) : new Date();
  d6.setDate(d6.getDate() - 6);
  const asOf7 = _termStatsAsOf(rows, d6, termYear);
  const chg = {
    created: rows.filter(r => _inLast7(r.CreatedDate, asOf)).length,
    submitted: rows.filter(r => _inLast7(r.ApplicationSubmittedDate, asOf)).length,
    accepted: rows.filter(r => _inLast7(r.AcceptDate, asOf)).length,
    conditional: rows.filter(r => r.AcceptCode === 'CA' && _inLast7(r.AcceptDate, asOf)).length,
    interviewed: rows.filter(r => _inLast7(_interviewDate(r, termYear), asOf)).length,
    interviewedAthletes: rows.filter(r => _inLast7(_interviewDate(r, termYear), asOf) && _isAthlete(r)).length,
    depositsGross: chgGross,
    depositsWithdrawn: chgWd,
    deposits: chgNet,
    acceptRate: (acceptRate != null && asOf7.acceptRate != null) ? acceptRate - asOf7.acceptRate : null,
    // The 7-day percent is not published because the current rate is Interview Status and the week window is interview date.
    interviewedAthletePct: null,
    yield: (yieldRate != null && asOf7.yield != null) ? yieldRate - asOf7.yield : null,
  };

  return _attachDemoAndAid({
    created,
    submitted,
    interviewed,
    interviewedAthletes,
    interviewedAthletePct,
    acRec3: rec.acRec3,
    acRec4: rec.acRec4,
    acRec34: rec.acRec34,
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
    daysSubmitAccept: _avg(subToAcc),
    daysAcceptDeposit: _avg(accToDep),
    byAC,
    chg,
    withdrawalCutoff: cutoff.toISOString().slice(0, 10),
  }, rows, acc, depNetRows);
}

/** UG only: First-Year, Transfer, Re-Admission, Second Degree. Drops Grad / Dual Enrollment. */
function _isUndergraduate(r) {
  const s = String(r?.ApplicationStudentType || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!s) return false;
  if (/transfer/.test(s)) return true;
  if (/re ?admit/.test(s) || /readmission/.test(s) || /re admission/.test(s)) return true;
  if (/second/.test(s) && (/degree/.test(s) || /bachelor/.test(s))) return true;
  if (/fresh/.test(s) || (/first/.test(s) && (/year/.test(s) || /time/.test(s)))) return true;
  return false;
}

/** Per-AC touchpoints for one term's UG applicants; loaded separately from the main bundle. */
export function _procTouchpoints(admRows, termKey, interactionRows) {
  const termRows = admRows.filter(r => _isUndergraduate(r) && r.ApplicationTerm === termKey);
  return _touchpointsByAC(termRows, interactionRows);
}

function _ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Undergraduate interviews bucketed by the month the interview actually
 * happened, for a 15-month recruiting-cycle window (June of the term's
 * prior calendar year through August of the term year). The Slate field
 * that carries the date depends on when the interview happened, not on
 * the application term: early-cycle interviews for a rolled-over applicant
 * can land in an earlier term's field, and the FA27 field does not exist
 * in the feed yet. So for each row we take every candidate date present
 * (FA27, FA26, FA25 fields) and use the one that falls inside this term's
 * window; when none is inside the window we fall back to the latest
 * candidate so the row still lands in before or after.
 */
export function _interviewsByMonth(rows, asOf) {
  const asOfDay = _asOfDay(asOf);
  const asOfMonth1 = asOfDay.getMonth() + 1; // 1-indexed
  const currentTermYear = asOfMonth1 >= 6 ? asOfDay.getFullYear() + 1 : asOfDay.getFullYear();
  // Position of asOf's calendar month inside the current term's window (0..14).
  // Reused for every term so Jun/Jul/Aug, which appear twice per window, line
  // up by cycle position rather than by an ambiguous calendar-month lookup.
  const monthIndex = (asOfDay.getFullYear() * 12 + asOfDay.getMonth())
    - ((currentTermYear - 1) * 12 + 5);

  function windowKeys(termYear) {
    const keys = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(termYear - 1, 5 + i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
  }

  function candidates(r) {
    return [r.InterviewedDateFA27Apps, r.InterviewedDateFA26Apps, r.InterviewedDateFA25Apps]
      .map(_parseDate)
      .filter(Boolean);
  }

  const out = {};
  ['Fall 2025', 'Fall 2026', 'Fall 2027'].forEach(term => {
    const termYear = _termYear(term);
    const keys = windowKeys(termYear);
    const start = new Date(termYear - 1, 5, 1);
    const end = new Date(termYear, 7, 31);
    const months = {};
    keys.forEach(k => { months[k] = 0; });
    const cutoff = new Date(asOfDay);
    cutoff.setFullYear(cutoff.getFullYear() - (currentTermYear - termYear));
    const monthKey = (monthIndex >= 0 && monthIndex < 15) ? keys[monthIndex] : null;

    let before = 0;
    let after = 0;
    let total = 0;
    let toDate = 0;
    let monthToDate = 0;

    rows.filter(r => r.ApplicationTerm === term).forEach(r => {
      const cands = candidates(r);
      if (!cands.length) return;
      const inWindow = cands.filter(d => d >= start && d <= end);
      const chosen = inWindow.length
        ? inWindow.reduce((a, b) => (b > a ? b : a))
        : cands.reduce((a, b) => (b > a ? b : a));
      total++;
      if (chosen <= cutoff) toDate++;
      if (chosen < start) { before++; return; }
      if (chosen > end) { after++; return; }
      const key = `${chosen.getFullYear()}-${String(chosen.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + 1;
      if (monthKey && key === monthKey && chosen.getDate() <= asOfDay.getDate()) monthToDate++;
    });

    out[term] = { months, before, after, total, toDate, monthToDate };
  });

  const sameDateLastYear = new Date(asOfDay);
  sameDateLastYear.setFullYear(sameDateLastYear.getFullYear() - 1);

  return { ...out, asOf: _ymd(asOfDay), sameDateLastYear: _ymd(sameDateLastYear) };
}

export function _procAdm(rows, asOf) {
  const asOfDay = _asOfDay(asOf);
  const lastYear = new Date(asOfDay);
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  const twoYearsAgo = new Date(asOfDay);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const ug = rows.filter(_isUndergraduate);
  const byTerm = {};
  ['Fall 2024', 'Fall 2025', 'Fall 2026', 'Fall 2027'].forEach(t => {
    byTerm[t] = _termStats(ug.filter(r => r.ApplicationTerm === t), _termYear(t), asOfDay);
  });
  const fa24Rows = ug.filter(r => r.ApplicationTerm === 'Fall 2024');
  const fa25Rows = ug.filter(r => r.ApplicationTerm === 'Fall 2025');
  const fa26Rows = ug.filter(r => r.ApplicationTerm === 'Fall 2026');
  const fa27Rows = ug.filter(r => r.ApplicationTerm === 'Fall 2027');
  const d6 = new Date(asOfDay);
  d6.setDate(d6.getDate() - 6);
  return {
    fa24: byTerm['Fall 2024'],
    fa25: byTerm['Fall 2025'],
    fa26: byTerm['Fall 2026'],
    fa27: byTerm['Fall 2027'],
    fa24Yoy2: _termStatsAsOf(fa24Rows, twoYearsAgo, 2024),
    fa25Yoy: _termStatsAsOf(fa25Rows, lastYear, 2025),
    fa25Yoy2: _termStatsAsOf(fa25Rows, twoYearsAgo, 2025),
    fa26Yoy: _termStatsAsOf(fa26Rows, lastYear, 2026),
    fa26_7d: _termStatsAsOf(fa26Rows, d6, 2026),
    fa27_7d: _termStatsAsOf(fa27Rows, d6, 2027),
    interviewsByMonth: _interviewsByMonth(ug, asOfDay),
    allRows: rows,
  };
}

/** Signed up and not cancelled — Qlik Match(status, 'Registered', 'Attended'). */
function _isEventRegistrant(status) {
  return status === 'Registered' || status === 'Attended';
}
function _shiftYears(d, years) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + years);
  return x;
}

/** January YYYY PSW event → Fall YYYY (Qlik counts by Form Start Date, not Term). */
function _pswCycleKey(r) {
  const d = _parseDate(r.FormStartDateTime);
  if (!d) return r.Term || '';
  return `Fall ${d.getFullYear()}`;
}

function _emptyPsw() {
  return { att: 0, noShow: 0, cancelled: 0, registered: 0, total: 0, registrants: 0 };
}

function _bumpPsw(map, key, r) {
  if (!map[key]) map[key] = _emptyPsw();
  const s = r.RegistrationStatus || '';
  map[key].total++;
  if (s === 'Attended') map[key].att++;
  else if (s === 'No Show') map[key].noShow++;
  else if (s === 'Cancelled') map[key].cancelled++;
  else if (s === 'Registered') map[key].registered++;
  if (s !== 'Cancelled') map[key].registrants++;
}

export function _procPSW(rows, asOf) {
  const asOfDay = _asOfDay(asOf);
  const lastYear = _shiftYears(asOfDay, -1);
  const byTerm = {};
  const byCycle = {};
  const byCycleYoy = {};
  rows.forEach(r => {
    // FormSubmissionDate is the student signup. FormCreatedDate is the form
    // template date (same for every row). FormStartDateTime is the event.
    _bumpPsw(byTerm, r.Term || '', r);
    _bumpPsw(byCycle, _pswCycleKey(r), r);
    if (_leDate(r.FormSubmissionDate, lastYear)) _bumpPsw(byCycleYoy, _pswCycleKey(r), r);
  });
  return { byTerm, byCycle, byCycleYoy };
}

export function _procSLC(rows, islcRows = [], asOf) {
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
  const slcReg = rows.filter(r => _isEventRegistrant(r.SLC_RegistrationStatus)).length;
  const slcAtt = rows.filter(r => r.SLC_RegistrationStatus === 'Attended').length;
  const islcList = islcRows || [];
  const islcReg = islcList.filter(r => _isEventRegistrant(r.ISLCRegistrationStatus)).length;
  const islcAtt = islcList.filter(r => r.ISLCRegistrationStatus === 'Attended').length;
  const asOfDay = _asOfDay(asOf);
  const lastYear = _shiftYears(asOfDay, -1);
  const slcRegYoy = rows.filter(r =>
    _isEventRegistrant(r.SLC_RegistrationStatus)
    && _leDate(r.SLC_FormSubmissionDate || r.SLC_FormStartDateTime, lastYear),
  ).length;
  const islcRegYoy = islcList.filter(r =>
    _isEventRegistrant(r.ISLCRegistrationStatus)
    && _leDate(r.ISLCFormSubmissionDate, lastYear),
  ).length;
  return {
    applied: rows.length,
    accepted: rows.filter(r => r.SLC_Accepted === 'Accepted').length,
    registered: slcReg,
    attended: slcAtt,
    denied: rows.filter(r => r.SLC_Denied === 'Denied').length,
    byClass, bySess, bins,
    byTerm: {
      'Fall 2025': { registered: islcReg, attended: islcAtt },
      'Fall 2026': { registered: slcReg, attended: slcAtt },
      'Fall 2027': { registered: 0, attended: 0 },
    },
    byTermYoy: {
      'Fall 2025': { registered: islcRegYoy, attended: 0 },
      'Fall 2026': { registered: slcRegYoy, attended: 0 },
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

function _emptyAmeFy() {
  return { total: 0, attended: 0, registered: 0, cancelled: 0, noShow: 0 };
}

/** Event date in the July 1–June 30 fiscal year → Fall YYYY of the FY end. */
function _ameFyKey(dateStr) {
  const d = _parseDate(dateStr);
  if (!d) return '';
  const endYear = d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
  return `Fall ${endYear}`;
}

export function _procAME(rows, asOf) {
  const MONTH_LABELS = { 2:'Feb', 3:'Mar', 4:'Apr', 9:'Sep', 10:'Oct', 11:'Nov' };
  const asOfDay = _asOfDay(asOf);
  const lastYear = _shiftYears(asOfDay, -1);

  function emptyMonth() {
    return { attended: 0, registered: 0, registrants: 0, chg: 0, signups: 0, noShow: 0 };
  }

  /** Sign-ups = Registered + Attended + No Show. Excludes Cancelled and Waitlist. */
  function _isSignup(status) {
    return status === 'Registered' || status === 'Attended' || status === 'No Show';
  }

  function addRow(bc, r, trackChg) {
    const eventDate = r.FormStartDateTime || '';
    if (!eventDate) return;
    const y = parseInt(eventDate.slice(0, 4), 10);
    const mo = parseInt(eventDate.slice(5, 7), 10);
    const label = MONTH_LABELS[mo];
    if (!y || !label) return;
    const status = r.RegistrationStatus || '';
    if (!_isSignup(status)) return;
    const faYear = (mo >= 9) ? y + 1 : y;
    const faKey = `Fall ${faYear}`;
    if (!bc[faKey]) bc[faKey] = {};
    if (!bc[faKey][label]) bc[faKey][label] = emptyMonth();
    const cell = bc[faKey][label];
    cell.signups++;
    if (status === 'No Show') cell.noShow++;
    // registrants/attended/registered/chg keep their original Registered-or-Attended scope.
    if (_isEventRegistrant(status)) {
      cell.registrants++;
      if (status === 'Attended') cell.attended++;
      else cell.registered++;
      if (trackChg && _inLast7(r.SubmissionDate, asOfDay)) cell.chg++;
    }
  }

  // Event month → recruiting cycle. Registrants = Registered + Attended.
  // YoY column uses submission date <= same calendar date last year.
  const byCycle = {};
  const byCycleYoy = {};
  const byFy = {};
  rows.forEach(r => {
    addRow(byCycle, r, true);
    if (_leDate(r.SubmissionDate, lastYear)) addRow(byCycleYoy, r, false);
    const fyKey = _ameFyKey(r.FormStartDateTime);
    if (!fyKey) return;
    if (!byFy[fyKey]) byFy[fyKey] = _emptyAmeFy();
    const fy = byFy[fyKey];
    fy.total++;
    const status = r.RegistrationStatus || '';
    if (status === 'Attended') fy.attended++;
    else if (status === 'Registered') fy.registered++;
    else if (status === 'Cancelled') fy.cancelled++;
    else if (status === 'No Show') fy.noShow++;
  });

  const sameDateLastYear = new Date(asOfDay);
  sameDateLastYear.setFullYear(sameDateLastYear.getFullYear() - 1);

  return {
    total: rows.length,
    byCycle,
    byCycleYoy,
    byCycle7d: byCycle,
    byFy,
    asOf: _ymd(asOfDay),
    sameDateLastYear: _ymd(sameDateLastYear),
  };
}
