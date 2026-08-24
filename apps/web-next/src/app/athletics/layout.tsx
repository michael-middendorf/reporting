import { AthleticsChrome, AthleticsProvider } from "@/components/athletics/AthleticsShell";
import "@/styles/athletics.css";

export default function AthleticsLayout({ children }: { children: React.ReactNode }) {
  return <AthleticsProvider><AthleticsChrome>{children}</AthleticsChrome></AthleticsProvider>;
}
