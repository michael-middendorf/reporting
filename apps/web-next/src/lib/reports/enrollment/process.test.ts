import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityByAC,
  emptyAcFunnel,
  isActivityCounselorKey,
} from "./counselors";
import { _acRecScore, _procAdm, _procAME, _procPSW, _termStats, _termStatsAsOf } from "./process.js";

function row(partial: Record<string, unknown> = {}) {
  return {
    ApplicationTerm: "Fall 2027",
    ApplicationStudentType: "First-Year",
    ApplicationACAssignment: "abel.cordero",
    ...partial,
  };
}

test("UG student types count; Graduate and Dual Enrollment do not", () => {
  const rows = [
    row({ ApplicationStudentType: "First-Year" }),
    row({ ApplicationStudentType: "Transfer", ApplicationACAssignment: "lillian.doyle" }),
    row({ ApplicationStudentType: "Re-Admission", ApplicationACAssignment: "caroline.g.savoie" }),
    row({ ApplicationStudentType: "Second Degree", ApplicationACAssignment: "madelyn.r.byers" }),
    row({
      ApplicationStudentType: "Graduate",
      ApplicationACAssignment: "danielle.d.domino",
      AcceptCode: "AT",
    }),
    row({
      ApplicationStudentType: "Dual Enrollment",
      ApplicationACAssignment: "georgiana.e.depugh",
    }),
  ];
  const stats = _termStats(rows, 2027, new Date("2026-08-20"));
  assert.equal(stats.created, 4);
  assert.equal(stats.accepted, 0);
  assert.equal(stats.byAC["abel.cordero"].created, 1);
  assert.equal(stats.byAC["lillian.doyle"].created, 1);
  assert.equal(stats.byAC["caroline.g.savoie"].created, 1);
  assert.equal(stats.byAC["madelyn.r.byers"].created, 1);
  assert.equal(stats.byAC["danielle.d.domino"], undefined);
  assert.equal(stats.byAC["georgiana.e.depugh"], undefined);
});

test("current UG roster is always present in byAC; leftover assignees are omitted", () => {
  const rows = [
    row({ ApplicationACAssignment: "abel.cordero" }),
    row({ ApplicationACAssignment: "dan.donaldson" }),
    row({ ApplicationACAssignment: "annie.esposito" }),
    row({ ApplicationACAssignment: "anna.kaminski", ApplicationStudentType: "Graduate" }),
    row({ ApplicationACAssignment: "" }),
  ];
  const stats = _termStats(rows, 2027, new Date("2026-08-20"));
  assert.ok(stats.byAC["abel.cordero"]);
  assert.ok(stats.byAC["katherine.n.lyons"]); // zero-filled current AC
  assert.equal(stats.byAC["katherine.n.lyons"].created, 0);
  assert.equal(stats.byAC[""].created, 1);
  assert.equal(stats.byAC["dan.donaldson"], undefined);
  assert.equal(stats.byAC["annie.esposito"], undefined);
  assert.equal(stats.byAC["anna.kaminski"], undefined);
  // leftover UG assignee is still in the funnel total
  assert.equal(stats.created, 4);
});

test("allRows stays unfiltered so the Fall report can apply its own type filter", () => {
  const rows = [
    row({ ApplicationStudentType: "Graduate", ApplicationACAssignment: "danielle.d.domino" }),
    row({ ApplicationStudentType: "First-Year" }),
  ];
  const adm = _procAdm(rows, "2026-08-20");
  assert.equal(adm.allRows.length, 2);
  assert.equal(adm.fa27.created, 1);
});

