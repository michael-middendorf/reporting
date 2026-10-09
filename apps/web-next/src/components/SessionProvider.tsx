"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { AuthMe } from "@/lib/api";
import { createSessionWatcher, readSession, watchVisibleSession, isReportingPublicAuthPath } from "@/lib/session-lifecycle";

const SessionContext = createContext<AuthMe | null>(null);
export function useCurrentSession() { return useContext(SessionContext); }

export function SessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<AuthMe | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const watcher = createSessionWatcher({
      requireAuth: (path) => !isReportingPublicAuthPath(path),
      read: readSession, update: setMe, location: () => window.location,
      hide: () => setExpired(true), redirect: (url) => window.location.replace(url),
    });
    const refresh = () => { void watcher.refresh(); };
    refresh();
    const stop = watchVisibleSession(refresh, window, document, {
      every: (callback, ms) => window.setInterval(callback, ms),
      cancel: (timer) => window.clearInterval(timer as number),
    });
    return () => { watcher.dispose(); stop(); };
  }, []);
  return <SessionContext.Provider value={me}>{expired || (me?.authenticated === false && !isReportingPublicAuthPath(pathname)) ? null : children}</SessionContext.Provider>;
}
