"use client";

import { useEffect, useRef } from "react";

type Props = {
  bodyHtml: string;
  /** Dynamic import of a module that bootstraps against the mounted DOM. */
  boot: () => Promise<unknown>;
  /** Rewrite legacy relative hrefs before mount. */
  rewriteHtml?: (html: string) => string;
};

/**
 * Mounts legacy markup then dynamically imports a bundled ES module boot script.
 */
export function LegacyModuleMount({ bodyHtml, boot, rewriteHtml }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    el.innerHTML = rewriteHtml ? rewriteHtml(bodyHtml) : bodyHtml;
    // Allow DOM to settle, then boot the report module.
    const t = window.setTimeout(() => {
      if (cancelled) return;
      boot().catch((err) => {
        console.error("Report boot failed", err);
        el.insertAdjacentHTML(
          "afterbegin",
          `<p style="padding:1rem;color:#a00">Failed to start report: ${String(err)}</p>`,
        );
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      el.innerHTML = "";
    };
  }, [bodyHtml, boot, rewriteHtml]);

  return <div ref={ref} className="legacy-report-root" />;
}
