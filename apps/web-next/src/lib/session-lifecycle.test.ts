import { test } from "node:test";
import assert from "node:assert/strict";
import { completeSessionSignIn, createSessionWatcher, readSession, watchVisibleSession, isReportingPublicAuthPath } from "./session-lifecycle";
import { createSessionToken } from "./auth";
import { GET } from "../app/api/auth/me/route";
import { readFileSync } from "node:fs";

test("actual auth endpoint deletes only its own cookie and preserves a fresh cookie when bearer is rejected", async () => {
  const old = { secret: process.env.AUTH_SECRET, flag: process.env.SSO_ONLY, node: process.env.NODE_ENV };
  Object.assign(process.env, { AUTH_SECRET: "synthetic-session-test-secret-32characters", SSO_ONLY: "false", NODE_ENV: "production" });
  try {
    const requests: Record<string, string>[] = [{ cookie: "amu_reporting_session=invalid; session_token=unrelated; amu_reporting_mfa_pending=ongoing; amu_aspiredu_mfa=ongoing" }, { authorization: "Bearer invalid", cookie: "amu_reporting_session=fresh" }];
    for (const headers of requests) {
      const response = await GET(new Request("https://reporting.avemaria.edu/api/auth/me", { headers }));
      assert.equal(response.status, 401);
      const cookie = response.headers.get("set-cookie");
      if ("authorization" in headers) assert.equal(cookie, null);
      else { assert.match(cookie!, /^amu_reporting_session=;/); assert.doesNotMatch(cookie!, /Domain=|(?:^|; )session_token=|amu_reporting_mfa_pending=|amu_aspiredu_mfa=/i); }
    }
    const token = createSessionToken("test@example.invalid", process.env.AUTH_SECRET!, 1, { auth: "entra", mfa: true });
    const fresh = await GET(new Request("https://reporting.avemaria.edu/api/auth/me", { headers: { cookie: `amu_reporting_session=${token}` } }));
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get("set-cookie"), null);
    delete process.env.AUTH_SECRET;
    const unavailable = await GET(new Request("https://reporting.avemaria.edu/api/auth/me"));
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("set-cookie"), null);
  } finally {
    for (const [key, value] of Object.entries({ AUTH_SECRET: old.secret, SSO_ONLY: old.flag, NODE_ENV: old.node })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("actual browser transport retries stale bearer on cookie and preserves outages", async (t) => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  let bearer: string | null = "stale";
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: { getItem: () => bearer, removeItem: () => { bearer = null; } }, configurable: true });
  t.after(() => {
    for (const [name, descriptor] of [["window", windowDescriptor], ["sessionStorage", storageDescriptor]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  });
  let calls = 0;
  const mocked = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    calls++;
    assert.equal(init?.cache, "no-store");
    return new Headers(init?.headers).has("authorization") ? new Response(null, { status: 401 }) : Response.json({ authenticated: true, email: "test@example.invalid" });
  });
  assert.equal((await readSession())?.authenticated, true);
  assert.equal(calls, 2);
  assert.equal(bearer, null);
  mocked.mock.restore();
  for (const status of [403, 500, 503]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    assert.equal(await readSession(), null);
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  assert.equal(await readSession(), null);
});

test("previously signed-in UI expires only on confirmed logout and retains current path query", async () => {
  let next: { authenticated: boolean; email?: string } | null = { authenticated: true, email: "test@example.invalid" };
  let hidden = 0;
  const redirects: string[] = [];
  const states: unknown[] = [];
  const watcher = createSessionWatcher({ read: async () => next, update: (me) => { states.push(me); },
    location: () => ({ pathname: "/ac", search: "?tab=tasks" }), hide: () => { hidden++; }, redirect: (url) => { redirects.push(url); } });
  await watcher.refresh();
  next = null;
  await watcher.refresh();
  assert.equal(states.length, 1);
  assert.equal(hidden, 0);
  next = { authenticated: false };
  await watcher.refresh();
  await watcher.refresh();
  assert.equal(hidden, 1);
  assert.deepEqual(redirects, ["/login?next=%2Fac%3Ftab%3Dtasks"]);
});

