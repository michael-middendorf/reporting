"use client";

import { SectionPage } from "@/components/cyber/SectionPage";

const PLANNED = [
  "Security Hub FSBP score and critical/high findings",
  "GuardDuty findings by severity",
  "Inspector critical/high CVEs",
  "GitHub Dependabot, CodeQL and secret-scanning alerts vs SLA (critical 7 days, high 30 days)",
  "Certificates expiring within 30/60/90 days",
  "Public exposure checks",
];

export default function CyberCloudPage() {
  return (
    <SectionPage
      section="cloud"
      sub="AWS posture, application vulnerabilities, certificates, and public exposure."
      planned={PLANNED}
    />
  );
}
