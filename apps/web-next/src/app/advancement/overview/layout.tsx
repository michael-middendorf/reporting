"use client";

import { AccessGate } from "@/components/AccessGate";

export default function AdvancementOverviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="advancement">{children}</AccessGate>;
}