test("anonymous and login pages do not loop; disposed/in-flight watchers are bounded", async () => {
  for (const pathname of ["/", "/login", "/auth/microsoft-complete", "/auth/mfa"]) {
    let state = { authenticated: pathname !== "/" };
    const watcher = createSessionWatcher({ read: async () => state, update: () => {}, location: () => ({ pathname, search: "" }),
      hide: () => { throw new Error("must not hide public anonymous/login pages"); }, redirect: () => { throw new Error("must not redirect"); } });
    await watcher.refresh(); state = { authenticated: false }; await watcher.refresh();
  }
  let done!: (value: null) => void;
  let calls = 0;
  const watcher = createSessionWatcher({ read: () => { calls++; return new Promise<null>((resolve) => { done = resolve; }); },
    update: () => { throw new Error("disposed"); }, location: () => ({ pathname: "/ac", search: "" }), hide: () => {}, redirect: () => {} });
  const pending = watcher.refresh(); await watcher.refresh(); assert.equal(calls, 1);
  watcher.dispose(); done(null); await pending;
});

test("visible 30s heartbeat/focus and visibility listeners stop on cleanup", () => {
  const browser = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let tick = () => {}; let count = 0; let canceled = false;
  const stop = watchVisibleSession(() => { count++; }, browser, document, {
    every: (callback, ms) => { assert.equal(ms, 30_000); tick = callback; return "timer"; },
    cancel: (timer) => { assert.equal(timer, "timer"); canceled = true; },
  });
  tick(); browser.dispatchEvent(new Event("focus")); assert.equal(count, 2);
  document.visibilityState = "hidden"; tick(); document.dispatchEvent(new Event("visibilitychange")); assert.equal(count, 2);
  document.visibilityState = "visible"; document.dispatchEvent(new Event("visibilitychange")); assert.equal(count, 3);
  stop(); browser.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); assert.equal(count, 3); assert.equal(canceled, true);
});

test("cookie-mint completion document navigation preserves destination and discards stale provider state", () => {
  const paths: string[] = [];
  completeSessionSignIn("/auth/mfa?next=budget", (path) => paths.push(path));
  completeSessionSignIn("//outside.invalid", (path) => paths.push(path));
  assert.deepEqual(paths, ["/auth/mfa?next=budget", "/"]);
  const source = readFileSync("src/app/auth/magic/page.tsx", "utf8");
  assert.match(source, /completeSessionSignIn\(dest, \(path\) => window\.location\.replace\(path\)\)/);
  assert.doesNotMatch(source, /router\.replace/);
});

test("first rejected private verification hides existing private content while auth/MFA pages never loop",async()=>{
 for(const pathname of ["/enrollment","/athletics/coaching","/advancement"]) {
  let hidden=0;const urls:string[]=[];let next:{authenticated:boolean}|null=null;
  const watcher=createSessionWatcher({read:async()=>next,update:()=>{},location:()=>({pathname,search:"?view=current"}),hide:()=>{hidden++;},redirect:url=>urls.push(url),requireAuth:path=>!isReportingPublicAuthPath(path)});
  await watcher.refresh();assert.equal(hidden,0,"outage must retain private UI");
  next={authenticated:false};await watcher.refresh();assert.equal(hidden,1);
  assert.deepEqual(urls,["/login?next="+encodeURIComponent(pathname+"?view=current")]);
 }
 for(const pathname of ["/","/login","/auth/mfa","/athletics/coaching/mfa","/aspiredu/mfa"]) {
  const watcher=createSessionWatcher({read:async()=>({authenticated:false}),update:()=>{},location:()=>({pathname,search:""}),hide:()=>{throw Error("public hide");},redirect:()=>{throw Error("loop");},requireAuth:path=>!isReportingPublicAuthPath(path)});
  await watcher.refresh();
 }
 const provider=readFileSync("src/components/SessionProvider.tsx","utf8");
 assert.match(provider,/requireAuth:.*!isReportingPublicAuthPath/);
 assert.match(provider,/me\?\.authenticated === false && !isReportingPublicAuthPath/);
});
