"use client";

import { AccessGate } from "@/components/AccessGate";

export default function MgoTopProspectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="advancement">{children}</AccessGate>;
}
