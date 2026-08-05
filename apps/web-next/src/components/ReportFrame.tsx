"use client";

import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/api";

type Props = {
  src: string;
  title: string;
};

/** Auth-gated full-viewport frame of a copied report (exact legacy UI/behavior). */
export function ReportFrame({ src, title }: Props) {
  const [ok, setOk] = useState(false);

  useEffect(() => {
    fetchMe().then((me) => {
      if (!me.authenticated) {
        const next = encodeURIComponent(window.location.pathname);
        window.location.href = `/login?next=${next}`;
        return;
      }
      setOk(true);
    });
  }, []);

  if (!ok) {
    return (
      <div style={{ minHeight: "40vh", display: "grid", placeItems: "center", color: "#4a6a90" }}>
        Checking session…
      </div>
    );
  }

  return (
    <iframe
      src={src}
      title={title}
      style={{ border: 0, width: "100vw", height: "100vh", display: "block" }}
    />
  );
}
