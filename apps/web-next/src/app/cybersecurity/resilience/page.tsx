"use client";

import { SectionPage } from "@/components/cyber/SectionPage";

const PLANNED = [
  "Backup job success % (AWS Backup and RDS)",
  "Last restore test date, RPO and RTO targets",
  "VPN tunnel uptime and dependent nightly job failures",
  "Regulated systems inventory (FERPA, GLBA, HIPAA, PCI) with control status",
];

export default function CyberResiliencePage() {
  return (
    <SectionPage
      section="resilience"
      sub="Backups, restore testing, VPN dependencies, and regulated systems."
      planned={PLANNED}
    />
  );
}
