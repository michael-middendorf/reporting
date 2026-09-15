"use client";

import { AccessGate } from "@/components/AccessGate";

export default function PortfoliosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="portfolios">{children}</AccessGate>;
}
