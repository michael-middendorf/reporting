"use client";

import type { CapacityTermId } from "@/lib/reports/housing/capacity-terms";
import { pct } from "@/lib/reports/housing/model";
import {
  JOSEPH_PRIEST_EXCLUDED_BEDS,
  JOSEPH_PRIEST_HOLD_BEDS,
} from "@/lib/reports/housing/priest-rooms";
import {
  FA_TO_SP_ATTRITION,
  SP_TO_FA_ATTRITION,
  projectSpring,
  ratePct,
  sexTotal,
  type SexCounts,
  type SpringProjection,
} from "@/lib/reports/housing/spring-projection";
import type { Resident } from "@/lib/reports/housing/types";
import styles from "./housing.module.css";

function n(v: number) {
  return v.toLocaleString();
}

function signed(v: number) {
  return v > 0 ? `+${n(v)}` : n(v);
}

function taken(v: number) {
  return v ? `-${n(v)}` : "0";
}

export function PriestRoomsNote() {
  return (
    <div className={styles.panel}>
      <div className={styles.ph}>
        <span className={styles.pt}>St. Joseph priest rooms</span>
        <span className={styles.pb}>Jeff Stankovsky · 7 Sep 2026</span>
      </div>
      <p className={styles.pending}>
        311A/B, 313A/B, 314A/B, and 315A/B are priest doubles. Those {JOSEPH_PRIEST_EXCLUDED_BEDS} beds
        are already out of the 1,203. 307A/B and 308A/B are this-year priest holds and are still counted
        as student doubles ({JOSEPH_PRIEST_HOLD_BEDS} beds inside the 1,203). 215A/B are emergency holds,
        not priest rooms.
      </p>
    </div>
  );
}

function Head({ showO }: { showO: boolean }) {
  return (
    <tr>
      <th />
      <th>Women</th>
      <th>Men</th>
      {showO ? <th>Other</th> : null}
      <th>Total</th>
    </tr>
  );
}

function Cells({ row, showO, minus }: { row: SexCounts; showO: boolean; minus?: boolean }) {
  const cell = (v: number) => (minus ? taken(v) : n(v));
  return (
    <>
      <td className={styles.cw}>{cell(row.w)}</td>
      <td className={styles.cm}>{cell(row.m)}</td>
      {showO ? <td>{cell(row.o)}</td> : null}
      <td>{cell(sexTotal(row))}</td>
    </>
  );
}

function RateLine({ label, rate, pctLabel }: { label: string; rate: string; pctLabel: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{rate}</td>
      <td>{pctLabel}</td>
    </tr>
  );
}

