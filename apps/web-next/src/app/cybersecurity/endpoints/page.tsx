"use client";

import { SectionPage } from "@/components/cyber/SectionPage";

const PLANNED = [
  "Defender for Endpoint onboarding %",
  "Intune compliance %",
  "Disk encryption %",
  "Open Defender incidents and alerts by severity",
  "Mean time to resolve incidents",
  "Secure Score trend",
  "DMARC policy, SPF and DKIM status",
];

export default function CyberEndpointsPage() {
  return (
    <SectionPage
      section="endpoints"
      sub="Device coverage, incidents, and email authentication."
      planned={PLANNED}
    />
  );
}