test("enrollment funnel drops graduate and dual enrollment", () => {
  const rows = [
    row({ ApplicationTerm: "Fall 2027", ApplicationStudentType: "First-Year", CreatedDate: "2026-08-01" }),
    row({ ApplicationTerm: "Fall 2027", ApplicationStudentType: "Graduate", CreatedDate: "2026-08-01" }),
    row({ ApplicationTerm: "Fall 2027", ApplicationStudentType: "Dual Enrollment", CreatedDate: "2026-08-01" }),
    row({ ApplicationTerm: "Fall 2026", ApplicationStudentType: "Transfer", CreatedDate: "2025-08-01" }),
    row({ ApplicationTerm: "Fall 2026", ApplicationStudentType: "Graduate", CreatedDate: "2025-08-01" }),
  ];
  const adm = _procAdm(rows, "2026-08-21");
  assert.equal(adm.fa27.created, 1);
  assert.equal(adm.fa26.created, 1);
  assert.equal(adm.fa26Yoy.created, 1);
});

test("FA27 history FA25 snapshot is two years ago, not the finished cycle", () => {
  const rows = [
    row({ ApplicationTerm: "Fall 2025", CreatedDate: "08/01/2024", ApplicationSubmittedDate: "08/01/2024" }),
    row({ ApplicationTerm: "Fall 2025", CreatedDate: "09/15/2024", ApplicationSubmittedDate: "09/15/2024" }),
    row({ ApplicationTerm: "Fall 2024", CreatedDate: "08/01/2023", ApplicationSubmittedDate: "08/01/2023" }),
    row({ ApplicationTerm: "Fall 2024", CreatedDate: "08/22/2024", ApplicationSubmittedDate: "08/22/2024" }),
  ];
  const adm = _procAdm(rows, "2026-08-21");
  assert.equal(adm.fa25.created, 2);
  assert.equal(adm.fa25Yoy.created, 2);
  assert.equal(adm.fa25Yoy2.created, 1);
  assert.equal(adm.fa25Yoy2.submitted, 1);
  assert.equal(adm.fa24Yoy2.created, 1);
});

test("PSW YoY uses FormSubmissionDate and is 0 when nobody had signed up yet", () => {
  const rows = [
    {
      Term: "Fall 2026",
      RegistrationStatus: "Attended",
      FormCreatedDate: "2025-11-10",
      FormStartDateTime: "2026-01-16",
      FormSubmissionDate: "2025-12-01",
    },
    {
      Term: "Fall 2025",
      RegistrationStatus: "Attended",
      FormCreatedDate: "2024-11-01",
      FormStartDateTime: "2025-01-17",
      FormSubmissionDate: "2024-12-01",
    },
  ];
  const psw = _procPSW(rows, "2026-08-21");
  assert.equal(psw.byCycle["Fall 2026"].total, 1);
  assert.equal(psw.byCycleYoy["Fall 2026"], undefined);
  assert.equal(psw.byCycleYoy["Fall 2025"].total, 1);
});

test("PSW event cycle ignores application term so Spring attendees stay on the January weekend", () => {
  const rows = [
    { Term: "Fall 2026", RegistrationStatus: "Attended", FormStartDateTime: "2026-01-16", FormSubmissionDate: "2025-12-01" },
    { Term: "Spring 2026", RegistrationStatus: "No Show", FormStartDateTime: "2026-01-16", FormSubmissionDate: "2025-12-02" },
  ];
  const psw = _procPSW(rows, "2026-08-21");
  assert.equal(psw.byCycle["Fall 2026"].total, 2);
  assert.equal(psw.byCycle["Fall 2026"].att, 1);
  assert.equal(psw.byCycle["Fall 2026"].noShow, 1);
  assert.equal(psw.byTerm["Spring 2026"].total, 1);
});

