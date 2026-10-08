import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionToken } from "../../../lib/auth";
import type { RiskItem } from "../../../lib/cyber/register";
import { RegisterConflictError, registerStore } from "../../../lib/cyber/register-store";
import { GET as getData, cyberDataSource } from "../cybersecurity-data/route";
import { GET, PATCH, POST } from "./route";

const SECRET = "cyber-register-route-test-secret";
const KEITH = "keith.brooks@avemaria.edu";
const COLE = "cole.j.cantu@avemaria.edu";
const BASE = "https://reporting.avemaria.edu/api/cybersecurity-register";
const env = process.env as Record<string, string | undefined>;

const STORED: RiskItem = {
  id: "risk-example-a",
  title: "Example risk A",
  category: "governance",
  likelihood: 4,
  impact: 3,
  owner: "Example Owner",
  treatment: "mitigate",
  dueDate: null,
  status: "open",
  kpiId: null,
  acceptedExpiry: null,
  notes: "",
  source: "test",
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
  updatedBy: "seed-script",
  version: 1,
};

const realStore = { ...registerStore };
const realData = { ...cyberDataSource };
let prev: Record<string, string | undefined> = {};
let writes: { op: string; by: string; input: unknown }[] = [];

beforeEach(() => {
  prev = { AUTH_SECRET: env.AUTH_SECRET, CYBER_REGISTER_TABLE: env.CYBER_REGISTER_TABLE };
  env.AUTH_SECRET = SECRET;
  env.CYBER_REGISTER_TABLE = "amu-reporting-cyber-register";
  writes = [];
  Object.assign(registerStore, {
    list: async () => ({ risks: [STORED], kpis: [] }),
    history: async () => [],
    get: async (_k: string, id: string) => (id === STORED.id ? STORED : null),
    create: async (_k: string, input: { id: string }, by: string) => {
      if (input.id === STORED.id) throw new RegisterConflictError("exists");
      writes.push({ op: "create", by, input });
      return { ...input, version: 1 };
    },
    update: async (_k: string, before: RiskItem, input: unknown, by: string) => {
      writes.push({ op: "update", by, input });
      return { ...(input as object), version: before.version + 1 };
    },
  });
});

