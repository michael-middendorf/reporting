"use client";

import { AccessGate } from "@/components/AccessGate";

export default function TyLettersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccessGate report="ty-letters">{children}</AccessGate>;
}
