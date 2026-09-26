import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/** Academic Affairs ships Excel only: no CSV builders or downloads anywhere in the section. */
const ROOTS = ["src/app/aspiredu", "src/lib/reports/aspiredu"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("Academic Affairs has no CSV", () => {
  it("never builds or serves CSV", () => {
    for (const path of ROOTS.flatMap(files)) {
      if (path.endsWith("no-csv.test.ts")) continue;
      const text = readFileSync(path, "utf8");
      assert.ok(!/text\/csv|\.csv\b|toCsv|csvEscape/i.test(text), `${path} mentions CSV`);
    }
  });
});
