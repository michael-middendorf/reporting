import { readAuthSession, type AuthMe } from "@/lib/api";
import { safeLocalPath } from "@/lib/safe-local-path";
export const readSession = readAuthSession;
export function isReportingPublicAuthPath(pathname: string) {
  return pathname === "/" || pathname === "/login" || pathname.startsWith("/auth/") ||
    pathname === "/athletics/coaching/mfa" || pathname === "/aspiredu/mfa";
}

/** Cookie minting requires a document navigation to discard old provider state. */
export function completeSessionSignIn(destination: string | null, navigateDocument: (path: string) => void) {
  navigateDocument(safeLocalPath(destination));
}

export function createSessionWatcher(deps: {
  read: () => Promise<AuthMe | null>;
  update: (me: AuthMe) => void;
  location: () => { pathname: string; search: string };
  hide: () => void;
  redirect: (url: string) => void;
  requireAuth?: (pathname: string) => boolean;
}) {
  let authenticated = false;
  let pending = false;
  let disposed = false;
  let expired = false;
  return {
    async refresh() {
      if (pending || disposed || expired) return;
      pending = true;
      try {
        const me = await deps.read();
        if (!me || disposed) return;
        deps.update(me);
        const location = deps.location();
        if (!me.authenticated && (authenticated || deps.requireAuth?.(location.pathname)) && (location.pathname === "/" || !isReportingPublicAuthPath(location.pathname))) {
          expired = true;
          deps.hide();
          deps.redirect(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        }
        if (me.authenticated) authenticated = true;
      } finally { pending = false; }
    },
    dispose() { disposed = true; },
  };
}

export function watchVisibleSession(refresh: () => void, browser: EventTarget, document: EventTarget & { visibilityState: string }, timers: {
  every: (callback: () => void, ms: number) => unknown; cancel: (timer: unknown) => void;
}) {
  const tick = () => { if (document.visibilityState === "visible") refresh(); };
  const timer = timers.every(tick, 30_000);
  browser.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  return () => {
    timers.cancel(timer);
    browser.removeEventListener("focus", tick);
    document.removeEventListener("visibilitychange", tick);
  };
}