export function CapacityProjection({
  termId,
  residents,
  cachedAt,
}: {
  termId: CapacityTermId;
  residents: Resident[];
  cachedAt?: string;
}) {
  const proj = projectSpring(residents);
  const showO = [
    proj.halls,
    proj.ireland,
    proj.rome,
    proj.pool,
    proj.seniors,
    proj.decemberSubtracted,
    proj.attritionLeaves,
    proj.spring,
    proj.fallLeavers,
    proj.fallReturners,
  ].some((row) => row.o > 0);
  const abroad = sexTotal(proj.ireland) + sexTotal(proj.rome);
  const leaving = sexTotal(proj.decemberSubtracted) + sexTotal(proj.attritionLeaves);
  const net = sexTotal(proj.spring) - sexTotal(proj.halls);
  const springLead = termId === "sp27";

  return (
    <div className={styles.wrap}>
      <div className={styles.sectitle}>
        {springLead ? "Spring 2027 · projected hall demand" : "Fall 2027 · expected returners"}
        <span className={styles.rule} />
        <span>{cachedAt ? `from the Fall 2026 pull as of ${cachedAt}` : "from the Fall 2026 pull"}</span>
      </div>

      <div className={styles.pcards}>
        {springLead ? (
          <>
            <Card label="Projected spring beds" value={sexTotal(proj.spring)} tone={styles.good} />
            <Card label="In halls now" value={sexTotal(proj.halls)} />
            <Card label="Ireland and Rome" value={abroad} tone={styles.gold} />
            <Card label="Net vs halls now" value={signed(net)} tone={net < 0 ? styles.crit : styles.good} />
          </>
        ) : (
          <>
            <Card label="Expected returners" value={sexTotal(proj.fallReturners)} tone={styles.good} />
            <Card label="Projected spring beds" value={sexTotal(proj.spring)} />
            <Card label="Spring-to-fall attrition" value={pct(SP_TO_FA_ATTRITION.all)} tone={styles.crit} />
          </>
        )}
      </div>

      <p className={styles.lead}>
        Ireland and Rome add {n(abroad)} people back into the residence halls. December graduates and the
        rest of the fall-to-spring attrition remove {n(leaving)}. Net change from the current hall count
        is {signed(net)}.
      </p>

      {springLead ? <SpringTable proj={proj} showO={showO} /> : <FallTable proj={proj} showO={showO} />}

      <div className={`${styles.ovgrid} ${styles.even}`}>
        <Graduates proj={proj} showO={showO} />
        <Attrition />
      </div>

      {springLead ? <FallTable proj={proj} showO={showO} /> : <SpringTable proj={proj} showO={showO} />}

      <Aside proj={proj} />

      <div className={styles.srcnote}>
        <b>This is a projection from the Fall 2026 assignment pull.</b> It is not an eRez Spring 2027
        or Fall 2027 session. The publisher still requests only 2026FALL01 and 2026FALL03Ireland.
        Ireland is CIARA/MALAC and Rome is price type RSTA. Both are added back into domestic halls.
        Middle Brook and commuters stay out. December graduates are the December 2025 undergraduate
        conferrals (14 women, 20 men), capped by seniors in this pool. The fall-to-spring rate is the
        FA25 undergraduate class against Spring 2026 after those conferrals, with leave of absence
        counted as not retained. Spring-to-fall attrition is the complement of the S25→FA25 retention
        on the Fall 2026 sheet. Fall 2027 here is returners only. Incoming class, melt, and a fill
        percent are not on file.
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={styles.pcard}>
      <div className={styles.lab}>{label}</div>
      <div className={`${styles.big} ${tone || ""}`}>{typeof value === "number" ? n(value) : value}</div>
    </div>
  );
}

function SpringTable({ proj, showO }: { proj: SpringProjection; showO: boolean }) {
  return (
    <div className={styles.panel}>
      <div className={styles.ph}>
        <span className={styles.pt}>Spring 2027</span>
        <span className={styles.pb}>Halls now · abroad returns · graduates · attrition</span>
      </div>
      <table className={styles.table}>
        <thead><Head showO={showO} /></thead>
        <tbody>
          <tr><td>In residence halls</td><Cells row={proj.halls} showO={showO} /></tr>
          <tr><td>Ireland coming back</td><Cells row={proj.ireland} showO={showO} /></tr>
          <tr><td>Rome coming back</td><Cells row={proj.rome} showO={showO} /></tr>
          <tr className={styles.tot}><td>Spring pool</td><Cells row={proj.pool} showO={showO} /></tr>
          <tr><td>December graduates</td><Cells row={proj.decemberSubtracted} showO={showO} minus /></tr>
          <tr><td>Other fall-to-spring attrition</td><Cells row={proj.attritionLeaves} showO={showO} minus /></tr>
          <tr className={styles.tot}><td>Projected spring beds</td><Cells row={proj.spring} showO={showO} /></tr>
        </tbody>
      </table>
    </div>
  );
}

function FallTable({ proj, showO }: { proj: SpringProjection; showO: boolean }) {
  return (
    <div className={styles.panel}>
      <div className={styles.ph}>
        <span className={styles.pt}>Fall 2027 returners</span>
        <span className={styles.pb}>Spring projection after S25→FA25 attrition · no incoming class</span>
      </div>
      <table className={styles.table}>
        <thead><Head showO={showO} /></thead>
        <tbody>
          <tr><td>Projected spring beds</td><Cells row={proj.spring} showO={showO} /></tr>
          <tr><td>Spring-to-fall attrition</td><Cells row={proj.fallLeavers} showO={showO} minus /></tr>
          <tr className={styles.tot}><td>Expected returners</td><Cells row={proj.fallReturners} showO={showO} /></tr>
        </tbody>
      </table>
    </div>
  );
}

