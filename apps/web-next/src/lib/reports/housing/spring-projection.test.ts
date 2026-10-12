import assert from "node:assert/strict";
import { describe, it } from "node:test";
import stjose from "./halls/stjose.chart.json";
import {
  JOSEPH_PRIEST_EXCLUDED,
  JOSEPH_PRIEST_EXCLUDED_BEDS,
  JOSEPH_PRIEST_HOLD_BEDS,
  JOSEPH_PRIEST_HOLDS,
} from "./priest-rooms";
import {
  DECEMBER_UG_GRADS,
  FA_TO_SP_ATTRITION,
  SP_TO_FA_ATTRITION,
  isPossibleGraduate,
  isUgHousingClass,
  projectSpring,
  ratePct,
  sexTotal,
} from "./spring-projection";
import type { Resident } from "./types";

function person(partial: Partial<Resident> & Pick<Resident, "pcid">): Resident {
  return {
    gender: "F",
    class_status: "Junior",
    building: "JPII",
    room: "101",
    price_type: "UGDP",
    ...partial,
  };
}

function room(num: string) {
  for (const floor of stjose.floors) {
    const found = floor.rooms.find((item) => item.number === num);
    if (found) return found;
  }
  throw new Error(`missing St. Joseph ${num}`);
}

describe("spring projection rates", () => {
  it("keeps the census fractions and the published spring-to-fall complement", () => {
    assert.deepEqual(DECEMBER_UG_GRADS, { w: 14, m: 20, o: 0 });
    assert.equal(ratePct(FA_TO_SP_ATTRITION.w), 4.2);
    assert.equal(ratePct(FA_TO_SP_ATTRITION.m), 6.7);
    assert.equal(ratePct(FA_TO_SP_ATTRITION.all), 5.4);
    assert.equal(SP_TO_FA_ATTRITION.w, 6.5);
    assert.equal(SP_TO_FA_ATTRITION.m, 11.8);
    assert.equal(SP_TO_FA_ATTRITION.all, 8.9);
  });
});

describe("projectSpring", () => {
  it("adds Ireland and Rome, caps December graduates at seniors, and leaves May graduates in", () => {
    const residents = [
      ...Array.from({ length: 10 }, (_, i) => person({ pcid: `jw${i}` })),
      ...Array.from({ length: 2 }, (_, i) => person({ pcid: `sw${i}`, class_status: "Senior" })),
      person({ pcid: "iw", building: "CIARA", room: "", price_type: "ISTA", class_status: "Senior" }),
      person({ pcid: "rw", building: "", room: "", price_type: "RSTA" }),
      person({ pcid: "gw", class_status: "Graduate" }),
      ...Array.from({ length: 5 }, (_, i) =>
        person({ pcid: `sm${i}`, gender: "M", building: "STJOSE", class_status: "Senior" }),
      ),
      person({ pcid: "com", building: "Commuter", room: "", price_type: "NODM" }),
      person({ pcid: "mbk", gender: "M", building: "MBK", room: "12", class_status: "Senior" }),
    ];
    const proj = projectSpring(residents);

    assert.deepEqual(proj.halls, { w: 13, m: 5, o: 0 });
    assert.deepEqual(proj.ireland, { w: 1, m: 0, o: 0 });
    assert.deepEqual(proj.rome, { w: 1, m: 0, o: 0 });
    assert.equal(sexTotal(proj.commuter), 1);
    assert.equal(sexTotal(proj.mbk), 1);
    assert.deepEqual(proj.seniors, { w: 3, m: 5, o: 0 });
    assert.deepEqual(proj.seniorsElsewhere, { w: 0, m: 1, o: 0 });
    assert.deepEqual(proj.decemberSubtracted, { w: 3, m: 5, o: 0 });
    assert.deepEqual(proj.nonUg, { w: 1, m: 0, o: 0 });
    assert.deepEqual(proj.attritionLeaves, { w: 0, m: 0, o: 0 });
    assert.deepEqual(proj.spring, { w: 12, m: 0, o: 0 });
    assert.equal(sexTotal(proj.spring), sexTotal(proj.pool) - sexTotal(proj.decemberSubtracted));
  });

  it("applies the sex-specific rate to undergraduates who remain, and does not invent graduates", () => {
    const residents = [
      ...Array.from({ length: 200 }, (_, i) => person({ pcid: `w${i}` })),
      ...Array.from({ length: 200 }, (_, i) => person({ pcid: `m${i}`, gender: "M", building: "TERESA" })),
      ...Array.from({ length: 30 }, (_, i) =>
        person({ pcid: `s${i}`, class_status: "Senior", building: "XAVIER" }),
      ),
    ];
    const proj = projectSpring(residents);
    assert.equal(proj.decemberSubtracted.w, 14);
    assert.equal(proj.decemberSubtracted.m, 0);
    assert.equal(proj.attritionLeaves.w, 9);
    assert.equal(proj.attritionLeaves.m, 13);
    assert.equal(proj.spring.w, 200 + 30 - 14 - proj.attritionLeaves.w);
    assert.equal(proj.spring.m, 200 - 13);
    assert.equal(
      sexTotal(proj.spring),
      sexTotal(proj.pool) - sexTotal(proj.decemberSubtracted) - sexTotal(proj.attritionLeaves),
    );
    assert.equal(
      sexTotal(proj.fallReturners) + sexTotal(proj.fallLeavers),
      sexTotal(proj.spring),
    );
  });

  it("keeps an empty class in the undergraduate pool and ignores a blank list", () => {
    assert.equal(isUgHousingClass({ class_status: "" }), true);
    assert.equal(isUgHousingClass({ class_status: "Graduate" }), false);
    assert.equal(isPossibleGraduate({ class_status: "Senior" }), true);
    assert.equal(isPossibleGraduate({ class_status: "Graduate" }), false);
    const empty = projectSpring([]);
    assert.equal(sexTotal(empty.spring), 0);
    assert.equal(sexTotal(empty.fallReturners), 0);
    const unknown = projectSpring([person({ pcid: "u", class_status: "" })]);
    assert.equal(unknown.ugPool.w, 1);
    assert.equal(unknown.seniors.w, 0);
  });
});

describe("St. Joseph priest rooms", () => {
  it("keeps the named priest doubles out of capacity and the holds inside it", () => {
    assert.equal(JOSEPH_PRIEST_EXCLUDED.length, 8);
    assert.equal(JOSEPH_PRIEST_EXCLUDED_BEDS, 16);
    assert.equal(JOSEPH_PRIEST_HOLDS.length * 2, JOSEPH_PRIEST_HOLD_BEDS);
    for (const num of JOSEPH_PRIEST_EXCLUDED) {
      const item = room(num);
      assert.equal(item.cap, 0, num);
      assert.match(item.type || "", /Priest/, num);
    }
    for (const num of JOSEPH_PRIEST_HOLDS) {
      const item = room(num);
      assert.equal(item.cap, 2, num);
      assert.equal(item.type, "Double", num);
    }
    assert.equal(room("215A").cap, 0);
    assert.match(room("215A").type || "", /Emergency/);
    assert.match(room("215B").type || "", /Emergency/);
  });
});
