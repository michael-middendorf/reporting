import assert from "node:assert/strict";
import { test } from "node:test";
import type { CensusRawStudent } from "./lists";
import { censusAppDecision, footballRosterPcids, withoutFootballRoster } from "./lists-core";
import {
  applyLiveRetentionHistory,
  buildAllUgSplit,
  buildCrosstab,
  buildAdmitOverrideRetention,
  buildAssociationRetention,
  buildFtcaAttritionFromPrior,
  buildFtcaExtras,
  buildSportRetention,
  catholicOf,
  deriveFtcaRaw,
  hsGpaBucket,
  hsGpaFineBucket,
  satToAct,
  actConverted,
  actConvertedBucket,
  hasTestScore,
  isCatholic,
  isFtcaIncoming,
  retentionPct,
  withLiveCurrentYearRate,
} from "./retention";

function prior(partial: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "P1",
    first: "A",
    last: "B",
    incomingReturning: "Incoming",
    state: "FL",
    religion: "Catholic",
    cathGroup: "Catholic",
    ethnicity: "WHITE",
    gender: "Male",
    program: "UNDERG",
    collegeAttend: "FTCA",
    curriculum: "BIOLOG",
    curriculumName: "Biology",
    classLevel: "Freshman",
    fullPart: "FULL",
    city: "",
    credits: 15,
    gpa: 3.1,
    earnedCredits: 0,
    residency: "Resident",
    sport: "Football",
    athlete: "Athlete",
    athleticType: "Varsity",
    rosterStatus: "Roster - Athlete",
    honors: "",
    fsp: "",
    household: "",
    institute: "",
    marines: "",
    appDecision: "",
    session: "01",
    degree: "BARTS",
    email: "",
    citizenship: "",
    visa: "",
    ...partial,
  };
}

test("historical F25-F26 is the live enrolled/cohort rate, not a frozen snapshot", () => {
  const ftca = buildFtcaAttritionFromPrior(
    [prior({ pcid: "P1" }), prior({ pcid: "P2" }), prior({ pcid: "P3" })],
    ["P1", "P2"],
    [],
  );
  assert.equal(ftca.cohort, 3);
  assert.equal(ftca.enrolledThisFall, 2);
  assert.equal(ftca.retentionRate, 2 / 3);
  const data = applyLiveRetentionHistory(
    {
      historical: { years: [2026] },
      historicalFtcaRetention: [
        { label: "F24–F25", rate: 0.849 },
        { label: "F25–F26", rate: 0.8291 },
      ],
      historicalAllUgRetention: [{ label: "F25–F26", rate: 0.99 }],
    },
    ftca.retentionRate,
    0.75,
  );
  assert.equal(data.historicalFtcaRetention.find((r) => r.label === "F24–F25")?.rate, 0.849);
  assert.equal(data.historicalFtcaRetention.find((r) => r.label === "F25–F26")?.rate, 2 / 3);
  assert.equal(data.historicalAllUgRetention.find((r) => r.label === "F25–F26")?.rate, 0.75);
});

test("withLiveCurrentYearRate matches hyphen or en-dash current-year labels", () => {
  const out = withLiveCurrentYearRate([{ label: "F25-F26", rate: 0.5 }], 2026, 322 / 392);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "F25–F26");
  assert.equal(out[0].rate, 322 / 392);
});

test("Non-Catholic is not counted as Catholic", () => {
  assert.equal(isCatholic({ religion: "Catholic" }), true);
  assert.equal(isCatholic({ religion: "Eastern Rite Catholic" }), true);
  assert.equal(isCatholic({ religion: "Christian" }), false);
  assert.equal(isCatholic({ religion: "Other" }), false);
  assert.equal(isCatholic({ cathGroup: "Non-Catholic", religion: "" }), false);
  assert.equal(isCatholic({ cathGroup: "Catholic", religion: "" }), true);
  assert.equal(catholicOf({ cathGroup: "Non-Catholic" }), "Non-Catholic");
  assert.equal(catholicOf({ religion: "Eastern Rite Catholic" }), "Catholic");
});