test("AME overview counts registrants and YoY-gates the prior cycle", () => {
  const rows = [
    { FormStartDateTime: "2026-09-12", RegistrationStatus: "Registered", SubmissionDate: "2026-08-01" },
    { FormStartDateTime: "2025-09-10", RegistrationStatus: "Attended", SubmissionDate: "2025-07-01" },
    { FormStartDateTime: "2025-09-10", RegistrationStatus: "Registered", SubmissionDate: "2025-09-01" },
    { FormStartDateTime: "2025-09-10", RegistrationStatus: "Cancelled", SubmissionDate: "2025-06-01" },
  ];
  const ame = _procAME(rows, "2026-08-21");
  assert.equal(ame.byCycle["Fall 2027"].Sep.registrants, 1);
  assert.equal(ame.byCycle["Fall 2026"].Sep.registrants, 2);
  assert.equal(ame.byCycleYoy["Fall 2026"].Sep.registrants, 1);
  assert.equal(ame.byFy["Fall 2027"].total, 1);
  assert.equal(ame.byFy["Fall 2027"].registered, 1);
  assert.equal(ame.byFy["Fall 2026"].total, 3);
  assert.equal(ame.byFy["Fall 2026"].attended, 1);
  assert.equal(ame.byFy["Fall 2026"].cancelled, 1);
});

test("AME fiscal year is July 1 through June 30 of the selected Fall term", () => {
  const rows = [
    { FormStartDateTime: "2026-07-01", RegistrationStatus: "Registered" },
    { FormStartDateTime: "2026-06-30", RegistrationStatus: "Attended" },
    { FormStartDateTime: "2027-06-30", RegistrationStatus: "Cancelled" },
  ];
  const ame = _procAME(rows, "2026-08-21");
  assert.equal(ame.byFy["Fall 2027"].total, 2);
  assert.equal(ame.byFy["Fall 2027"].registered, 1);
  assert.equal(ame.byFy["Fall 2027"].cancelled, 1);
  assert.equal(ame.byFy["Fall 2026"].total, 1);
  assert.equal(ame.byFy["Fall 2026"].attended, 1);
});

test("activityByAC drops Danielle, Georgiana, Anna, and Annie; keeps Unassigned when present", () => {
  const byAC = {
    "abel.cordero": { ...emptyAcFunnel(), created: 10, deposited: 2 },
    "danielle.d.domino": { ...emptyAcFunnel(), created: 2 },
    "georgiana.e.depugh": { ...emptyAcFunnel(), created: 1 },
    "anna.kaminski": { ...emptyAcFunnel(), created: 49 },
    "annie.esposito": { ...emptyAcFunnel(), created: 8 },
    "": { ...emptyAcFunnel(), created: 23 },
  };
  const view = activityByAC(byAC);
  assert.equal(view["danielle.d.domino"], undefined);
  assert.equal(view["georgiana.e.depugh"], undefined);
  assert.equal(view["anna.kaminski"], undefined);
  assert.equal(view["annie.esposito"], undefined);
  assert.equal(view[""].created, 23);
  assert.equal(view["abel.cordero"].created, 10);
  assert.equal(isActivityCounselorKey("danielle.d.domino"), false);
  assert.equal(isActivityCounselorKey("georgiana.e.depugh"), false);
  assert.equal(isActivityCounselorKey("anna.kaminski"), false);
  assert.equal(isActivityCounselorKey("annie.esposito"), false);
  assert.equal(isActivityCounselorKey("abel.cordero"), true);
  assert.equal(isActivityCounselorKey(""), true);
});

test("AC rec 3s and 4s count UG apps; graduate rec 4 is excluded", () => {
  const rows = [
    row({ InterviewACRating: "3", CreatedDate: "2026-08-01" }),
    row({ InterviewACRating: 4, CreatedDate: "2026-08-01" }),
    row({ InterviewACRating: "2", CreatedDate: "2026-08-01" }),
    row({
      ApplicationStudentType: "Graduate",
      InterviewACRating: "4",
      CreatedDate: "2026-08-01",
    }),
  ];
  const adm = _procAdm(rows, "2026-09-07");
  assert.equal(adm.fa27.acRec3, 1);
  assert.equal(adm.fa27.acRec4, 1);
  assert.equal(adm.fa27.acRec34, 2);
});

