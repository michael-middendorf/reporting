import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EREZ_PRICE,
  HALL_CHARTS,
  IRELAND_CAP,
  MEN_HALLS,
  WOMEN_HALLS,
  bedsOpen,
  effCap,
  hallCap,
  indexOccupancy,
  isAbroad,
  isCommuter,
  isCommuterAbroad,
  isIreland,
  isOffLimits,
  isRome,
  isUnassigned,
  sumHalls,
} from "./model";
import type { ChartRoom, RoomVerificationState } from "./types";

const NONE: RoomVerificationState["edits"] = {};

function chartRoom(hall: string, num: string): ChartRoom {
  const room = HALL_CHARTS[hall]?.floors.flatMap((f) => f.rooms).find((r) => r.number === num);
  assert.ok(room, `missing ${hall} ${num}`);
  return room;
}

test("Ireland is CIARA/MALAC; Rome is eRez price type RSTA", () => {
  assert.equal(isIreland("CIARA"), true);
  assert.equal(isIreland("MALAC"), true);
  assert.equal(isAbroad("CIARA"), true);
  assert.equal(isIreland("JPII"), false);
  assert.equal(isRome({ price_type: EREZ_PRICE.ROME }), true);
  assert.equal(isRome({ price_type: "rsta" }), true);
  assert.equal(isRome({ price_type: EREZ_PRICE.IRELAND }), false);
  assert.equal(isRome({}), false);
});

test("blank building is Rome or commuter-abroad, not unassigned", () => {
  assert.equal(isUnassigned({ building: "", price_type: "RSTA" }), false);
  assert.equal(isUnassigned({ building: "", price_type: "CSTA" }), false);
  assert.equal(isUnassigned({ building: "", price_type: "" }), true);
  assert.equal(isUnassigned({ building: "JPII" }), false);
  assert.equal(isCommuterAbroad({ price_type: "CSTA" }), true);
  assert.equal(isCommuter({ building: "Commuter" }), true);
  assert.equal(isCommuter({ building: "", price_type: "CSTA" }), true);
  assert.equal(isCommuter({ building: "JPII" }), false);
});

test("empty edits: Goretti and Xavier hallCap are 182", () => {
  assert.equal(hallCap(HALL_CHARTS.GORET, "GORET", NONE), 182);
  assert.equal(hallCap(HALL_CHARTS.XAVIER, "XAVIER", NONE), 182);
});

test("named bible rooms are off-limits with empty edits", () => {
  for (const [hall, num] of [
    ["GORET", "163"],
    ["XAVIER", "163"],
    ["JPII", "318"],
    ["JPII", "240"],
    ["JPII", "340"],
    ["SEBAST", "137"],
    ["SEBAST", "355"],
    ["STJOSE", "215A"],
    ["STJOSE", "215B"],
    ["STJOSE", "311A"],
    ["TERESA", "102"],
    ["TERESA", "104"],
    ["TERESA", "318"],
    ["TERESA", "402"],
  ] as const) {
    assert.equal(isOffLimits(NONE, hall, num), true, `${hall} ${num}`);
  }
});

test("hallCap and bedsOpen skip bible-unavailable rooms even when occupied", () => {
  const before = hallCap(HALL_CHARTS.JPII, "JPII", NONE);
  const occ = indexOccupancy([
    { pcid: "1", building: "JPII", room: "318" },
    { pcid: "2", building: "JPII", room: "318" },
    { pcid: "3", building: "JPII", room: "318" },
    { pcid: "4", building: "JPII", room: "318" },
  ]);
  assert.equal(hallCap(HALL_CHARTS.JPII, "JPII", NONE), before);
  assert.equal(bedsOpen(HALL_CHARTS.JPII, "JPII", occ, NONE, null), before);
  assert.equal(isOffLimits(NONE, "JPII", "318"), true);
});

test("staff Off-limits on a normal room still reduces hallCap", () => {
  const base = hallCap(HALL_CHARTS.GORET, "GORET", NONE);
  const room = chartRoom("GORET", "155");
  assert.equal(room.cap, 3);
  const edits = { "GORET-155": { status: "Off-limits" } };
  assert.equal(isOffLimits(edits, "GORET", "155"), true);
  assert.equal(hallCap(HALL_CHARTS.GORET, "GORET", edits), base - 3);
});

test("staff capacity edit on Goretti 153 (normal triple) changes effCap", () => {
  const room = chartRoom("GORET", "153");
  assert.equal(room.cap, 3);
  assert.equal(effCap(NONE, "GORET", room), 3);
  const edits = { "GORET-153": { capacity: 1 } };
  assert.equal(effCap(edits, "GORET", room), 1);
  assert.equal(hallCap(HALL_CHARTS.GORET, "GORET", edits), 180);
});

test("Teresa 101 clinic is cap 0 and does not add to hallCap", () => {
  const room = chartRoom("TERESA", "101");
  assert.equal(room.cap, 0);
  assert.equal(effCap(NONE, "TERESA", room), 0);
  assert.equal(isOffLimits(NONE, "TERESA", "101"), false);
  assert.equal(hallCap(HALL_CHARTS.TERESA, "TERESA", NONE), 268);
});

