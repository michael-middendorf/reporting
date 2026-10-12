import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionToken } from "../../../lib/auth";
import type { TyLettersSnapshot } from "../../../lib/reports/ty-letters/shape";
import { sentStore, type SentFlag } from "../../../lib/reports/ty-letters/sent-store";
import { POST } from "../ty-letters-sent/route";
import { GET, tyLettersCache } from "./route";


const SECRET = "ty-letters-route-test-secret";
const ALLOWED = ["julie.musselman@avemaria.edu", "mark.middendorf@avemaria.edu"];
const DENIED = [
  "cole.j.cantu@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
  "becca.kennedy@avemaria.edu",
];
const env = process.env as Record<string, string | undefined>;

const SNAP: TyLettersSnapshot = {
  generatedAt: "2026-10-12T10:00:00Z",
  windowStart: "2026-08-13",
  windowEnd: "2026-10-12",
  minAmount: 1000,
  partial: false,
  pending: 0,
  cards: [
    {
      giftId: "1001",
      giftDate: "2026-10-10",
      amount: 5000,
      donorContactId: "1001",
      donorName: "Test Donor",
      solicitor: "",
      salutation: "",
      addressee: "",
      addressLines: [],
      cellPhone: "",
      homePhone: "",
      anonymous: false,
      rows: { latest: null, secondLatest: null, largest: null, first: null },
      totalGiving: 5000,
      batch: null,
    },
  ],
};

const realStore = { ...sentStore };
const realCache = { ...tyLettersCache };
let prev: Record<string, string | undefined> = {};
let writes: { giftId: string; sent: boolean; email: string }[] = [];

beforeEach(() => {
  prev = { AUTH_SECRET: env.AUTH_SECRET, TY_LETTER_SENT_TABLE: env.TY_LETTER_SENT_TABLE };
  env.AUTH_SECRET = SECRET;
  env.TY_LETTER_SENT_TABLE = "amu-reporting-ty-letter-sent";
  writes = [];
  Object.assign(tyLettersCache, { read: async () => structuredClone(SNAP) });
  Object.assign(sentStore, {
    getMany: async (ids: string[]) =>
      new Map<string, SentFlag>(
        ids.map((giftId) => [giftId, { giftId, sent: true, sentBy: "julie.musselman@avemaria.edu", sentAt: "2026-10-11T12:00:00.000Z" }]),
      ),
    setSent: async (giftId: string, sent: boolean, email: string): Promise<SentFlag> => {
      writes.push({ giftId, sent, email });
      return { giftId, sent, sentBy: sent ? email : null, sentAt: sent ? "now" : null };
    },
  });
});

afterEach(() => {
  Object.assign(sentStore, realStore);
  Object.assign(tyLettersCache, realCache);
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

function req(email: string | null, init: { method?: string; body?: unknown; type?: string } = {}) {
  const headers = new Headers({ "content-type": init.type ?? "application/json" });
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(
    `https://reporting.avemaria.edu/api/${init.method === "POST" ? "ty-letters-sent" : "ty-letters-data"}`,
    {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    },
  );
}

describe("GET /api/ty-letters-data", () => {
  it("401 without a session", async () => {
    assert.equal((await GET(req(null))).status, 401);
  });

  it("403 for Advancement and admin users off the strict list", async () => {
    for (const email of DENIED) assert.equal((await GET(req(email))).status, 403, email);
  });

  it("200 with Sent flags merged and no-store caching for the strict list", async () => {
    for (const email of ALLOWED) {
      const res = await GET(req(email));
      assert.equal(res.status, 200, email);
      assert.match(res.headers.get("cache-control") || "", /no-store/);
      const body = (await res.json()) as TyLettersSnapshot;
      assert.equal(body.cards[0]?.sent, true);
      assert.equal(body.cards[0]?.sentBy, "julie.musselman@avemaria.edu");
    }
  });

  it("503 when no snapshot is published", async () => {
    Object.assign(tyLettersCache, { read: async () => null });
    assert.equal((await GET(req(ALLOWED[0]))).status, 503);
  });
});

describe("POST /api/ty-letters-sent", () => {
  const OK = { giftId: "1001", sent: true };

  it("401 without a session", async () => {
    assert.equal((await POST(req(null, { method: "POST", body: OK }))).status, 401);
    assert.equal(writes.length, 0);
  });

  it("403 for users off the strict list", async () => {
    for (const email of DENIED) {
      assert.equal((await POST(req(email, { method: "POST", body: OK }))).status, 403, email);
    }
    assert.equal(writes.length, 0);
  });

  it("200 records the session email for the strict list", async () => {
    for (const email of ALLOWED) {
      const res = await POST(req(email, { method: "POST", body: OK }));
      assert.equal(res.status, 200, email);
      const flag = (await res.json()) as SentFlag;
      assert.equal(flag.sentBy, email);
    }
    assert.deepEqual(writes.map((w) => w.email), ALLOWED);
    const clear = await POST(req(ALLOWED[0], { method: "POST", body: { giftId: "1001", sent: false } }));
    assert.equal(clear.status, 200);
    assert.equal(writes.at(-1)?.sent, false);
  });

  it("rejects bad gift ids, bad sent values, and non-JSON bodies", async () => {
    const bad: unknown[] = [
      { giftId: "12a", sent: true },
      { giftId: "", sent: true },
      { giftId: "1".repeat(21), sent: true },
      { giftId: 1001, sent: true },
      { giftId: "../1001", sent: true },
      { giftId: "1001", sent: "yes" },
      { giftId: "1001" },
      "not json",
    ];
    for (const body of bad) {
      assert.equal((await POST(req(ALLOWED[0], { method: "POST", body }))).status, 400, JSON.stringify(body));
    }
    const form = await POST(req(ALLOWED[0], { method: "POST", body: OK, type: "application/x-www-form-urlencoded" }));
    assert.equal(form.status, 400);
    assert.equal(writes.length, 0);
  });

  it("404 for a gift id that is not on the published cards", async () => {
    const res = await POST(req(ALLOWED[0], { method: "POST", body: { giftId: "9999", sent: true } }));
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: string }).error, "Unknown gift");
    assert.equal(writes.length, 0);
  });

  it("503 when no snapshot is published", async () => {
    Object.assign(tyLettersCache, { read: async () => null });
    assert.equal((await POST(req(ALLOWED[0], { method: "POST", body: OK }))).status, 503);
    assert.equal(writes.length, 0);
  });

  it("503 when the table is not configured", async () => {
    delete env.TY_LETTER_SENT_TABLE;
    assert.equal((await POST(req(ALLOWED[0], { method: "POST", body: OK }))).status, 503);
  });
});
