"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { CYBERSECURITY_NAV } from "@/lib/report-nav";

/**
 * Browser-side gate only (hides the shell). The real check is
 * requireCyberAccess on every /api/cybersecurity-* route.
 */
export default function CyberShell({ children }: { children: React.ReactNode }) {
  return (
    <AccessGate report="cybersecurity">
      <ReportTopBar title="Cybersecurity" nav={CYBERSECURITY_NAV} />
      {children}
    </AccessGate>
  );
}
