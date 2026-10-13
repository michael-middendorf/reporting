"use client";

import { AccessGate } from "@/components/AccessGate";

export default function GalaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="gala">{children}</AccessGate>;
}
