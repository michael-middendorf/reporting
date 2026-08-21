"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";

export default function AdvancementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AccessGate report="advancement">
      <ReportTopBar
        title="Advancement"
        nav={[
          { href: "/advancement/overview", label: "Overview" },
          { href: "/advancement/mgo-top-prospects", label: "MGO Top Prospects" },
          { href: "/annunciation", label: "Annunciation Circle" },
          { href: "/advancement/chapel-naming", label: "Chapel Naming" },
        ]}
      />
      {children}
    </AccessGate>
  );
}
