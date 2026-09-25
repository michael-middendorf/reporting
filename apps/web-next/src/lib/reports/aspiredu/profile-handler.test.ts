import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProfileResponse, type ProfileDeps } from "./profile-handler";
import { PROFILE_UNAVAILABLE } from "./student-profile";

const KEY = "abcdefghijklmnopqrstuvwxyz012345";
const CALLER = "daniel.davy@avemaria.edu";

const LAMBDA_OK = {
  ok: true,
  asOf: { courses: "2026-09-24T12:00:00Z" },
  student: { studentKey: KEY, firstName: "Test", lastName: "Student", email: "t.s@avemaria.edu", studentSisId: "123456", risk: 3 },
  courses: [{ course: "THEO 101", grade: 88 }],
  sessions: [{ classDate: "2026-09-20", course: "THEO 101", status: "Present" }],
  pulse: { present: 1, absent: 0, late: 0, other: 0, sessionCount: 1, latestClassDate: "2026-09-20" },
  // Free text that mentions "unknown action" must not trip the 503 detector.
  notes: [{ text: "Student hit an unknown action error in 501 lab", datetime: null }],
  alerts: [],
};

function deps(overrides: Partial<ProfileDeps> = {}): ProfileDeps & { calls: Record<string, unknown>[]; loads: string[] } {
  const calls: Record<string, unknown>[] = [];
  const loads: string[] = [];
  return {
    calls,
    loads,
    invoke: async (payload) => {
      calls.push(payload);
      return LAMBDA_OK;
    },
    loadRoster: async () => {
      loads.push("roster");
      return { rows: [{ pcid: "P000123456", currentsport: "Ultimate Frisbee" }], asOf: "2026-09-23" };
    },
    loadHousing: async () => {
      loads.push("housing");
      throw new Error("S3 exploded with student rows");
    },
    loadCensus: async () => {
      loads.push("census");
      return null;
    },
    ...overrides,
  };
}

describe("buildProfileResponse", () => {
  it("invokes action profile and joins sources, isolating a failing source", async () => {
    const d = deps();
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const result = await buildProfileResponse({ callerEmail: CALLER, studentKey: KEY, deps: d });
      assert.deepEqual(d.calls, [{ action: "profile", callerEmail: CALLER, studentKey: KEY }]);
      assert.equal(result.status, 200);
      assert.ok("profile" in result.body && result.body.profile);
      const profile = result.body.profile;
      assert.equal(profile.identity.pcid, "P000123456");
      assert.deepEqual(profile.associations.athletics?.sports, ["Ultimate Frisbee"]);
      assert.equal(profile.associationStatus.housing, "unavailable");
      assert.equal(profile.associationStatus.census, "unavailable");
      assert.equal(profile.notes.length, 1);
      assert.equal(profile.pulse?.band, "attending");
    } finally {
      console.warn = warn;
    }
  });

  it("returns 503 not enabled when the deployed Lambda rejects the action", async () => {
    const result = await buildProfileResponse({
      callerEmail: CALLER,
      studentKey: KEY,
      deps: deps({
        invoke: async () => {
          throw new Error('Processor error: {"errorMessage":"unsupported action","stack":"..."}');
        },
      }),
    });
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: PROFILE_UNAVAILABLE });
  });

  it("returns 403 when the Lambda allowlist denies the caller", async () => {
    const result = await buildProfileResponse({
      callerEmail: CALLER,
      studentKey: KEY,
      deps: deps({
        invoke: async () => {
          throw new Error("Processor error: caller is not authorized for AspireDU student records");
        },
      }),
    });
    assert.equal(result.status, 403);
  });

  it("never echoes a raw Lambda error", async () => {
    const error = console.error;
    console.error = () => undefined;
    try {
      const result = await buildProfileResponse({
        callerEmail: CALLER,
        studentKey: KEY,
        deps: deps({
          invoke: async () => {
            throw new Error("Processor error: Jane Doe grade 42");
          },
        }),
      });
      assert.equal(result.status, 503);
      assert.equal(JSON.stringify(result.body).includes("Jane"), false);
    } finally {
      console.error = error;
    }
  });

  it("returns 404 for not_found and skips loading sources", async () => {
    const d = deps({ invoke: async () => ({ ok: true, status: "not_found", student: null }) });
    const result = await buildProfileResponse({ callerEmail: CALLER, studentKey: KEY, deps: d });
    assert.equal(result.status, 404);
    assert.deepEqual(d.loads, []);
  });

  it("passes awaiting_first_delivery through", async () => {
    const d = deps({ invoke: async () => ({ ok: true, status: "awaiting_first_delivery", student: null }) });
    const result = await buildProfileResponse({ callerEmail: CALLER, studentKey: KEY, deps: d });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, status: "awaiting_first_delivery", profile: null });
    assert.deepEqual(d.loads, []);
  });
});
