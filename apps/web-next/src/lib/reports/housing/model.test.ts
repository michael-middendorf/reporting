import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EREZ_PRICE,
  HALL_CHARTS,
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
    ["JPII", "318"],
    ["SEBAST", "137"],
    ["SEBAST", "355"],
    ["STJOSE", "215A"],
    ["TERESA", "318"],
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
  assert.equal(hallCap(HALL_CHARTS.TERESA, "TERESA", NONE), 280);
});

/*
 * Bible campus is 1203. Remaining 38 beds are unlabeled (Joseph priests,
 * JPII extra/ADA, Teresa show, Sebastian ADA double) and are intentionally
 * omitted from BIBLE_UNAVAILABLE / BIBLE_CAP_OVERRIDES.
 *
 * Chart 1275 minus named zeros (29) minus ADA (5) = 1241.
 */
test("empty edits: women 632, men 609, campus 1241", () => {
  const capFn = (code: string) => hallCap(HALL_CHARTS[code], code, NONE);
  assert.equal(capFn("GORET"), 182);
  assert.equal(capFn("XAVIER"), 182);
  assert.equal(capFn("JPII"), 268);
  assert.equal(capFn("SEBAST"), 177);
  assert.equal(capFn("STJOSE"), 152);
  assert.equal(capFn("TERESA"), 280);
  assert.equal(capFn("GORET") + capFn("XAVIER"), 364);
  const women = sumHalls(WOMEN_HALLS, capFn);
  const men = sumHalls(MEN_HALLS, capFn);
  assert.equal(women, 632);
  assert.equal(men, 609);
  assert.equal(women + men, 1241);
});
