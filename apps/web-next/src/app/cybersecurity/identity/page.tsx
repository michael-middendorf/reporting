"use client";

import { SectionPage } from "@/components/cyber/SectionPage";

const PLANNED = [
  "Entra MFA registration % (staff, students, admins)",
  "Global Admin count (target 5 or fewer)",
  "Risky users",
  "Guest accounts",
  "Legacy auth and SMTP AUTH status",
  "Break-glass account status",
  "AD: Domain Admins, DnsAdmins, Protected Users",
  "AD: password-not-required accounts, unconstrained delegation",
  "AD: stale enabled accounts and computers",
  "Core app: privileged roles on deleted accounts",
];

export default function CyberIdentityPage() {
  return (
    <SectionPage
      section="identity"
      sub="Entra ID, Active Directory, and app privilege counts. Counts only, never names."
      planned={PLANNED}
    />
  );
}
