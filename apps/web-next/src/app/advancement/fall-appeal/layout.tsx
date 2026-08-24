"use client";

import { AccessGate } from "@/components/AccessGate";

export default function FallAppealLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="advancement">{children}</AccessGate>;
}