function Graduates({ proj, showO }: { proj: SpringProjection; showO: boolean }) {
  const capped =
    proj.decemberSubtracted.w < proj.decemberPlanning.w ||
    proj.decemberSubtracted.m < proj.decemberPlanning.m;
  return (
    <div className={styles.panel} style={{ marginTop: 0 }}>
      <div className={styles.ph}>
        <span className={styles.pt}>Possible graduates</span>
        <span className={styles.pb}>Seniors in the spring pool · December planning count</span>
      </div>
      <table className={styles.table}>
        <thead><Head showO={showO} /></thead>
        <tbody>
          <tr><td>Seniors now</td><Cells row={proj.seniors} showO={showO} /></tr>
          <tr><td>December 2025 conferrals</td><Cells row={proj.decemberPlanning} showO={showO} /></tr>
          <tr className={styles.tot}><td>Subtracted for spring</td><Cells row={proj.decemberSubtracted} showO={showO} /></tr>
        </tbody>
      </table>
      <p className={styles.pending}>
        Last December, {proj.decemberPlanning.w} undergraduate women and {proj.decemberPlanning.m} undergraduate
        men conferred. Most seniors finish in May and stay housed through spring, so the projection subtracts
        that December count{capped ? ", and never more seniors than are in this pool" : ""}.
        {sexTotal(proj.seniorsElsewhere)
          ? ` ${n(sexTotal(proj.seniorsElsewhere))} more seniors are in Middle Brook, commuter, or unassigned rows and are not in this bed count.`
          : ""}
      </p>
    </div>
  );
}

function Attrition() {
  return (
    <div className={styles.panel} style={{ marginTop: 0 }}>
      <div className={styles.ph}>
        <span className={styles.pt}>Attrition</span>
        <span className={styles.pb}>Fall to spring · spring to fall</span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr><th /><th>Count</th><th>Rate</th></tr>
        </thead>
        <tbody>
          <RateLine
            label="Women, fall to spring"
            rate={`${FA_TO_SP_ATTRITION.w.left} / ${FA_TO_SP_ATTRITION.w.base}`}
            pctLabel={pct(ratePct(FA_TO_SP_ATTRITION.w))}
          />
          <RateLine
            label="Men, fall to spring"
            rate={`${FA_TO_SP_ATTRITION.m.left} / ${FA_TO_SP_ATTRITION.m.base}`}
            pctLabel={pct(ratePct(FA_TO_SP_ATTRITION.m))}
          />
          <RateLine
            label="All, fall to spring"
            rate={`${FA_TO_SP_ATTRITION.all.left} / ${FA_TO_SP_ATTRITION.all.base}`}
            pctLabel={pct(ratePct(FA_TO_SP_ATTRITION.all))}
          />
          <RateLine label="Women, spring to fall" rate="S25→FA25" pctLabel={pct(SP_TO_FA_ATTRITION.w)} />
          <RateLine label="Men, spring to fall" rate="S25→FA25" pctLabel={pct(SP_TO_FA_ATTRITION.m)} />
          <RateLine label="All, spring to fall" rate="S25→FA25" pctLabel={pct(SP_TO_FA_ATTRITION.all)} />
        </tbody>
      </table>
    </div>
  );
}

function Aside({ proj }: { proj: SpringProjection }) {
  const bits = [
    sexTotal(proj.mbk) ? `${n(sexTotal(proj.mbk))} Middle Brook` : "",
    sexTotal(proj.commuter) ? `${n(sexTotal(proj.commuter))} commuters` : "",
    sexTotal(proj.unassigned) ? `${n(sexTotal(proj.unassigned))} not yet assigned` : "",
  ].filter(Boolean);
  const nonUg = sexTotal(proj.nonUg);
  if (!bits.length && !nonUg) return null;
  return (
    <p className={styles.lead}>
      {bits.length ? `${bits.join(", ")} stay out of the hall projection.` : ""}
      {nonUg
        ? ` ${n(nonUg)} graduate or non-degree students in the spring pool stay in the spring count. The attrition rate is the undergraduate rate.`
        : ""}
    </p>
  );
}