afterEach(() => {
  Object.assign(registerStore, realStore);
  Object.assign(cyberDataSource, realData);
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

function req(
  email: string | null,
  init: { method?: string; body?: unknown; auth?: "entra" | "magic"; path?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (email) {
    headers.set(
      "Authorization",
      `Bearer ${createSessionToken(email, SECRET, 14, { auth: init.auth ?? "entra" })}`,
    );
  }
  return new Request(init.path ?? BASE, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("/api/cybersecurity-register auth", () => {
  it("401 without a session, 403 for an admin off the strict list, 403 reauth for magic", async () => {
    assert.equal((await GET(req(null))).status, 401);
    assert.equal((await GET(req(COLE))).status, 403);
    const magic = await GET(req(KEITH, { auth: "magic" }));
    assert.equal(magic.status, 403);
    assert.equal(((await magic.json()) as { error: string }).error, "reauth_microsoft");
  });

  it("200 list for Keith with a fresh Microsoft session", async () => {
    const res = await GET(req(KEITH));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { risks: RiskItem[] };
    assert.equal(body.risks[0]?.id, STORED.id);
  });

  it("503 when CYBER_REGISTER_TABLE is not set", async () => {
    delete env.CYBER_REGISTER_TABLE;
    assert.equal((await GET(req(KEITH))).status, 503);
  });

  it("writes are refused for a magic-link session", async () => {
    const res = await POST(req(KEITH, { method: "POST", auth: "magic", body: { kind: "risk", item: {} } }));
    assert.equal(res.status, 403);
    assert.equal(writes.length, 0);
  });
});

describe("/api/cybersecurity-register writes", () => {
  const NEW = { ...STORED, id: "risk-new-thing", title: "New thing" } as Record<string, unknown>;
  for (const k of ["createdAt", "updatedAt", "updatedBy", "version"]) delete NEW[k];

  it("POST validates strictly", async () => {
    const bad = await POST(req(KEITH, { method: "POST", body: { kind: "risk", item: { ...NEW, impact: 9 } } }));
    assert.equal(bad.status, 400);
    const kind = await POST(req(KEITH, { method: "POST", body: { kind: "other", item: NEW } }));
    assert.equal(kind.status, 400);
    assert.equal(writes.length, 0);
  });

  it("POST requires application/json", async () => {
    const r = new Request(BASE, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        Authorization: `Bearer ${createSessionToken(KEITH, SECRET, 14, { auth: "entra" })}`,
      },
      body: JSON.stringify({ kind: "risk", item: NEW }),
    });
    assert.equal((await POST(r)).status, 400);
  });

  it("POST creates with the session email as author; 409 on duplicate id", async () => {
    const ok = await POST(req(KEITH, { method: "POST", body: { kind: "risk", item: NEW } }));
    assert.equal(ok.status, 201);
    assert.deepEqual(writes.map((w) => [w.op, w.by]), [["create", KEITH]]);
    const dup = await POST(req(KEITH, { method: "POST", body: { kind: "risk", item: { ...NEW, id: STORED.id } } }));
    assert.equal(dup.status, 409);
  });

  it("PATCH merges, re-validates, and checks version", async () => {
    const stale = await PATCH(
      req(KEITH, { method: "PATCH", body: { kind: "risk", id: STORED.id, version: 0, changes: { status: "in_progress" } } }),
    );
    assert.equal(stale.status, 409);
    const missing = await PATCH(
      req(KEITH, { method: "PATCH", body: { kind: "risk", id: "risk-nope", version: 1, changes: {} } }),
    );
    assert.equal(missing.status, 404);
    const invalid = await PATCH(
      req(KEITH, { method: "PATCH", body: { kind: "risk", id: STORED.id, version: 1, changes: { status: "accepted" } } }),
    );
    assert.equal(invalid.status, 400);
    const rename = await PATCH(
      req(KEITH, { method: "PATCH", body: { kind: "risk", id: STORED.id, version: 1, changes: { id: "risk-other" } } }),
    );
    assert.equal(rename.status, 400);
    const ok = await PATCH(
      req(KEITH, { method: "PATCH", body: { kind: "risk", id: STORED.id, version: 1, changes: { status: "in_progress" } } }),
    );
    assert.equal(ok.status, 200);
    assert.equal(writes.length, 1);
    assert.equal((writes[0]!.input as RiskItem).status, "in_progress");
    assert.equal((writes[0]!.input as RiskItem).title, STORED.title);
  });
});

describe("/api/cybersecurity-data", () => {
  it("503 No data published yet when latest.json is missing", async () => {
    Object.assign(cyberDataSource, { readLatest: async () => null, listHistory: async () => [] });
    const res = await getData(req(KEITH, { path: "https://reporting.avemaria.edu/api/cybersecurity-data" }));
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { message: string }).message, "No data published yet.");
  });

  it("200 with snapshot and history; 403 for Cole", async () => {
    let reads = 0;
    Object.assign(cyberDataSource, {
      readLatest: async () => {
        reads++;
        return { generatedAt: "2026-10-08T09:00:00Z", kpis: [] };
      },
      listHistory: async () => ["2026-10-01"],
    });
    const denied = await getData(req(COLE, { path: "https://reporting.avemaria.edu/api/cybersecurity-data" }));
    assert.equal(denied.status, 403);
    assert.equal(reads, 0);
    const res = await getData(req(KEITH, { path: "https://reporting.avemaria.edu/api/cybersecurity-data" }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { history: string[] };
    assert.deepEqual(body.history, ["2026-10-01"]);
  });
});
