import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCensusBriefing, countPeople, searchPeople } from "./briefing";
import type { CensusRawStudent } from "./lists-core";
import snapshot from "./snapshot.json";
import type { CensusSnapshot } from "./types";

function s(partial: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "P1",
    first: "A",
    last: "B",
    incomingReturning: "Incoming",
    state: "FL",
    religion: "Catholic",
    cathGroup: "Catholic",
    ethnicity: "WHITE",
    gender: "Female",
    program: "UNDERG",
    collegeAttend: "FTCA",
    curriculum: "BIOLOG",
    curriculumName: "Biology",
    classLevel: "Freshman",
    fullPart: "FULL",
    city: "",
    credits: 15,
    gpa: 3.2,
    earnedCredits: 0,
    residency: "On Campus",
    sport: "",
    athlete: "Non-Athlete",
    athleticType: "",
    rosterStatus: "",
    honors: "",
    fsp: "",
    household: "",
    institute: "",
    marines: "",
    appDecision: "ACCT",
    session: "01",
    degree: "BARTS",
    email: "",
    citizenship: "",
    visa: "",
    ...partial,
  };
}

test("briefing uses live student lists, not a guessed FTCA number", () => {
  const data = structuredClone(snapshot) as CensusSnapshot;
  const lists = {
    students: [
      s({ pcid: "P1" }),
      s({ pcid: "P2", first: "Ty", last: "Robbins", classLevel: "Sophomore" }),
      s({ pcid: "P3", incomingReturning: "Returning", collegeAttend: "FTCA" }),
      s({ pcid: "P4", incomingReturning: "Incoming", collegeAttend: "TRAN" }),
    ],
    prior: [s({ pcid: "P9", first: "Aiden", last: "Wilson" })],
    unretained: [],
    graduates: [],
    loa: [],
  };
  const b = buildCensusBriefing(data, lists);
  assert.equal(b.thisFall.ftca, 2);
  assert.equal(b.thisFall.newStudents, 3);
  assert.equal(b.source.authority.includes("loadCensusSnapshot"), true);
  assert.ok(b.presidentMightAsk.length >= 8);
  assert.ok(b.definitions.some((d) => /Incoming\+FTCA/i.test(d)));
});

test("lookup finds names on FA26 and FA25 lists", () => {
  const lists = {
    students: [s({ pcid: "P0001", first: "Elena", last: "Snyder" })],
    prior: [s({ pcid: "P0002", first: "Aiden", last: "Wilson" })],
    unretained: [],
    graduates: [],
    loa: [],
  };
  assert.equal(searchPeople(lists, "snyder")[0]?.pcid, "P0001");
  assert.equal(searchPeople(lists, "snyder")[0]?.list, "FA26");
  assert.equal(searchPeople(lists, "Aiden Wilson")[0]?.pcid, "P0002");
  assert.equal(searchPeople(lists, "Aiden Wilson")[0]?.list, "FA25");
  assert.equal(countPeople(lists, { term: "fa26", incoming: true, ftca: true }).n, 1);
});
