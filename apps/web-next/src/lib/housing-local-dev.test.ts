import assert from "node:assert/strict";
import { test } from "node:test";
import { housingLocalDevEnabled } from "./housing-local-dev";

test("housingLocalDevEnabled is true only for non-production + exact HOUSING_LOCAL_DEV=1", () => {
  const prevNode = process.env.NODE_ENV;
  const prevFlag = process.env.HOUSING_LOCAL_DEV;
  try {
    process.env.NODE_ENV = "production";
    process.env.HOUSING_LOCAL_DEV = "1";
    assert.equal(housingLocalDevEnabled(), false);

    process.env.NODE_ENV = "development";
    process.env.HOUSING_LOCAL_DEV = "1";
    assert.equal(housingLocalDevEnabled(), true);

    process.env.HOUSING_LOCAL_DEV = "true";
    assert.equal(housingLocalDevEnabled(), false);

    process.env.HOUSING_LOCAL_DEV = "";
    assert.equal(housingLocalDevEnabled(), false);

    delete process.env.HOUSING_LOCAL_DEV;
    assert.equal(housingLocalDevEnabled(), false);
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete process.env.HOUSING_LOCAL_DEV;
    else process.env.HOUSING_LOCAL_DEV = prevFlag;
  }
});
