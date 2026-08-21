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
          { href: "/annunciation", label: "Annunciation Circle" },
          { href: "/advancement/chapel-naming", label: "Chapel Naming" },
        ]}
      />
      {children}
    </AccessGate>
  );
}
