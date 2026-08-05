"use client";

import { useEffect, useRef } from "react";

type Props = {
  bodyHtml: string;
  /** Classic non-module inline script (enrollment / housing). */
  scriptText?: string;
};

/**
 * Mounts legacy report markup and runs its classic script against the live DOM.
 * Used while report logic is still the ported original JS (exact UI/behavior).
 */
export function LegacyHtmlMount({ bodyHtml, scriptText }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = bodyHtml;

    let scriptEl: HTMLScriptElement | null = null;
    if (scriptText) {
      scriptEl = document.createElement("script");
      scriptEl.text = scriptText;
      document.body.appendChild(scriptEl);
    }

    return () => {
      if (scriptEl?.parentNode) scriptEl.parentNode.removeChild(scriptEl);
      el.innerHTML = "";
    };
  }, [bodyHtml, scriptText]);

  return <div ref={ref} className="legacy-report-root" />;
}