test("FTCA raw marks left students Not Retained using the FA25 sport", () => {
  const rows = deriveFtcaRaw(
    [prior({ pcid: "P1", sport: "Football" }), prior({ pcid: "P2", sport: "Volleyball", gender: "Female" })],
    [prior({ pcid: "P2", sport: "Volleyball" })],
    [],
  );
  assert.equal(rows.find((r) => r.pcid === "P1")?.retained, "Not Retained");
  assert.equal(rows.find((r) => r.pcid === "P1")?.fa25Sport, "Football");
  assert.equal(rows.find((r) => r.pcid === "P2")?.retained, "Retained");
});

test("sport retention charges leavers to their Fall 2025 sport", () => {
  const rows = buildSportRetention(
    [
      prior({ pcid: "P1", sport: "Football" }),
      prior({ pcid: "P2", sport: "Football" }),
      prior({ pcid: "P3", sport: "Volleyball" }),
    ],
    ["P2"],
    [{ pcid: "P3", year: 2026, term: "SPRING" }],
  );
  const fb = rows.find((r) => r.sport === "Football");
  assert.equal(fb?.roster, 2);
  assert.equal(fb?.associated, 2);
  assert.equal(fb?.athletes, 2);
  assert.equal(fb?.notRetained, 1);
  assert.equal(fb?.retained, 1);
  const vb = rows.find((r) => r.sport === "Volleyball");
  assert.equal(vb?.graduated, 1);
  assert.equal(vb?.notRetained, 0);
});

test("FTCA raw is Incoming+FTCA from last fall, any class, not spring admits", () => {
  const rows = deriveFtcaRaw(
    [
      prior({ pcid: "P1", incomingReturning: "Incoming", collegeAttend: "FTCA", classLevel: "Freshman" }),
      prior({ pcid: "P2", incomingReturning: "Returning", collegeAttend: "FTCA", classLevel: "Sophomore" }),
      prior({ pcid: "P3", incomingReturning: "Incoming", collegeAttend: "TRAN", classLevel: "Freshman" }),
      prior({ pcid: "P4", incomingReturning: "Returning", collegeAttend: "FTCA", classLevel: "Freshman" }),
      prior({ pcid: "P5", incomingReturning: "Incoming", collegeAttend: "FTCA", classLevel: "Sophomore" }),
      prior({
        pcid: "P6",
        incomingReturning: "Incoming",
        collegeAttend: "FTCA",
        classLevel: "Freshman",
        admitTerm: "2025SPRING01",
      }),
    ],
    [],
    [],
  );
  assert.deepEqual(
    rows.map((r) => r.pcid).sort(),
    ["P1", "P5"],
  );
  assert.equal(isFtcaIncoming(prior({ incomingReturning: "Incoming", collegeAttend: "FTCA", classLevel: "Freshman" })), true);
  assert.equal(isFtcaIncoming(prior({ incomingReturning: "Incoming", collegeAttend: "FTCA", classLevel: "Sophomore" })), true);
  assert.equal(
    isFtcaIncoming(
      prior({ incomingReturning: "Incoming", collegeAttend: "FTCA", classLevel: "Freshman", admitTerm: "2025SPRING01" }),
    ),
    false,
  );
});

test("FTCA state tables list internationals as International, not dash/ON/FC", () => {
  const a = buildFtcaAttritionFromPrior(
    [
      prior({ pcid: "P1", state: "-" }),
      prior({ pcid: "P2", state: "ON" }),
      prior({ pcid: "P3", state: "FC" }),
      prior({ pcid: "P4", state: "UT" }),
      prior({ pcid: "P5", state: "FL" }),
    ],
    ["P1", "P2", "P3", "P4", "P5"],
    [],
  );
  assert.equal(a.byState.some((r) => r.label === "-"), false);
  assert.equal(a.byState.some((r) => r.label === "ON"), false);
  assert.equal(a.byState.some((r) => r.label === "FC"), false);
  assert.equal(a.byState.find((r) => r.label === "International")?.students, 3);
  assert.equal(a.byState.find((r) => r.label === "UT")?.students, 1);
  assert.equal(a.byState.find((r) => r.label === "FL")?.students, 1);
  const rawRows = deriveFtcaRaw(
    [prior({ pcid: "P1", state: "-" }), prior({ pcid: "P4", state: "UT" })],
    [],
    [],
  );
  assert.equal(rawRows.find((r) => r.pcid === "P1")?.state, "International");
  assert.equal(rawRows.find((r) => r.pcid === "P4")?.state, "UT");
});

