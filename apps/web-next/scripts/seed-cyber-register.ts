/**
 * Seed the Cybersecurity risk register (DynamoDB amu-reporting-cyber-register)
 * from a LOCAL JSON file: an array of risk objects (see RiskInput in
 * src/lib/cyber/register.ts).
 *
 * The register content is confidential (it lists AMU weaknesses), so it is
 * never committed. Keep the seed file on the operator's machine only.
 *
 * DRY RUN BY DEFAULT: validates every row, prints what it would write, and
 * touches nothing. Pass --confirm to write. Existing ids are skipped (never
 * overwritten), and each write goes through registerStore.create, so it also
 * writes a history row.
 *
 *   cd apps/web-next
 *   npx tsx scripts/seed-cyber-register.ts --file <path-to-local.json>            # dry run
 *   AWS_PROFILE=default npx tsx scripts/seed-cyber-register.ts --file <path> --confirm
 *
 * The operator running --confirm needs dynamodb:GetItem/PutItem on the table
 * and kms:Encrypt/GenerateDataKey/Decrypt on alias/amu-reporting-cyber through
 * DynamoDB.
 */
import { readFileSync } from "node:fs";
import { validateRiskInput, type RiskInput } from "../src/lib/cyber/register";
import { RegisterConflictError, registerStore } from "../src/lib/cyber/register-store";

const DEFAULT_TABLE = "amu-reporting-cyber-register";
const SEEDED_BY = "seed-script";

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

function loadRows(path: string): RiskInput[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("seed file must be a JSON array of risks");
  const rows: RiskInput[] = [];
  const ids = new Set<string>();
  let bad = 0;
  parsed.forEach((raw, i) => {
    const v = validateRiskInput(raw);
    if (!v.ok) {
      bad++;
      // Row index and field errors only: never echo the row content.
      console.error(`row ${i}: ${v.errors.join("; ")}`);
      return;
    }
    if (ids.has(v.value.id)) {
      bad++;
      console.error(`row ${i}: duplicate id ${v.value.id}`);
      return;
    }
    ids.add(v.value.id);
    rows.push(v.value);
  });
  if (bad) throw new Error(`${bad} invalid row(s); nothing written`);
  return rows;
}

async function main() {
  const file = argValue("--file");
  if (!file) {
    console.error("usage: seed-cyber-register.ts --file <local.json> [--confirm]");
    process.exit(2);
  }
  const confirm = process.argv.includes("--confirm");
  if (!process.env.CYBER_REGISTER_TABLE) process.env.CYBER_REGISTER_TABLE = DEFAULT_TABLE;
  const table = process.env.CYBER_REGISTER_TABLE;

  const rows = loadRows(file);
  console.log(`${confirm ? "WRITE" : "DRY RUN"}: ${rows.length} risks -> ${table}`);
  if (!confirm) {
    for (const r of rows) {
      console.log(`  would create ${r.id} (L${r.likelihood} x I${r.impact}, ${r.status})`);
    }
    console.log("No changes made. Re-run with --confirm to write.");
    return;
  }

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    if (await registerStore.get("risk", r.id)) {
      console.log(`  skip ${r.id} (exists)`);
      skipped++;
      continue;
    }
    try {
      await registerStore.create("risk", r, SEEDED_BY);
      console.log(`  created ${r.id}`);
      created++;
    } catch (e) {
      if (e instanceof RegisterConflictError) {
        console.log(`  skip ${r.id} (exists)`);
        skipped++;
        continue;
      }
      throw e;
    }
  }
  console.log(`done: created ${created}, skipped ${skipped}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
