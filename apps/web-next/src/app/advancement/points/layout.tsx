"use client";

import { AccessGate } from "@/components/AccessGate";

export default function PointsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="points">{children}</AccessGate>;
}