test("FTCA attrition cohort is Incoming+FTCA", () => {
  const a = buildFtcaAttritionFromPrior(
    [
      prior({ pcid: "P1", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      prior({ pcid: "P2", incomingReturning: "Returning", collegeAttend: "FTCA", classLevel: "Sophomore" }),
      prior({ pcid: "P3", incomingReturning: "Incoming", collegeAttend: "TRAN" }),
    ],
    ["P1"],
    [],
  );
  assert.equal(a.cohort, 1);
  assert.equal(a.enrolledThisFall, 1);
  assert.equal(a.notRetained, 0);
});

test("FA25 FTCA attrition is 391: Incoming+FTCA minus Aiden, not returning FTCA graduates", () => {
  const returningGrads = [
    "P000343255",
    "P000343257",
    "P000343989",
    "P000344149",
    "P000344159",
    "P000345086",
    "P000346438",
  ].map((pcid) =>
    prior({ pcid, incomingReturning: "Returning", collegeAttend: "FTCA", classLevel: "Senior" }),
  );
  const a = buildFtcaAttritionFromPrior(
    [
      prior({ pcid: "P000384377", first: "Aiden", last: "Wilson", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      prior({ pcid: "P000380001", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      ...returningGrads,
    ],
    ["P000380001"],
    returningGrads.map((s) => ({ pcid: s.pcid, year: "2026", term: "SPRING" })),
  );
  assert.equal(a.cohort, 1);
  assert.equal(a.graduated, 0);
  assert.equal(a.enrolledThisFall, 1);
});

test("no-football retention drops last year's football roster, not this year's team", () => {
  const rows = [
    prior({ pcid: "F1", sport: "Football" }),
    prior({ pcid: "F2", sport: "Football" }),
    prior({ pcid: "V1", sport: "Volleyball", gender: "Female" }),
  ];
  const fa25Football = footballRosterPcids(rows);
  assert.equal(fa25Football.size, 2);
  const noFb = withoutFootballRoster(rows, fa25Football);
  assert.deepEqual(
    noFb.map((s) => s.pcid),
    ["V1"],
  );
  const all = buildAllUgSplit(rows, ["F1", "V1"], []);
  const without = buildAllUgSplit(noFb, ["V1"], []);
  assert.equal(all.all.students - without.all.students, 2);
  const sports = buildSportRetention(noFb, ["V1"], [], ["Football"]);
  assert.equal(sports.some((r) => r.sport === "Football"), false);
  assert.equal(sports[0]?.sport, "Volleyball");
});

test("FTCA without football drops football from the cohort and sport table", () => {
  const rows = [
    prior({ pcid: "P1", sport: "Football" }),
    prior({ pcid: "P2", sport: "Volleyball", gender: "Female" }),
    prior({ pcid: "P3", sport: "" }),
  ];
  const all = buildFtcaAttritionFromPrior(rows, ["P1", "P2"], []);
  const noFb = buildFtcaAttritionFromPrior(
    rows.filter((s) => (s.sport || "").toLowerCase() !== "football"),
    ["P1", "P2"],
    [],
  );
  assert.equal(all.cohort, 3);
  assert.equal(noFb.cohort, 2);
  assert.equal(all.bySport.some((r) => r.label === "Football"), true);
  assert.equal(noFb.bySport.some((r) => r.label === "Football"), false);
  assert.equal(noFb.bySport[0]?.label, "Volleyball");
});

test("December 2025 conferrals labeled Spring 2025 count in All UG graduates", () => {
  const rows = [
    prior({
      pcid: "P000358025",
      first: "Clayton",
      last: "Mather",
      incomingReturning: "Returning",
      collegeAttend: "TRAN",
      classLevel: "Senior",
      athlete: "Non-Athlete",
      sport: "",
    }),
    prior({
      pcid: "P000341586",
      first: "Joseph",
      last: "Suchomski",
      incomingReturning: "Returning",
      collegeAttend: "FTCA",
      classLevel: "Senior",
      athlete: "Non-Athlete",
      sport: "",
    }),
    prior({
      pcid: "P000342817",
      first: "Brenden",
      last: "Wilson",
      incomingReturning: "Returning",
      collegeAttend: "FTCA",
      classLevel: "Senior",
      athlete: "Non-Athlete",
      sport: "",
    }),
    prior({ pcid: "P1", incomingReturning: "Incoming" }),
  ];
  const extract = [
    { pcid: "P000358025", year: "2025", term: "SPRING", date: "2025-12-13" },
    { pcid: "P000341586", year: "2025", term: "SPRING", date: "2025-12-13" },
    { pcid: "P000342817", year: "2025", term: "SPRING", date: "2025-12-13" },
  ];
  const withDate = buildAllUgSplit(rows, ["P1"], extract);
  assert.equal(withDate.all.graduated, 3);
  assert.equal(withDate.nonAthletes.graduated, 3);
  const termOnly = buildAllUgSplit(
    rows,
    ["P1"],
    extract.map(({ pcid, year, term }) => ({ pcid, year, term })),
  );
  assert.equal(termOnly.all.graduated, 3, "force list covers S25 extract when conferral date is missing");
});

test("retention notes exclude Aiden Wilson, count Parks as retained, and treat listed graduates as grads", () => {
  const a = buildFtcaAttritionFromPrior(
    [
      prior({ pcid: "P000384377", first: "Aiden", last: "Wilson", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      prior({ pcid: "P000379038", first: "Seth", last: "Parks", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      prior({ pcid: "P000347161", first: "Lauren", last: "Berns", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
    ],
    [],
    [],
  );
  assert.equal(a.cohort, 2);
  assert.equal(a.enrolledThisFall, 1, "Seth Parks forced retained");
  assert.equal(a.notRetained, 0, "Berns is a summer graduate, not a leaver");
  assert.equal(a.graduated, 1);
  assert.equal(a.retentionRate, 1, "graduate is out of the denominator, same as All UG");
});

test("All UG, FTCA, sports, and crosstabs use enrolled / (cohort minus graduates)", () => {
  assert.equal(retentionPct(4, 1, 1), 2 / 3);
  assert.equal(retentionPct(4, 1, 0), 3 / 4);
  const rows = [
    prior({ pcid: "P1" }),
    prior({ pcid: "P2" }),
    prior({ pcid: "P3" }),
    prior({ pcid: "P4" }),
  ];
  const grads = [{ pcid: "P3", year: "2026", term: "SPRING" }];
  const current = ["P1", "P2"];
  const ug = buildAllUgSplit(rows, current, grads);
  assert.equal(ug.all.students, 4);
  assert.equal(ug.all.enrolled, 2);
  assert.equal(ug.all.graduated, 1);
  assert.equal(ug.all.notRetained, 1);
  assert.equal(ug.all.retentionPct, 2 / 3);
  const ftca = buildFtcaAttritionFromPrior(rows, current, grads);
  assert.equal(ftca.cohort, 4);
  assert.equal(ftca.enrolledThisFall, 2);
  assert.equal(ftca.graduated, 1);
  assert.equal(ftca.notRetained, 1);
  assert.equal(ftca.retentionRate, 2 / 3);
  assert.equal(ftca.byAthlete.find((r) => r.label === "Athlete")?.retainedPct, 2 / 3);
  const tab = buildCrosstab(rows, current, grads, () => "All");
  assert.equal(tab[0]?.students, 4);
  assert.equal(tab[0]?.notRetained, 1);
  assert.equal(tab[0]?.graduated, 1);
  assert.equal(tab[0]?.retentionPct, 2 / 3);
  const fb = buildSportRetention(rows, current, grads).find((r) => r.sport === "Football");
  assert.equal(fb?.retained, 2);
  assert.equal(fb?.graduated, 1);
  assert.equal(fb?.notRetained, 1);
  assert.equal(fb?.retentionPct, 2 / 3);
});

test("Application Decisions Retention includes Not listed so the total matches the cohort", () => {
  const rows = buildCrosstab(
    [
      prior({ pcid: "P1", appDecision: "ACCT" }),
      prior({ pcid: "P2", appDecision: "" }),
      prior({ pcid: "P3", appDecision: "ADMI" }),
      prior({ pcid: "P4", appDecision: "-" }),
    ],
    ["P1", "P2", "P3"],
    [],
    (s) => censusAppDecision(s.appDecision),
  );
  const by = Object.fromEntries(rows.map((r) => [r.label, r.students]));
  assert.equal(by.ACCT, 1);
  assert.equal(by.ADM, 1);
  assert.equal(by["Not listed"], 2);
  assert.equal(rows.reduce((s, r) => s + r.students, 0), 4);
});

test("committee admits and admin overrides split Overall, FTCA, gender, and athlete", () => {
  const rows = buildAdmitOverrideRetention(
    [
      prior({ pcid: "P1", appDecision: "ADM", collegeAttend: "FTCA", incomingReturning: "Incoming", gender: "Male", athlete: "Athlete" }),
      prior({ pcid: "P2", appDecision: "ADM", collegeAttend: "TRAN", incomingReturning: "Incoming", gender: "Female", athlete: "Non-Athlete", sport: "" }),
      prior({ pcid: "P3", appDecision: "COMM", collegeAttend: "FTCA", incomingReturning: "Incoming", gender: "Male", athlete: "Non-Athlete", sport: "" }),
    ],
    ["P1", "P3"],
    [],
  );
  const adm = rows.filter((r) => r.label.startsWith("Admin"));
  const comm = rows.filter((r) => r.label.startsWith("Committee"));
  assert.equal(adm.find((r) => r.label2 === "Overall")?.students, 2);
  assert.equal(adm.find((r) => r.label2 === "FTCA")?.students, 1);
  assert.equal(comm.find((r) => r.label2 === "Overall")?.students, 1);
  assert.equal(comm.find((r) => r.label2 === "FTCA")?.students, 1);
});

test("association retention lists Households and Institute once per gender", () => {
  const rows = buildAssociationRetention(
    [
      prior({ pcid: "H1", gender: "Female", household: "Called By Name" }),
      prior({ pcid: "I1", gender: "Female", institute: "Scholar" }),
      prior({ pcid: "I2", gender: "Male", institute: "Scholar" }),
      prior({ pcid: "F1", gender: "Male", fsp: "FSP" }),
    ],
    ["H1", "I1", "I2", "F1"],
    [],
  );
  const households = rows.filter((r) => r.label === "Households");
  assert.equal(households.length, 2);
  assert.equal(households.find((r) => r.label2 === "Female")?.students, 1);
  const institute = rows.filter((r) => r.label === "Institute");
  assert.equal(institute.length, 2);
  assert.equal(institute.find((r) => r.label2 === "Female")?.students, 1);
  assert.equal(institute.find((r) => r.label2 === "Male")?.students, 1);
  assert.equal(rows.filter((r) => r.label === "FSP").length, 2);
});

test("leave of absence stays in the FA25 cohort and counts as retained", () => {
  const ug = buildAllUgSplit(
    [
      prior({
        pcid: "P000346188",
        first: "Sophia",
        last: "Gomez",
        incomingReturning: "Returning",
        collegeAttend: "FTCA",
        classLevel: "Junior",
      }),
      prior({ pcid: "P1", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      prior({ pcid: "P000352989", first: "Andrew", last: "Trumpore", incomingReturning: "Returning" }),
    ],
    ["P1"],
    [],
  );
  assert.equal(ug.all.students, 3, "Gomez LOA stays in the FA25 cohort");
  assert.equal(ug.all.enrolled, 3, "LOA counts as retained");
  assert.equal(ug.all.notRetained, 0, "LOA is not a leaver");
  assert.equal(ug.all.retentionPct, 1);
});

test("FTCA Sport Primary omits Non-Athlete; that is not a sport", () => {
  const a = buildFtcaAttritionFromPrior(
    [
      prior({ pcid: "P1", sport: "Football" }),
      prior({ pcid: "P2", sport: "", athlete: "Non-Athlete" }),
      prior({ pcid: "P3", sport: "Non-Athlete", athlete: "Non-Athlete" }),
    ],
    ["P1", "P2"],
    [],
  );
  assert.equal(a.bySport.some((r) => r.label === "Non-Athlete"), false);
  assert.equal(a.bySport.length, 1);
  assert.equal(a.bySport[0]?.label, "Football");
  assert.equal(a.byAthlete.find((r) => r.label === "Non-Athlete")?.students, 2);
});

test("athletic retention splits team athletes from associated and keeps Band as associated only", () => {
  const rows = buildSportRetention(
    [
      prior({ pcid: "P1", sport: "Football", athleticType: "Varsity" }),
      prior({ pcid: "P2", sport: "Football", athleticType: "Manager/Student Coach" }),
      prior({ pcid: "P3", sport: "Band", athleticType: "" }),
    ],
    ["P1", "P2"],
    [],
  );
  const fb = rows.find((r) => r.sport === "Football");
  assert.equal(fb?.athletes, 1);
  assert.equal(fb?.associated, 2);
  const band = rows.find((r) => r.sport === "Band");
  assert.equal(band?.athletes, 0, "Band is associated, not a team athlete");
  assert.equal(band?.associated, 1);
});

test("Athletic Retention FA25 roster matches last year's teams including LOA and deceased", () => {
  const rows = buildSportRetention(
    [
      prior({ pcid: "P000378273", sport: "Swimming-Women", athleticType: "Varsity" }), // Hannah
      prior({ pcid: "P000341593", sport: "Golf-Men", athleticType: "Non-Varsity" }), // Earnhardt LOA
      prior({ pcid: "P2", sport: "Swimming-Women", athleticType: "Varsity" }),
      prior({ pcid: "P3", sport: "Band" }),
    ],
    ["P2"],
    [],
  );
  const band = rows.find((r) => r.sport === "Band");
  assert.equal(band?.athletes, 0);
  assert.equal(band?.associated, 1);
  const swim = rows.find((r) => r.sport === "Swimming-Women");
  assert.equal(swim?.associated, 2, "Hannah stays on the FA25 swimming roster");
  assert.equal(swim?.retained, 1);
  assert.equal(swim?.notRetained, 0, "deceased is out of the denominator, not a leaver");
  const golf = rows.find((r) => r.sport === "Golf-Men");
  assert.equal(golf?.associated, 1, "LOA stays on the FA25 golf roster");
  assert.equal(golf?.retained, 1, "LOA counts as retained");
  assert.equal(golf?.notRetained, 0);
});

test("blank FA25 athletic type on a team is associated, not a team athlete", () => {
  const rows = buildSportRetention(
    [
      prior({ pcid: "P1", sport: "Football", athleticType: "Varsity" }),
      prior({ pcid: "P2", sport: "Football", athleticType: "", rosterStatus: "" }),
    ],
    ["P1", "P2"],
    [],
  );
  const fb = rows.find((r) => r.sport === "Football");
  assert.equal(fb?.athletes, 1);
  assert.equal(fb?.associated, 2);
});

test("pickleball and Ireland are omitted from sport retention", () => {
  const rows = buildSportRetention(
    [
      prior({ pcid: "P1", sport: "Pickleball-Men" }),
      prior({ pcid: "P2", sport: "Football" }),
      prior({ pcid: "P3", sport: "Ireland", athleticType: "" }),
    ],
    [],
    [],
  );
  assert.equal(rows.some((r) => /pickle/i.test(r.sport)), false);
  assert.equal(rows.some((r) => r.sport === "Ireland"), false);
  assert.equal(rows[0]?.sport, "Football");
});

test("Rugby-Women retention folds into Rugby-Men", () => {
  const rows = buildSportRetention(
    [
      prior({ pcid: "P1", sport: "Rugby-Men" }),
      prior({ pcid: "P2", sport: "Rugby-Women", athleticType: "Manager/Student Coach", gender: "Female" }),
    ],
    [],
    [],
  );
  assert.equal(rows.some((r) => r.sport === "Rugby-Women"), false);
  assert.equal(rows[0]?.sport, "Rugby-Men");
  assert.equal(rows[0]?.associated, 2);
  assert.equal(rows[0]?.athletes, 1);
});

test("hiding a sport drops it from retention totals", () => {
  const rows = buildSportRetention(
    [prior({ pcid: "P1", sport: "Football" }), prior({ pcid: "P2", sport: "Volleyball" })],
    [],
    [],
    ["Football"],
  );
  assert.equal(rows.some((r) => r.sport === "Football"), false);
  assert.equal(rows[0]?.sport, "Volleyball");
});

test("SAT converts to ACT and ACT converted takes the higher score", () => {
  assert.equal(satToAct(399), null);
  assert.equal(satToAct(1200), 25);
  assert.equal(satToAct(1570), 36);
  assert.equal(actConverted({ act: 24, sat: 1400 }), 31);
  assert.equal(actConverted({ act: 28, sat: 1100 }), 28);
  assert.equal(actConverted({ act: 0, sat: 350 }), null);
  assert.equal(actConvertedBucket({ act: 17 }), "<18");
  assert.equal(actConvertedBucket({ sat: 1210 }), "25-27");
  assert.equal(actConvertedBucket({}), "No ACT converted");
  assert.equal(hasTestScore({ clt: 80 }), true);
  assert.equal(hasTestScore({ act: 0, sat: 0, clt: 0 }), false);
});

test("HS GPA buckets match the FA25 FTCA sheet", () => {
  assert.equal(hsGpaBucket(""), "No HS GPA");
  assert.equal(hsGpaBucket(0), "No HS GPA");
  assert.equal(hsGpaBucket(2.48), "2.0 - 2.49");
  assert.equal(hsGpaBucket(2.9), "2.5 - 2.99");
  assert.equal(hsGpaBucket(3.49), "3.0 - 3.49");
  assert.equal(hsGpaBucket(3.5), "3.5 - 4.0");
  assert.equal(hsGpaFineBucket(2.89), null);
  assert.equal(hsGpaFineBucket(2.9), "2.9- 2.99");
  assert.equal(hsGpaFineBucket(3.19), "3.1 - 3.19");
  assert.equal(hsGpaFineBucket(3.5), null);
});

test("FTCA extras fill HS GPA ranges and copy scores onto FTCA raw", () => {
  const extras = buildFtcaExtras(
    [
      prior({ pcid: "P1", hsGpa: 3.8, athlete: "Athlete" }),
      prior({ pcid: "P2", hsGpa: 3.05, athlete: "Non-Athlete", sport: "" }),
      prior({ pcid: "P3", hsGpa: 2.4, athlete: "Athlete" }),
    ],
    ["P1"],
    [],
  );
  assert.equal(extras.byHsGpa.find((r) => r.label === "3.5 - 4.0")?.students, 1);
  assert.equal(extras.byHsGpa.find((r) => r.label === "3.0 - 3.49")?.students, 1);
  assert.equal(extras.byHsGpaFine.find((r) => r.label === "3.0 - 3.09")?.students, 1);
  assert.equal(extras.byHsGpaAthletes.find((r) => r.label === "2.0 - 2.49")?.notRetained, 1);
  const scored = buildFtcaExtras(
    [
      prior({ pcid: "P1", act: 26 }),
      prior({ pcid: "P2", sat: 1100, athlete: "Non-Athlete", sport: "" }),
      prior({ pcid: "P3", clt: 90, athlete: "Athlete" }),
      prior({ pcid: "P4", honors: "Hons", athlete: "Non-Athlete", sport: "" }),
    ],
    ["P1", "P4"],
    [],
  );
  assert.equal(scored.byActConverted.find((r) => r.label === "25-27")?.students, 1);
  assert.equal(scored.byActConverted.find((r) => r.label === "22-24")?.students, 1);
  assert.equal(scored.byActConverted.find((r) => r.label === "No ACT converted")?.students, 2);
  assert.equal(scored.byTestScore.find((r) => r.label === "Has test score")?.students, 2);
  assert.equal(scored.byTestScore.find((r) => r.label === "No test score")?.students, 2);
  assert.equal(scored.byHasTestScoreAthlete.find((r) => r.label === "Athlete")?.students, 1);
  assert.equal(scored.byHasTestScoreAthlete.find((r) => r.label === "Non-Athlete")?.students, 1);
  assert.equal(scored.byNoTestScoreAthlete.find((r) => r.label === "Athlete")?.students, 1);
  assert.equal(scored.byNoTestScoreAthlete.find((r) => r.label === "Non-Athlete")?.students, 1);
  assert.equal(scored.byHonors.find((r) => r.label === "Honors College")?.students, 1);
  const withInst = buildFtcaExtras(
    [
      prior({ pcid: "P1", institute: "Scholar" }),
      prior({ pcid: "P2", institute: "", sport: "" }),
    ],
    ["P1"],
    [],
  );
  assert.equal(withInst.byInstitute.find((r) => r.label === "Institute")?.students, 1);
  assert.equal(withInst.byInstitute.find((r) => r.label === "No Institute")?.students, 1);
  const raw = deriveFtcaRaw(
    [prior({ pcid: "P1", hsGpa: 3.8, dob: "03/28/2007", act: 26 })],
    [prior({ pcid: "P1" })],
    [],
  );
  assert.equal(raw[0]?.hsGpa, 3.8);
  assert.equal(raw[0]?.dob, "03/28/2007");
});
