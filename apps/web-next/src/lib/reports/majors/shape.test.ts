import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PCID_PATTERN,
  WAITING_MESSAGE,
  buildMajorsPayload,
  missingInputs,
  type MajorsReady,
  type MajorsSources,
} from "./shape";
import { FIXTURE_NOW, fixtureSources } from "./test-fixtures";

function omit(row: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
}

function ready(src: MajorsSources = fixtureSources(), params = {}): MajorsReady {
  const p = buildMajorsPayload(src, params, FIXTURE_NOW);
  assert.equal(p.status, "ready", JSON.stringify(p));
  return p as MajorsReady;
}

describe("majors incoming (Accepted Applicants by Major)", () => {
  it("defaults to the latest year with rows and lists the years", () => {
    const p = ready();
    assert.equal(p.incoming.year, "2027");
    assert.deepEqual(p.incoming.years, ["2027", "2026"]);
    assert.equal(p.incoming.priorYear, "2026");
  });

  it("counts FTCA vs TRAN/SECB, WDEP as an accept but not a deposit, and APP_STATUS DEP deposits", () => {
    const theo = ready().incoming.rows.find((r) => r.curriculum === "THEO")!;
    assert.equal(theo.major, "Theology");
    assert.equal(theo.degreeLabel, "B.A.");
    // FTCA: WDEP (accept only) + padded ACCP/DEP row.
    assert.equal(theo.ftcaAccepts, 2);
    assert.equal(theo.ftcaDeposits, 1);
    // TRAN + SECB both count as transfers.
    assert.equal(theo.tranAccepts, 2);
    assert.equal(theo.tranDeposits, 2);
    assert.equal(theo.totalAccepts, 4);
    assert.equal(theo.totalDeposits, 3);
  });

  it("keeps Mechanical Engineering B.S. and B.A. as separate labeled rows, with the primary curriculum override", () => {
    const rows = ready().incoming.rows.filter((r) => r.curriculum === "MECH");
    assert.deepEqual(
      rows.map((r) => [r.major, r.degreeLabel, r.totalAccepts, r.totalDeposits]),
      [
        ["Mechanical Engineering", "B.S.", 2, 2],
        ["Mechanical Engineering", "B.A.", 1, 0],
      ],
    );
    // The applicant who applied BIOL but whose primary row says MECH is counted as MECH,
    // and BIOL has no B.S. row (the other BIOL rows are filtered by ORG, NONDEG, or decision).
    assert.equal(ready().incoming.rows.some((r) => r.curriculum === "BIOL" && r.degree === "BSCIEN"), false);
  });

  it("fans out one view row per primary curriculum, keeping the application's degree and attend", () => {
    // Person 16 applied THEO/BARTS as a transfer with primaries BIOL (NONDEG), MUSIC (BARTS),
    // and ZZZZ (not in CODE_CURRICULUM). Legacy emits (BIOL, BARTS) and (MUSIC, BARTS).
    const rows = ready().incoming.rows;
    for (const curriculum of ["BIOL", "MUSIC"]) {
      const r = rows.find((x) => x.curriculum === curriculum)!;
      assert.ok(r, curriculum);
      assert.equal(r.degree, "BARTS", curriculum);
      assert.equal(r.tranAccepts, 1, curriculum);
      assert.equal(r.tranDeposits, 1, curriculum);
      assert.equal(r.ftcaAccepts, 0, curriculum);
    }
    assert.equal(rows.some((x) => x.curriculum === "ZZZZ"), false);
    // The applied curriculum is not used when primaries exist: THEO keeps its 4 from other people.
    assert.equal(rows.find((x) => x.curriculum === "THEO")!.totalAccepts, 4);
  });

  it("filters ORG_CODE_ID, NONDEG, non-accepts, unknown decisions, other terms, and readmits", () => {
    const p = ready();
    // 7 single-row applicants plus person 16's two fanned-out rows.
    assert.equal(p.incoming.totals.totalAccepts, 9);
    assert.equal(p.incoming.totals.totalDeposits, 7);
    assert.equal(p.incoming.totals.tranAccepts, 4);
    // FTCA: MECH B.S. 2 + MECH B.A. 1 + THEO 2.
    assert.equal(p.incoming.totals.ftcaAccepts, 5);
  });

  it("sorts by total accepts and computes % of the grand total", () => {
    const p = ready();
    assert.deepEqual(
      p.incoming.rows.map((r) => `${r.curriculum}/${r.degree}`),
      ["THEO/BARTS", "MECH/BSCIEN", "BIOL/BARTS", "MECH/BARTS", "MUSIC/BARTS"],
    );
    assert.equal(p.incoming.rows[0]!.acceptsPct, 4 / 9);
    assert.equal(p.incoming.rows[0]!.depositsPct, 3 / 7);
    assert.equal(p.incoming.totals.acceptsPct, 1);
  });

  it("adds the prior-year final for the same major and degree", () => {
    const p = ready();
    const mechBs = p.incoming.rows.find((r) => r.curriculum === "MECH" && r.degree === "BSCIEN")!;
    assert.equal(mechBs.priorAccepts, 1);
    assert.equal(mechBs.priorDeposits, 1);
    const theo = p.incoming.rows.find((r) => r.curriculum === "THEO")!;
    assert.equal(theo.priorAccepts, 0);
    // The prior total covers every major that year (BIOL transfer included).
    assert.equal(p.incoming.totals.priorAccepts, 2);
    assert.equal(p.incoming.totals.priorDeposits, 1);
  });

  it("honors a requested year and has no prior year when Y-1 is absent", () => {
    const p = ready(fixtureSources(), { incomingYear: "2026" });
    assert.equal(p.incoming.year, "2026");
    assert.equal(p.incoming.totals.totalAccepts, 2);
    assert.equal(p.incoming.totals.priorAccepts, null);
    assert.equal(p.incoming.rows[0]!.priorAccepts, null);
    // Unknown year falls back to the default.
    assert.equal(ready(fixtureSources(), { incomingYear: "1999" }).incoming.year, "2027");
  });
});

