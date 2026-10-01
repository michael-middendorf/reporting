"use client";

import { AccessGate } from "@/components/AccessGate";

export default function MgoAnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="mgo-analysis">{children}</AccessGate>;
}
