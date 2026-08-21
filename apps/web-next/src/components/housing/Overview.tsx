import {
  ELIG,
  GOAL,
  MEN_HALLS,
  MELT,
  RET,
  WOMEN_HALLS,
  hallCap,
  hallResidents,
  isAbroad,
  isCommuter,
  isIreland,
  isRome,
  isUnassigned,
  pct,
  possibleCommuters,
  remainingMelt,
  secOf,
  sumHalls,
} from "@/lib/reports/housing/model";
import type { HallChart, Resident, RoomVerificationState, StudyAbroad, WithdrawnInfo } from "@/lib/reports/housing/types";
import styles from "./housing.module.css";

function pill(n: number) {
  return <span className={`${styles.pill} ${n > 60 ? styles.pillWarn : styles.pillOk}`}>{n}</span>;
}

function delta(n: number) {
  return <span className={n < 0 ? styles.deltaDn : styles.deltaUp}>{n >= 0 ? "+" : ""}{n}</span>;
}

export function Overview({
  residents,
  charts,
  occ,
  edits,
  withdrawn,
  studyAbroad,
  cachedAt,
}: {
  residents: Resident[];
  charts: Record<string, HallChart>;
  occ: Record<string, Record<string, Resident[]>>;
  edits: RoomVerificationState["edits"];
  withdrawn?: WithdrawnInfo;
  studyAbroad?: StudyAbroad | null;
  cachedAt?: string;
}) {
  const capFn = (code: string) => hallCap(charts[code], code, edits);
  const occFn = (code: string) => hallResidents(occ, code);
  const capW = sumHalls(WOMEN_HALLS, capFn);
  const capM = sumHalls(MEN_HALLS, capFn);
  const capT = capW + capM;
  const occW = sumHalls(WOMEN_HALLS, occFn);
  const occM = sumHalls(MEN_HALLS, occFn);
  const occT = occW + occM;
  const fW = capW ? (occW / capW) * 100 : 0;
  const fM = capM ? (occM / capM) * 100 : 0;
  const fT = capT ? (occT / capT) * 100 : 0;

  const remW = remainingMelt(MELT.w, withdrawn?.deposit_total_w, withdrawn?.withdrawn_w, occW);
  const remM = remainingMelt(MELT.m, withdrawn?.deposit_total_m, withdrawn?.withdrawn_m, occM);
  const pOccW = Math.max(0, occW - remW);
  const pOccM = Math.max(0, occM - remM);
  const pOccT = pOccW + pOccM;
  const pW = capW ? (pOccW / capW) * 100 : 0;
  const pM = capM ? (pOccM / capM) * 100 : 0;
  const pT = capT ? (pOccT / capT) * 100 : 0;

  const inc = residents.filter((r) => (r.student_type || "").startsWith("Incoming"));
  const ret = residents.filter((r) => r.student_type === "Returning");
  const incW = inc.filter((r) => secOf(r.building) === "w").length;
  const incM = inc.filter((r) => secOf(r.building) === "m").length;
  const pIncW = Math.max(0, incW - remW);
  const pIncM = Math.max(0, incM - remM);
  const retW = ret.filter((r) => secOf(r.building) === "w").length;
  const retM = ret.filter((r) => secOf(r.building) === "m").length;
  const abroad = ret.filter((r) => isAbroad(r.building) || isRome(r));
  const abrW = abroad.filter((r) => r.gender === "F").length;
  const abrM = abroad.filter((r) => r.gender === "M").length;
  const projW = Math.round((ELIG.w * RET.w) / 100);
  const projM = Math.round((ELIG.m * RET.m) / 100);
  const com = possibleCommuters(inc);
  const comW = com.filter((r) => r.gender === "F").length;
  const comM = com.filter((r) => r.gender === "M").length;

  const ireland = studyAbroad?.total ?? residents.filter((r) => isIreland(r.building)).length;
  const cia = studyAbroad?.houses?.CIARA ?? residents.filter((r) => r.building === "CIARA").length;
  const mal = studyAbroad?.houses?.MALAC ?? residents.filter((r) => r.building === "MALAC").length;
  const romeRows = residents.filter(isRome);
  const rome = romeRows.length;
  const irelandRows = residents.filter((r) => isIreland(r.building));
  const commuterRows = residents.filter(isCommuter);
  const mbkRows = residents.filter((r) => r.building === "MBK");
  const unassignedRows = residents.filter(isUnassigned);

  const gsub = (rows: Resident[]) =>
    `${rows.filter((r) => r.gender === "F").length} W · ${rows.filter((r) => r.gender === "M").length} M`;
  const halls = residents.filter((r) => secOf(r.building));
  const segs = [
    { t: "In residence halls", n: halls.length, sub: gsub(halls), c: "#1B5EA8" },
    { t: "Study abroad · Ireland", n: irelandRows.length, sub: gsub(irelandRows), c: "#943060" },
    { t: "Study abroad · Rome", n: rome, sub: gsub(romeRows), c: "#6B3FA0" },
    { t: "Middle Brook", n: mbkRows.length, sub: gsub(mbkRows), c: "#B8892A" },
    { t: "Commuters", n: commuterRows.length, sub: gsub(commuterRows), c: "#1F6B42" },
    { t: "Not yet assigned", n: unassignedRows.length, sub: gsub(unassignedRows), c: "#9AAAC6" },
  ].filter((s) => s.n > 0);
  const totalSeg = segs.reduce((a, s) => a + s.n, 0) || 1;

  const hallRow = (label: string, codes: string[], cls: string, rem: number) => {
    const cap = sumHalls(codes, capFn);
    const now = sumHalls(codes, occFn);
    const pOcc = Math.max(0, now - rem);
    const fill = cap ? (now / cap) * 100 : 0;
    return (
      <tr key={label}>
        <td className={cls}>{label}</td>
        <td>{cap}</td>
        <td className={cls}>{now}</td>
        <td>{pct(fill)}</td>
        <td>{pOcc}</td>
        <td>{pill(Math.max(0, cap - now))}</td>
        <td>{pill(Math.max(0, cap - pOcc))}</td>
      </tr>
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.sectitle}>
        Fall 2026 · Housing Overview<span className={styles.rule} />
        <span>{cachedAt ? `as of ${cachedAt}` : "All current assignments"}</span>
      </div>

      <div className={styles.pcards}>
        <div className={styles.pcard}>
          <div className={styles.lab}>Domestic Capacity</div>
          <div className={`${styles.big} ${styles.gold}`}>{capT.toLocaleString()}</div>
          <div className={styles.split}>
            <div><div className={styles.k}>Women</div><div className={`${styles.v} ${styles.cw}`}>{capW}</div></div>
            <div><div className={styles.k}>Men</div><div className={`${styles.v} ${styles.cm}`}>{capM}</div></div>
          </div>
          <div className={styles.cnote}><span>Overseas (not for placement)</span><span>Ireland {ireland} · Rome {rome}</span></div>
        </div>
        <div className={styles.pcard}>
          <div className={styles.lab}>Current Fill</div>
          <div className={`${styles.big} ${styles.warn}`}>{pct(fT)}</div>
          <div className={styles.bar}><i className={styles.barWarn} style={{ width: `${Math.min(100, fT)}%` }} /></div>
          <div className={styles.split}>
            <div><div className={styles.k}>Women</div><div className={`${styles.v} ${styles.cw}`}>{pct(fW)}</div></div>
            <div><div className={styles.k}>Men</div><div className={`${styles.v} ${styles.cm}`}>{pct(fM)}</div></div>
          </div>
        </div>
        <div className={styles.pcard}>
          <div className={styles.lab}>Predicted Fill · after remaining melt</div>
          <div className={`${styles.big} ${styles.warn}`}>{pct(pT)}</div>
          <div className={styles.bar}><i className={styles.barWarn} style={{ width: `${Math.min(100, pT)}%` }} /></div>
          <div className={styles.split}>
            <div><div className={styles.k}>Women</div><div className={`${styles.v} ${styles.cw}`}>{pct(pW)}</div></div>
            <div><div className={styles.k}>Men</div><div className={`${styles.v} ${styles.cm}`}>{pct(pM)}</div></div>
          </div>
          {withdrawn?.withdrawn_total != null && (
            <div className={styles.cnote}>
              <span>{withdrawn.withdrawn_total} withdrawn so far</span>
              <span>~{Math.max(0, Math.round((MELT.all / 100) * (withdrawn.deposit_total || 0)) - withdrawn.withdrawn_total)} more expected</span>
            </div>
          )}
        </div>
        <div className={styles.pcard}>
          <div className={styles.lab}>Melt Rate — FA25 Final</div>
          <div className={`${styles.big} ${styles.crit}`}>{pct(MELT.all)}</div>
          <div className={styles.bar}><i className={styles.barCrit} style={{ width: `${MELT.all}%` }} /></div>
          <div className={styles.split}>
            <div><div className={styles.k}>FA25 W</div><div className={`${styles.v} ${styles.cw}`}>{pct(MELT.w)}</div></div>
            <div><div className={styles.k}>FA25 M</div><div className={`${styles.v} ${styles.cm}`}>{pct(MELT.m)}</div></div>
          </div>
        </div>
        <div className={styles.pcard}>
          <div className={styles.lab}>Retention · S25 → FA25</div>
          <div className={`${styles.big} ${styles.good}`}>{pct(RET.all)}</div>
          <div className={styles.bar}><i className={styles.barGood} style={{ width: `${RET.all}%` }} /></div>
          <div className={styles.split}>
            <div><div className={styles.k}>Women</div><div className={`${styles.v} ${styles.cw}`}>{pct(RET.w)}</div></div>
            <div><div className={styles.k}>Men</div><div className={`${styles.v} ${styles.cm}`}>{pct(RET.m)}</div></div>
          </div>
        </div>
        <div className={styles.pcard}>
          <div className={styles.lab}>Study Abroad · eRez</div>
          <div className={`${styles.big} ${styles.good}`}>{(ireland + rome).toLocaleString()}</div>
          <div className={styles.split}>
            <div><div className={styles.k}>Ireland</div><div className={styles.v}>{ireland}</div></div>
            <div><div className={styles.k}>Rome</div><div className={styles.v}>{rome}</div></div>
          </div>
          <div className={styles.cnote}>
            <span>CIARA {cia} · MALAC {mal}</span>
            <span>{studyAbroad?.cached_at || cachedAt || ""}</span>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.ph}>
          <span className={styles.pt}>All Students</span>
          <span className={styles.pb}>{totalSeg.toLocaleString()} students</span>
        </div>
        <div className={styles.segbar}>
          {segs.map((s) => (
            <span key={s.t} style={{ width: `${(s.n / totalSeg) * 100}%`, background: s.c }} title={`${s.t}: ${s.n}`} />
          ))}
        </div>
        <div className={styles.seglegend}>
          {segs.map((s) => (
            <div key={s.t} className={styles.li}>
              <span className={styles.sw} style={{ background: s.c }} />
              <div>
                <div className={styles.segN}>{s.n.toLocaleString()}</div>
                <div className={styles.segT}>{s.t}</div>
                <div className={styles.vpc}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${styles.ovgrid} ${styles.two}`}>
        <div className={styles.panel} style={{ marginTop: 0 }}>
          <div className={styles.ph}>
            <span className={styles.pt}>Hall Occupancy</span>
            <span className={styles.pb}>Capacity · In Halls Now · Predicted · Beds Open</span>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th /><th>Capacity</th><th>In Halls</th><th>Fill %</th><th>Predicted</th><th>Open Now</th><th>Open Pred.</th>
              </tr>
            </thead>
            <tbody>
              {hallRow("Women", WOMEN_HALLS, styles.cw, remW)}
              {hallRow("Men", MEN_HALLS, styles.cm, remM)}
              <tr className={styles.tot}>
                <td>Total</td>
                <td>{capT}</td>
                <td>{occT}</td>
                <td>{pct(fT)}</td>
                <td>{pOccT}</td>
                <td>{Math.max(0, capT - occT)}</td>
                <td>{Math.max(0, capT - pOccT)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={`${styles.panel} ${styles.cbox}`} style={{ marginTop: 0 }}>
          <div className={styles.ph}><span className={styles.pt}>Possible Commuters</span></div>
          <div className={styles.pb} style={{ marginBottom: 8 }}>Incoming freshmen from Collier / Lee County · no housing assignment yet</div>
          <div className={styles.crow}><span className={styles.cw}>Women</span><b className={styles.cw}>{comW}</b></div>
          <div className={styles.crow}><span className={styles.cm}>Men</span><b className={styles.cm}>{comM}</b></div>
          <div className={styles.ctot}><b>{com.length}</b><span>potential commuters</span></div>
        </div>
      </div>

      <div className={`${styles.ovgrid} ${styles.even}`}>
        <div className={styles.panel} style={{ marginTop: 0 }}>
          <div className={styles.ph}>
            <span className={styles.pt}>Incoming Freshmen</span>
            <span className={styles.pb}>eRez assignments in halls · Goal · vs Goal · Predicted</span>
          </div>
          <table className={styles.table}>
            <thead><tr><th /><th>In Halls</th><th>Goal</th><th>vs Goal</th><th>Predicted</th></tr></thead>
            <tbody>
              <tr><td className={styles.cw}>Women</td><td className={styles.cw}>{incW}</td><td>{GOAL.w}</td><td>{delta(incW - GOAL.w)}</td><td>{pIncW}</td></tr>
              <tr><td className={styles.cm}>Men</td><td className={styles.cm}>{incM}</td><td>{GOAL.m}</td><td>{delta(incM - GOAL.m)}</td><td>{pIncM}</td></tr>
              <tr className={styles.tot}><td>Total</td><td>{incW + incM}</td><td>{GOAL.w + GOAL.m}</td><td>{delta(incW + incM - (GOAL.w + GOAL.m))}</td><td>{pIncW + pIncM}</td></tr>
            </tbody>
          </table>
        </div>
        <div className={styles.panel} style={{ marginTop: 0 }}>
          <div className={styles.ph}>
            <span className={styles.pt}>Returner Status</span>
            <span className={styles.pb}>Eligible · In Halls · Abroad · Retention → Expected</span>
          </div>
          <table className={styles.table}>
            <thead><tr><th /><th>Eligible</th><th>In Halls</th><th>Abroad</th><th>Retention</th><th>Expected Return</th></tr></thead>
            <tbody>
              <tr><td className={styles.cw}>Women</td><td>{ELIG.w}</td><td className={styles.cw}>{retW}</td><td>{abrW}</td><td>{pct(RET.w)}</td><td>{projW}</td></tr>
              <tr><td className={styles.cm}>Men</td><td>{ELIG.m}</td><td className={styles.cm}>{retM}</td><td>{abrM}</td><td>{pct(RET.m)}</td><td>{projM}</td></tr>
              <tr className={styles.tot}><td>Total</td><td>{ELIG.w + ELIG.m}</td><td>{retW + retM}</td><td>{abrW + abrM}</td><td>{pct(RET.all)}</td><td>{projW + projM}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.srcnote}>
        <b>Occupancy is an eRezLife assignment pull</b> — sessions 2026FALL01 (domestic) and 2026FALL03Ireland.
        Halls are the six residence buildings; Ireland is CIARA/MALAC; Rome is eRez price type RSTA
        (resident study abroad, no hall code); commuters are NODM. Incoming/returner splits are those
        same eRez rows, classified after the pull.{" "}
        <b>Not eRez</b> — eligible returners (W {ELIG.w} · M {ELIG.m}), S25→FA25 retention, melt rate,
        and incoming goals are planning constants. Predicted fill applies only remaining expected melt.
        {withdrawn?.excluded_from_feed ? ` ${withdrawn.excluded_from_feed} withdrawn deposits were removed from the feed.` : ""}
      </div>
    </div>
  );
}