describe("majors current (Majors and Minors)", () => {
  it("defaults to the current term from academic_calendar, not a future term in the data", () => {
    const p = ready();
    assert.equal(p.current.year, "2026");
    assert.equal(p.current.term, "FALL");
    assert.equal(p.current.label, "Fall 2026");
    assert.deepEqual(
      p.current.terms.map((t) => t.label),
      ["Spring 2027", "Fall 2026", "Spring 2026", "Fall 2025", "Fall 2021"],
    );
  });

  it("falls back to the newest term in the data without calendar dates", () => {
    const p = ready({ ...fixtureSources(), academicCalendar: null });
    assert.equal(p.current.label, "Spring 2027");
  });

  it("builds majors without Undeclared, with RANK ties, separation, and dedup", () => {
    const t = ready().current.majors;
    assert.deepEqual(
      t.rows.map((r) => [r.label, r.fres, r.soph, r.jr, r.sr, r.total, r.rank]),
      [
        // 107's two k=null rows both survive (SR 2); 108's k=null row beats its k=1 row (JR 1);
        // 106 is separated (WITH requires a separation date); 110 has no class level.
        ["Biology", 0, 0, 1, 2, 3, 1],
        // 102, 104 (accepted + deposited), 105 once (primary beats application row).
        ["Theology", 2, 0, 1, 0, 3, 1],
        ["Mechanical Engineering", 0, 1, 0, 0, 1, 3],
      ],
    );
    assert.equal(t.totals.total, 7);
    assert.equal(t.rows[0]!.pct, 3 / 7);
    assert.equal(t.totals.pct, 1);
  });

  it("includes Undeclared in the second majors table", () => {
    const t = ready().current.majorsWithUndeclared;
    const undeclared = t.rows.find((r) => r.label === "Undeclared")!;
    assert.equal(undeclared.fres, 1);
    assert.equal(undeclared.rank, 3);
    assert.equal(t.rows.find((r) => r.label === "Mechanical Engineering")!.rank, 3);
    assert.equal(t.totals.total, 8);
  });

  it("lists minors from DEGREE = MINOR only", () => {
    const t = ready().current.minors;
    assert.deepEqual(
      t.rows.map((r) => [r.label, r.fres, r.total, r.rank]),
      [["Music", 1, 1, 1]],
    );
  });

  it("honors a requested term", () => {
    const p = ready(fixtureSources(), { year: "2026", term: "spring" });
    assert.equal(p.current.label, "Spring 2026");
    assert.deepEqual(
      p.current.majors.rows.map((r) => [r.label, r.fres, r.total]),
      [["Mechanical Engineering", 1, 1]],
    );
  });
});