test("Joseph 311A priest, Teresa 102/104 extras and 402 showroom, JPII ghosts are cap 0", () => {
  for (const [hall, num] of [
    ["STJOSE", "311A"],
    ["TERESA", "102"],
    ["TERESA", "104"],
    ["TERESA", "402"],
    ["JPII", "240"],
    ["JPII", "340"],
  ] as const) {
    const room = chartRoom(hall, num);
    assert.equal(room.cap, 0, `${hall} ${num} chart cap`);
    assert.equal(isOffLimits(NONE, hall, num), true, `${hall} ${num}`);
    assert.equal(effCap(NONE, hall, room), 0, `${hall} ${num} effCap`);
  }
  assert.match(chartRoom("STJOSE", "311A").type || "", /Priest/);
  assert.match(chartRoom("TERESA", "102").type || "", /Extra/);
  assert.match(chartRoom("TERESA", "104").type || "", /Extra/);
  assert.match(chartRoom("TERESA", "402").type || "", /Showroom/);
  assert.match(chartRoom("JPII", "240").type || "", /Ghost/);
  assert.match(chartRoom("JPII", "340").type || "", /Ghost/);
});

test("Joseph 307/308 are bible doubles, not this-year priest holds", () => {
  for (const num of ["307A", "307B", "308A", "308B"] as const) {
    const room = chartRoom("STJOSE", num);
    assert.equal(room.cap, 2, `STJOSE ${num} chart cap`);
    assert.equal(room.type, "Double", `STJOSE ${num} type`);
    assert.equal(isOffLimits(NONE, "STJOSE", num), false, `STJOSE ${num}`);
    assert.equal(effCap(NONE, "STJOSE", room), 2, `STJOSE ${num} effCap`);
  }
});

test("bible cap overrides: Joseph 207A is 1, Sebastian 153 is 2, 251/351 ADA are 1, JPII 104 is 2", () => {
  const jose207a = chartRoom("STJOSE", "207A");
  const jose207b = chartRoom("STJOSE", "207B");
  const seb153 = chartRoom("SEBAST", "153");
  const seb167 = chartRoom("SEBAST", "167");
  const seb251 = chartRoom("SEBAST", "251");
  const seb351 = chartRoom("SEBAST", "351");
  const jpii104 = chartRoom("JPII", "104");
  assert.equal(jose207a.cap, 1);
  assert.equal(effCap(NONE, "STJOSE", jose207a), 1);
  assert.equal(isOffLimits(NONE, "STJOSE", "207A"), false);
  assert.equal(jose207b.cap, 2);
  assert.equal(effCap(NONE, "STJOSE", jose207b), 2);
  assert.equal(seb153.cap, 2);
  assert.equal(effCap(NONE, "SEBAST", seb153), 2);
  assert.equal(seb167.cap, 3);
  assert.equal(effCap(NONE, "SEBAST", seb167), 3);
  assert.equal(seb167.type, "Triple");
  assert.equal(seb251.cap, 1);
  assert.equal(effCap(NONE, "SEBAST", seb251), 1);
  assert.equal(seb351.cap, 1);
  assert.equal(effCap(NONE, "SEBAST", seb351), 1);
  assert.equal(jpii104.cap, 2);
  assert.equal(effCap(NONE, "JPII", jpii104), 2);
  assert.equal(isOffLimits(NONE, "JPII", "104"), false);
  assert.match(jpii104.type || "", /ADA/);
});

/*
 * 5.7.2024 bible mix: Goretti 182, Xavier 182, JPII 262, Sebastian 174,
 * Joseph 135, Teresa 268. Women 626, Men 577, campus 1203.
 * Joseph 307/308 restored (+8). Teresa 102/104 unlabeled extras (-8).
 * JPII 104 is the ADA double (cap 2), so JPII is 262.
 */
test("empty edits: women 626, men 577, campus 1203", () => {
  const capFn = (code: string) => hallCap(HALL_CHARTS[code], code, NONE);
  assert.equal(capFn("GORET"), 182);
  assert.equal(capFn("XAVIER"), 182);
  assert.equal(capFn("JPII"), 262);
  assert.equal(capFn("SEBAST"), 174);
  assert.equal(capFn("STJOSE"), 135);
  assert.equal(capFn("TERESA"), 268);
  assert.equal(capFn("GORET") + capFn("XAVIER"), 364);
  const women = sumHalls(WOMEN_HALLS, capFn);
  const men = sumHalls(MEN_HALLS, capFn);
  assert.equal(women, 626);
  assert.equal(men, 577);
  assert.equal(women + men, 1203);
  assert.equal(IRELAND_CAP.w, 50);
  assert.equal(IRELAND_CAP.m, 50);
  assert.equal(IRELAND_CAP.all, 100);
  assert.equal(women + men + IRELAND_CAP.all, 1303);
});
