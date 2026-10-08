"use client";
import { useSyncExternalStore } from "react";
function subscribeSearch(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
export function SsoLogin({ enabled, href, returnParam = "from" }: { enabled: boolean; href: string; returnParam?: string }) {
  const search = useSyncExternalStore(subscribeSearch, () => window.location.search, () => "");
  const query = new URLSearchParams(search);
  const path = query.get("callbackUrl") ?? query.get("from") ?? query.get("next") ?? query.get("returnTo");
  const safe = path?.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(path);
  const destination = safe ? href + "?" + returnParam + "=" + encodeURIComponent(path!) : href;
  const failed = query.get("microsoft") === "failed" || !!query.get("error");
  return <main className="mx-auto max-w-md px-6 py-20">
    <h1 className="text-2xl font-semibold">Sign in</h1>
    <p className="mt-4">Use your Ave Maria University Microsoft account.</p>
    {failed && <p role="alert" className="mt-4">Microsoft sign-in did not complete. Please try again.</p>}
    {enabled ? <a className="mt-6 block rounded bg-blue-900 px-4 py-3 text-center font-semibold text-white" href={destination}>Sign in with Microsoft</a>
      : <p role="alert" className="mt-6">Microsoft sign-in is temporarily unavailable. Please contact IT.</p>}
  </main>;
}