describe("majors trends", () => {
  it("shows the last started falls with change vs prior and vs five years earlier", () => {
    const t = ready().trends.majorsWithUndeclared;
    assert.deepEqual(t.years, ["2021", "2025", "2026"]);
    assert.equal(t.compareYear, "2021");
    const mech = t.rows.find((r) => r.label === "Mechanical Engineering")!;
    assert.deepEqual(mech.counts, [0, 1, 1]);
    assert.equal(mech.changePrior, 0);
    assert.equal(mech.change5, 1);
    const theo = t.rows.find((r) => r.label === "Theology")!;
    assert.deepEqual(theo.counts, [1, 0, 3]);
    assert.equal(theo.changePrior, 3);
    assert.equal(theo.change5, 2);
    assert.deepEqual(t.totals.counts, [1, 1, 8]);
  });

  it("trends minors and incoming accepts and deposits per major", () => {
    const p = ready();
    assert.deepEqual(p.trends.minors.rows.map((r) => [r.label, r.counts]), [["Music", [0, 0, 1]]]);
    const inc = p.trends.incoming;
    assert.deepEqual(inc.years, ["2026", "2027"]);
    assert.deepEqual(inc.inProgress, ["2027"]);
    const mech = inc.rows.find((r) => r.label === "Mechanical Engineering")!;
    assert.deepEqual(mech.accepts, [1, 3]);
    assert.deepEqual(mech.deposits, [1, 2]);
    assert.equal(mech.acceptsChangePrior, 2);
    assert.deepEqual(inc.totals.accepts, [2, 9]);
    assert.deepEqual(inc.totals.deposits, [1, 7]);
  });
});

describe("majors waiting state", () => {
  it("waits when the new ACADEMIC columns are not published yet", () => {
    const src = fixtureSources();
    src.academic = src.academic!.map((r) => omit(r, "APP_STATUS", "ORG_CODE_ID"));
    const p = buildMajorsPayload(src, {}, FIXTURE_NOW);
    assert.equal(p.status, "waiting");
    if (p.status !== "waiting") return;
    assert.equal(p.message, WAITING_MESSAGE);
    assert.deepEqual(p.missing, ["ACADEMIC.APP_STATUS", "ACADEMIC.ORG_CODE_ID"]);
    assert.equal("incoming" in p, false);
  });

  it("waits for code_enrollment and the new code columns", () => {
    const src = fixtureSources();
    src.codeEnrollment = null;
    src.codeDegree = src.codeDegree!.map((r) => omit(r, "DEGREE_TYPE"));
    src.codeAppDecision = src.codeAppDecision!.map((r) => omit(r, "ACCEPTED_DECISION"));
    assert.deepEqual(missingInputs(src), [
      "CODE_DEGREE.DEGREE_TYPE",
      "CODE_APPDECISION.ACCEPTED_DECISION",
      "CODE_ENROLLMENT",
    ]);
  });
});

describe("majors payload has no PII", () => {
  it("never returns PEOPLE_CODE_ID, PEOPLE_ID, or a PCID-shaped string", () => {
    for (const params of [{}, { incomingYear: "2026", year: "2026", term: "SPRING" }]) {
      const json = JSON.stringify(buildMajorsPayload(fixtureSources(), params, FIXTURE_NOW));
      assert.equal(json.includes("PEOPLE_CODE_ID"), false);
      assert.equal(json.includes("PEOPLE_ID"), false);
      assert.equal(json.includes("person"), false);
      assert.doesNotMatch(json, PCID_PATTERN);
      assert.doesNotMatch(json, /"P\d+"/);
      // Raw person ids from the fixtures (000000101 etc.) never appear either.
      assert.doesNotMatch(json, /0000001\d\d/);
    }
  });
});
