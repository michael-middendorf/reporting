import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipEntries } from "../census/xlsx";
import { buildExportResponse, type ExportDeps } from "./export-handler";
import { fakeCensus, fakeCourse } from "./export-test-fixtures";

const CALLER = "daniel.davy@avemaria.edu";

function quiet<T>(run: () => Promise<T>): Promise<T> {
  const saved = { info: console.info, warn: console.warn, error: console.error };
  const lines: string[] = [];
  console.info = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  (quiet as unknown as { lines: string[] }).lines = lines;
  return run().finally(() => Object.assign(console, saved));
}

function deps(overrides: Partial<ExportDeps> = {}): ExportDeps & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    invoke: async (payload) => {
      calls.push(payload);
      if (!payload.cursor) {
        return { ok: true, courses: [fakeCourse()], cursor: "page-2", courseCount: 2, studentCount: 2 };
      }
      return {
        ok: true,
        courses: [fakeCourse({ studentHmac: "hmac-2", studentSisId: "222", firstName: "Blair", lastName: "Sample" })],
        cursor: null,
      };
    },
    loadRoster: async () => null,
    loadHousing: async () => {
      throw new Error("S3 exploded with student rows");
    },
    loadCensus: async () => ({ students: [fakeCensus({ pcid: "P000000111" })], asOf: "2026-09-25" }),
    ...overrides,
  };
}

describe("buildExportResponse", () => {
  it("loops the courses cursor and returns an xlsx attachment with private headers", async () => {
    const d = deps();
    const response = await quiet(() => buildExportResponse({ callerEmail: CALLER, deps: d }));
    const logs = (quiet as unknown as { lines: string[] }).lines.join("\n");
    assert.equal(response.status, 200);
    assert.deepEqual(d.calls, [
      { action: "courses", callerEmail: CALLER, cursor: undefined },
      { action: "courses", callerEmail: CALLER, cursor: "page-2" },
    ]);
    assert.equal(response.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.match(response.headers.get("Content-Disposition") || "", /^attachment; filename="academic-affairs-students-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    const bytes = Buffer.from(await response.arrayBuffer());
    const files = unzipEntries(bytes);
    assert.ok(files["xl/worksheets/sheet1.xml"]);
    assert.ok(files["xl/worksheets/sheet2.xml"]);
    // Logs: actor, counts, and ms only. No names, emails of students, or source errors.
    assert.match(logs, /"event":"aspiredu_export","actor":"daniel.davy@avemaria.edu","students":2,"classes":2,"censusMatched":1,"ms":\d+/);
    assert.doesNotMatch(logs, /Alex|Example|alex\.example|exploded|P000000111/);
  });

  it("returns 403 when the Lambda denies the caller", async () => {
    const response = await quiet(() =>
      buildExportResponse({
        callerEmail: CALLER,
        deps: deps({ invoke: async () => Promise.reject(new Error("Processor error: caller is not authorized")) }),
      }),
    );
    assert.equal(response.status, 403);
  });

  it("returns a clean 503 when the Lambda fails, without echoing its message", async () => {
    const response = await quiet(() =>
      buildExportResponse({
        callerEmail: CALLER,
        deps: deps({ invoke: async () => Promise.reject(new Error("Processor error: {\"firstName\":\"Alex\"}")) }),
      }),
    );
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.doesNotMatch(body.error, /Alex|Processor/);
  });

  it("returns 503 while awaiting the first delivery instead of an empty workbook", async () => {
    const response = await quiet(() =>
      buildExportResponse({
        callerEmail: CALLER,
        deps: deps({ invoke: async () => ({ ok: true, status: "awaiting_first_delivery", courses: [] }) }),
      }),
    );
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as { error: string }).error, /Awaiting/);
  });

  it("returns 503 when the time budget runs out", async () => {
    const response = await quiet(() =>
      buildExportResponse({
        callerEmail: CALLER,
        budgetMs: 30,
        deps: deps({ invoke: () => new Promise(() => undefined) }),
      }),
    );
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as { error: string }).error, /too long/);
  });

  it("counts slow sources against the same budget", async () => {
    const response = await quiet(() =>
      buildExportResponse({
        callerEmail: CALLER,
        budgetMs: 30,
        deps: deps({ loadCensus: () => new Promise(() => undefined) }),
      }),
    );
    assert.equal(response.status, 503);
  });

  it("stops on a repeated cursor", async () => {
    const response = await quiet(() =>
      buildExportResponse({
        callerEmail: CALLER,
        deps: deps({ invoke: async () => ({ ok: true, courses: [], cursor: "same" }) }),
      }),
    );
    assert.equal(response.status, 503);
  });
});