test("AC rec score reads 25/26 1-4 aliases and ignores leftover 0-3 keys", () => {
  assert.equal(_acRecScore({ "PersonInterview-ACReccomendations2526": "3 - foo" }), 3);
  assert.equal(_acRecScore({ InterviewACRecommendation: "3" }), null);
  const rows = [
    row({
      "PersonInterview-ACReccomendations2526": "3 - foo",
      CreatedDate: "2026-08-01",
    }),
    row({
      InterviewACRating: "4",
      InterviewACRating2425: "3",
      CreatedDate: "2026-08-01",
    }),
  ];
  const adm = _procAdm(rows, "2026-09-07");
  assert.equal(adm.fa27.acRec3, 1);
  assert.equal(adm.fa27.acRec4, 1);
  assert.equal(adm.fa27.acRec34, 2);
});

test("Fall 2025 leftover and 1-4 person recs do not count; FA27 26-field still counts", () => {
  const rows = [
    row({
      ApplicationTerm: "Fall 2025",
      InterviewACRecommendation: "3",
      InterviewACRating: "3",
      CreatedDate: "2024-08-01",
    }),
    row({
      ApplicationTerm: "Fall 2027",
      "PersonInterview-ACReccomendations2526": "3 - foo",
      CreatedDate: "2026-08-01",
    }),
  ];
  const adm = _procAdm(rows, "2026-09-07");
  assert.equal(adm.fa25.acRec3, 0);
  assert.equal(adm.fa25.acRec4, 0);
  assert.equal(adm.fa25.acRec34, 0);
  assert.equal(adm.fa27.acRec3, 1);
  assert.equal(adm.fa27.acRec4, 0);
  assert.equal(adm.fa27.acRec34, 1);
});

test("Fall 2024 rec counts stay 0 even with a 1-4 rating on the row", () => {
  const rows = [
    row({
      ApplicationTerm: "Fall 2024",
      InterviewACRating: 4,
      InterviewedDateFA27Apps: "2024-09-01",
      CreatedDate: "2023-08-01",
    }),
  ];
  const adm = _procAdm(rows, "2026-09-07");
  assert.equal(adm.fa24.acRec3, 0);
  assert.equal(adm.fa24.acRec4, 0);
  assert.equal(adm.fa24.acRec34, 0);
  assert.equal(adm.fa24Yoy2.acRec3, 0);
  assert.equal(adm.fa24Yoy2.acRec4, 0);
  assert.equal(adm.fa24Yoy2.acRec34, 0);
});

test("AC rec as-of requires interview date on or before last-year cutoff", () => {
  const rows = [
    row({
      ApplicationTerm: "Fall 2026",
      InterviewACRating: 4,
      InterviewedDateFA26Apps: "2025-09-08",
      CreatedDate: "2025-08-01",
    }),
    row({
      ApplicationTerm: "Fall 2026",
      InterviewACRating: 4,
      InterviewedDateFA26Apps: "2025-09-07",
      CreatedDate: "2025-08-01",
    }),
    row({
      ApplicationTerm: "Fall 2026",
      InterviewACRating: 3,
      InterviewedDateFA26Apps: "2025-09-01",
      CreatedDate: "2025-08-01",
    }),
    row({
      ApplicationTerm: "Fall 2026",
      InterviewACRating: 4,
      CreatedDate: "2025-08-01",
    }),
  ];
  const adm = _procAdm(rows, "2026-09-07");
  assert.equal(adm.fa26.acRec3, 1);
  assert.equal(adm.fa26.acRec4, 3);
  assert.equal(adm.fa26.acRec34, 4);
  assert.equal(adm.fa26Yoy.acRec3, 1);
  assert.equal(adm.fa26Yoy.acRec4, 1);
  assert.equal(adm.fa26Yoy.acRec34, 2);
});

