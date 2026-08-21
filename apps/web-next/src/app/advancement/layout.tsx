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
        nav={[{ href: "/annunciation", label: "Annunciation Circle" }]}
      />
      {children}
    </AccessGate>
  );
}
