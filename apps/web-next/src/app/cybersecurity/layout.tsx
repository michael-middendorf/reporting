import type { Metadata } from "next";
import CyberShell from "./CyberShell";
import "@/styles/cybersecurity.css";

// The board space lists AMU's weaknesses: keep every page out of search.
export const metadata: Metadata = {
  title: "Cybersecurity | AMU Reporting",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function CybersecurityLayout({ children }: { children: React.ReactNode }) {
  return <CyberShell>{children}</CyberShell>;
}
