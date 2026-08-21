import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EREZ_PRICE,
  isAbroad,
  isCommuter,
  isCommuterAbroad,
  isIreland,
  isRome,
  isUnassigned,
} from "./model";

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
