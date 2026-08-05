"use client";

import { LegacyHtmlMount } from "@/components/LegacyHtmlMount";
import { ReportShell } from "@/components/ReportShell";
import { HOUSING_BODY } from "@/lib/reports/housing/body";
import { HOUSING_SCRIPT } from "@/lib/reports/housing/script";
import "@/styles/housing.css";

export default function HousingPage() {
  return (
    <ReportShell report="housing" title="Housing" chrome={false}>
      <LegacyHtmlMount bodyHtml={HOUSING_BODY} scriptText={HOUSING_SCRIPT} />
    </ReportShell>
  );
}
