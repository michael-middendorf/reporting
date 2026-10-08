import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { riskBand, validateManualKpiInput, validateRiskInput, type RiskInput } from "./register";
import { historyDatesFromKeys } from "./shape";

const GOOD: RiskInput = {
  id: "risk-example",
  title: "Example risk",
  category: "identity",
  likelihood: 3,
  impact: 4,
  owner: "IT Identity",
  treatment: "mitigate",
  dueDate: "2026-12-01",
  status: "open",
  kpiId: null,
  acceptedExpiry: null,
  notes: "",
  source: "test",
};

describe("validateRiskInput", () => {
  it("accepts a well-formed risk", () => {
    assert.equal(validateRiskInput(GOOD).ok, true);
  });

  it("rejects out-of-range ratings, bad enums, bad dates, unknown keys", () => {
    const r = validateRiskInput({
      ...GOOD,
      likelihood: 6,
      impact: 0,
      treatment: "ignore",
      status: "done",
      dueDate: "2026-13-40",
      extra: 1,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    const joined = r.errors.join(" | ");
    for (const frag of ["likelihood", "impact", "treatment", "status", "dueDate", "unknown field extra"]) {
      assert.match(joined, new RegExp(frag));
    }
  });

  it("refuses emails and IPv4 addresses in text (owner is a role, not a person)", () => {
    const r1 = validateRiskInput({ ...GOOD, owner: "keith.brooks@avemaria.edu" });
    assert.equal(r1.ok, false);
    const r2 = validateRiskInput({ ...GOOD, notes: "host 10.1.2.3 is exposed" });
    assert.equal(r2.ok, false);
  });

  it("requires acceptedExpiry and treatment accept for accepted risks", () => {
    assert.equal(validateRiskInput({ ...GOOD, status: "accepted", treatment: "accept" }).ok, false);
    assert.equal(
      validateRiskInput({ ...GOOD, status: "accepted", treatment: "mitigate", acceptedExpiry: "2027-01-01" }).ok,
      false,
    );
    assert.equal(
      validateRiskInput({ ...GOOD, status: "accepted", treatment: "accept", acceptedExpiry: "2027-01-01" }).ok,
      true,
    );
  });

  it("rejects bad ids and kpi- prefixed risk ids", () => {
    assert.equal(validateRiskInput({ ...GOOD, id: "Bad Id" }).ok, false);
    assert.equal(validateRiskInput({ ...GOOD, id: "kpi-x" }).ok, false);
  });
});

describe("validateManualKpiInput", () => {
  const KPI = {
    id: "kpi-training",
    label: "Security awareness training completion",
    section: "program",
    value: 82.5,
    unit: "%",
    target: ">= 95%",
    rag: "amber",
    asOf: "2026-10-01",
    notes: "",
  };

  it("accepts numbers, short strings and null values", () => {
    assert.equal(validateManualKpiInput(KPI).ok, true);
    assert.equal(validateManualKpiInput({ ...KPI, value: "Done" }).ok, true);
    assert.equal(validateManualKpiInput({ ...KPI, value: null, rag: null }).ok, true);
  });

  it("requires a kpi- id and a known section and rag", () => {
    assert.equal(validateManualKpiInput({ ...KPI, id: "training" }).ok, false);
    assert.equal(validateManualKpiInput({ ...KPI, section: "hr" }).ok, false);
    assert.equal(validateManualKpiInput({ ...KPI, rag: "blue" }).ok, false);
    assert.equal(validateManualKpiInput({ ...KPI, value: Number.NaN }).ok, false);
  });
});

// Synthetic fixtures only. Real register content is confidential and lives
// in a local, untracked seed file (scripts/seed-cyber-register.ts --file).
const FIXTURES: RiskInput[] = [
  { ...GOOD, id: "risk-example-a", title: "Example risk A", category: "cloud", likelihood: 4, impact: 5 },
  { ...GOOD, id: "risk-example-b", title: "Example risk B", category: "governance", dueDate: null },
  {
    ...GOOD,
    id: "risk-example-c",
    title: "Example risk C",
    category: "data",
    treatment: "accept",
    status: "accepted",
    acceptedExpiry: "2027-06-30",
  },
];

describe("seed-shaped fixtures", () => {
  it("validate and have unique ids", () => {
    const ids = new Set<string>();
    for (const r of FIXTURES) {
      const v = validateRiskInput(r);
      assert.equal(v.ok, true, `${r.id}: ${v.ok ? "" : v.errors.join(", ")}`);
      assert.equal(ids.has(r.id), false, `duplicate ${r.id}`);
      ids.add(r.id);
    }
  });

  it("round-trip through JSON (the seed file format) unchanged", () => {
    const parsed = JSON.parse(JSON.stringify(FIXTURES)) as unknown[];
    for (const row of parsed) {
      const v = validateRiskInput(row);
      assert.equal(v.ok, true);
    }
  });
});

describe("helpers", () => {
  it("riskBand thresholds", () => {
    assert.equal(riskBand(25), "red");
    assert.equal(riskBand(15), "red");
    assert.equal(riskBand(12), "amber");
    assert.equal(riskBand(8), "amber");
    assert.equal(riskBand(6), "green");
  });

  it("historyDatesFromKeys keeps only dated history files, newest first", () => {
    assert.deepEqual(
      historyDatesFromKeys([
        "cybersecurity/history/2026-10-01.json",
        "cybersecurity/history/2026-11-01.json",
        "cybersecurity/history/notes.txt",
        "cybersecurity/latest.json",
      ]),
      ["2026-11-01", "2026-10-01"],
    );
  });
});