test("interviewed athletes require Athlete or Non-Athlete = Athlete", () => {
  const rows = [
    row({
      InterviewStatus: "Interviewed",
      AthleteorNonAthlete: "Athlete",
    }),
    row({
      InterviewStatus: "Interviewed",
      AthleteorNonAthlete: "Non-Athlete",
      Sport: "Football",
    }),
    row({
      InterviewStatus: "Interviewed",
      AthleteorNonAthlete: "Non-Athlete",
      AthleticDecision: "Athlete",
    }),
    row({
      ApplicationStudentType: "Graduate",
      InterviewStatus: "Interviewed",
      AthleteorNonAthlete: "Athlete",
    }),
    row({
      ApplicationTerm: "Fall 2026",
      InterviewStatus: "Interviewed",
      AthleteorNonAthlete: "Athlete",
    }),
  ];
  const adm = _procAdm(rows, "2026-08-20");
  assert.equal(adm.fa27.interviewed, 3);
  assert.equal(adm.fa27.interviewedAthletes, 1);
  assert.equal(adm.fa27.interviewedAthletePct, (1 / 3) * 100);
});

test("zero interviewed leaves athlete count at 0 and percent null", () => {
  const stats = _termStats([row({ CreatedDate: "2026-08-01" })], 2027, new Date(2026, 7, 20));
  assert.equal(stats.interviewed, 0);
  assert.equal(stats.interviewedAthletes, 0);
  assert.equal(stats.interviewedAthletePct, null);
});

test("prior Fall 2026 athlete interviews use the interview date cutoff", () => {
  const rows = [
    row({
      ApplicationTerm: "Fall 2026",
      AthleteorNonAthlete: "Athlete",
      InterviewedDateFA26Apps: "2025-09-01",
    }),
    row({
      ApplicationTerm: "Fall 2026",
      AthleteorNonAthlete: "Non-Athlete",
      InterviewedDateFA26Apps: "2025-09-07",
    }),
    row({
      ApplicationTerm: "Fall 2026",
      AthleteorNonAthlete: "Athlete",
      InterviewedDateFA26Apps: "2025-09-08",
    }),
  ];
  const stats = _termStatsAsOf(rows, new Date(2025, 8, 7), 2026);
  assert.equal(stats.interviewed, 2);
  assert.equal(stats.interviewedAthletes, 1);
  assert.equal(stats.chg.interviewedAthletes, 0);
  assert.equal(stats.chg.interviewedAthletePct, null);
});

test("7-day interviewed athletes use the interview date and athlete flag", () => {
  const rows = [
    row({
      AthleteorNonAthlete: "Athlete",
      InterviewedDateFA27Apps: "2026-08-18",
    }),
    row({
      AthleteorNonAthlete: "Athlete",
      InterviewedDateFA27Apps: "2026-08-01",
    }),
    row({
      AthleteorNonAthlete: "Non-Athlete",
      InterviewedDateFA27Apps: "2026-08-19",
    }),
  ];
  const stats = _termStats(rows, 2027, new Date(2026, 7, 20));
  assert.equal(stats.chg.interviewedAthletes, 1);
});

test("_procAdm exposes fa27 interviewed athletes", () => {
  const adm = _procAdm(
    [row({ InterviewStatus: "Interviewed", AthleteorNonAthlete: "Athlete" })],
    "2026-08-20",
  );
  assert.equal(adm.fa27.interviewedAthletes, 1);
});

test("missing AC rec field is 0 and existing created/accepted still hold", () => {
  const rows = [
    row({
      CreatedDate: "2026-08-01",
      AcceptCode: "AT",
      AcceptDate: "2026-08-10",
    }),
  ];
  const adm = _procAdm(rows, "2026-09-07");
  assert.equal(adm.fa27.acRec3, 0);
  assert.equal(adm.fa27.acRec4, 0);
  assert.equal(adm.fa27.acRec34, 0);
  assert.equal(adm.fa27.created, 1);
  assert.equal(adm.fa27.accepted, 1);
});
