import { writeFileSync } from "node:fs";
import { loadCensusSnapshot } from "../src/lib/reports/census/overlay";
import { buildCensusWorkbook, censusFileName } from "../src/lib/reports/census/workbook";

async function main() {
  const { data, housingRows, lists, ftcaRaw } = await loadCensusSnapshot();
  const buf = await buildCensusWorkbook(data, housingRows, lists, ftcaRaw);
  const out =
    process.argv[2] || `/Users/regina.m.pirolli/Documents/Census Files/${censusFileName(data)}`;
  writeFileSync(out, buf);
  const uniq = new Set(lists.students.map((s) => (s.pcid || "").toUpperCase())).size;
  console.log(
    JSON.stringify(
      {
        out,
        rows: lists.students.length,
        unique: uniq,
        unretained: lists.unretained.length,
        housing: housingRows.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
