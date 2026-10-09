import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../lib/auth";
import { PCID_PATTERN, type MajorsPayload } from "../../../lib/reports/majors/shape";
import { FIXTURE_NOW, fixtureSources } from "../../../lib/reports/majors/test-fixtures";
import { GET as EXPORT, majorsExportDeps } from "../majors-export/route";
import { GET, majorsDataDeps } from "./route";

const SECRET = "majors-route-test-secret";

function authRequest(path: string, email: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(`https://reporting.avemaria.edu${path}`, { headers });
}

async function withDeps(fn: (loads: { n: number }) => Promise<void>, sources = fixtureSources()) {
  const prevData = { ...majorsDataDeps };
  const prevExport = { ...majorsExportDeps };
  const prevSecret = process.env.AUTH_SECRET;
  const loads = { n: 0 };
  const load = async () => {
    loads.n += 1;
    return sources;
  };
  Object.assign(majorsDataDeps, { load, now: () => FIXTURE_NOW });
  Object.assign(majorsExportDeps, { load, now: () => FIXTURE_NOW });
  try {
    await fn(loads);
  } finally {
    Object.assign(majorsDataDeps, prevData);
    Object.assign(majorsExportDeps, prevExport);
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
  }
}

describe("GET /api/majors-data", () => {
  it("requires sign-in and the majors report server-side", async () => {
    await withDeps(async (loads) => {
      assert.equal((await GET(authRequest("/api/majors-data", null))).status, 401);
      assert.equal((await GET(authRequest("/api/majors-data", "luke.fier@avemaria.edu"))).status, 403);
      assert.equal(loads.n, 0, "denied users never load PowerCampus rows");
      const res = await GET(authRequest("/api/majors-data", "roger.nutt@avemaria.edu"));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      const body = (await res.json()) as MajorsPayload;
      assert.equal(body.status, "ready");
    });
  });

  it("returns aggregates only: no PEOPLE_CODE_ID or P + digits anywhere", async () => {
    await withDeps(async () => {
      for (const q of ["", "?incomingYear=2026&year=2026&term=SPRING", "?year=P000000101&term=x'"]) {
        const res = await GET(authRequest(`/api/majors-data${q}`, "roger.nutt@avemaria.edu"));
        assert.equal(res.status, 200, q);
        const text = await res.text();
        assert.equal(text.includes("PEOPLE_CODE_ID"), false, q);
        assert.doesNotMatch(text, PCID_PATTERN, q);
        assert.doesNotMatch(text, /"P\d+"/, q);
      }
    });
  });

  it("returns the waiting state (200) before the nightly refresh adds the new columns", async () => {
    const src = fixtureSources();
    src.codeEnrollment = null;
    await withDeps(async () => {
      const res = await GET(authRequest("/api/majors-data", "roger.nutt@avemaria.edu"));
      assert.equal(res.status, 200);
      const body = (await res.json()) as MajorsPayload;
      assert.equal(body.status, "waiting");
    }, src);
  });
});

describe("GET /api/majors-export", () => {
  it("is gated and returns an xlsx for a listed user", async () => {
    await withDeps(async () => {
      assert.equal((await EXPORT(authRequest("/api/majors-export", null))).status, 401);
      assert.equal((await EXPORT(authRequest("/api/majors-export", "someone@avemaria.edu"))).status, 403);
      const res = await EXPORT(authRequest("/api/majors-export", "roger.nutt@avemaria.edu"));
      assert.equal(res.status, 200);
      assert.match(res.headers.get("Content-Type") || "", /spreadsheetml/);
      assert.match(res.headers.get("Content-Disposition") || "", /Majors_and_Minors_Fall_2026_Incoming_2027\.xlsx/);
    });
  });

  it("refuses with 409 while waiting for the refresh", async () => {
    const src = fixtureSources();
    src.codeEnrollment = null;
    await withDeps(async () => {
      const res = await EXPORT(authRequest("/api/majors-export", "roger.nutt@avemaria.edu"));
      assert.equal(res.status, 409);
    }, src);
  });
});
