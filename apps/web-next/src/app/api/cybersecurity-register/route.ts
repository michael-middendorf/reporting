import { NextResponse } from "next/server";
import { requireCyberAccess } from "@/lib/cyber-access";
import {
  inputFields,
  parseKind,
  validateInput,
} from "@/lib/cyber/register";
import {
  RegisterConflictError,
  registerStore,
  registerTableName,
} from "@/lib/cyber/register-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function notConfigured() {
  return json({ error: "not_configured", message: "The risk register is not configured." }, 503);
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  // Defense in depth on top of SameSite=Lax: a cross-site HTML form cannot send
  // application/json, so writes require it.
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) return null;
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function logWrite(email: string, action: string, kind: string, id: string) {
  console.log(
    JSON.stringify({ evt: "cyber_register_write", email, action, kind, id, ts: new Date().toISOString() }),
  );
}

/**
 * GET: { risks, kpis }. GET ?history=<id>: that item's last 50 history rows.
 */
export async function GET(req: Request) {
  const access = requireCyberAccess(req);
  if (!access.ok) return access.response;
  if (!registerTableName()) return notConfigured();

  const historyId = new URL(req.url).searchParams.get("history");
  if (historyId !== null) {
    if (!ID_RE.test(historyId)) return json({ error: "Invalid id" }, 400);
    return json({ history: await registerStore.history(historyId) });
  }
  return json(await registerStore.list());
}

/** POST { kind: "risk"|"kpi", item: {...} }: create. 409 if the id exists. */
export async function POST(req: Request) {
  const access = requireCyberAccess(req);
  if (!access.ok) return access.response;
  if (!registerTableName()) return notConfigured();

  const body = await readJson(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const kind = parseKind(body.kind);
  if (!kind) return json({ error: "kind must be risk or kpi" }, 400);
  const v = validateInput(kind, body.item);
  if (!v.ok) return json({ error: "Invalid item", details: v.errors }, 400);

  try {
    const item = await registerStore.create(kind, v.value, access.email);
    logWrite(access.email, "create", kind, v.value.id);
    return json({ item }, 201);
  } catch (e) {
    if (e instanceof RegisterConflictError) return json({ error: e.message }, 409);
    throw e;
  }
}

/**
 * PATCH { kind, id, version, changes: {...} }: merge changes onto the stored
 * record, re-validate the whole record, write it with a version check.
 * 404 unknown id, 409 when someone else saved first.
 */
export async function PATCH(req: Request) {
  const access = requireCyberAccess(req);
  if (!access.ok) return access.response;
  if (!registerTableName()) return notConfigured();

  const body = await readJson(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const kind = parseKind(body.kind);
  if (!kind) return json({ error: "kind must be risk or kpi" }, 400);
  const id = typeof body.id === "string" ? body.id : "";
  if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    return json({ error: "version is required" }, 400);
  }
  const changes = body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return json({ error: "changes must be an object" }, 400);
  }
  if ("id" in changes && (changes as Record<string, unknown>).id !== id) {
    return json({ error: "id cannot be changed" }, 400);
  }

  const before = await registerStore.get(kind, id);
  if (!before) return json({ error: "Not found" }, 404);
  if (before.version !== body.version) {
    return json({ error: "This item changed since it was loaded. Reload and try again." }, 409);
  }

  const merged = { ...inputFields(before), ...changes, id };
  const v = validateInput(kind, merged);
  if (!v.ok) return json({ error: "Invalid item", details: v.errors }, 400);

  try {
    const item = await registerStore.update(kind, before, v.value, access.email);
    logWrite(access.email, "update", kind, id);
    return json({ item });
  } catch (e) {
    if (e instanceof RegisterConflictError) return json({ error: e.message }, 409);
    throw e;
  }
}
