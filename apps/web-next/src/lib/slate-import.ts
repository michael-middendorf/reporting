/**
 * Slate Source Format delivery (same path as student-portal-3).
 * POST JSON to /manage/service/import?cmd=load&format=<GUID>.
 * Failures are returned, never thrown: callers persist locally first.
 */
export async function postSlateImport(
  url: string | undefined,
  payload: Record<string, unknown>,
  tag: string,
): Promise<{ ok: boolean; skipped: boolean; status?: number; body?: string }> {
  if (!url) {
    console.log("[slate-import:%s] no import URL configured, skipped", tag);
    return { ok: true, skipped: true };
  }
  const user = process.env.SLATE_USERNAME;
  const pass = process.env.SLATE_PASSWORD;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (user && pass) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = (await res.text()).slice(0, 500);
    if (!res.ok) {
      console.error("[slate-import:%s] HTTP %s: %s", tag, res.status, text);
      return { ok: false, skipped: false, status: res.status, body: text };
    }
    console.log("[slate-import:%s] HTTP %s OK: %s", tag, res.status, text);
    return { ok: true, skipped: false, status: res.status, body: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[slate-import:%s] transport failure: %s", tag, msg);
    return { ok: false, skipped: false, body: msg };
  }
}
