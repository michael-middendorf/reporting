"use client";

import { LegacyHtmlMount } from "@/components/LegacyHtmlMount";
import { ReportShell } from "@/components/ReportShell";
import { ENROLLMENT_BODY } from "@/lib/reports/enrollment/body";
import { ENROLLMENT_SCRIPT } from "@/lib/reports/enrollment/script";
import "@/styles/enrollment.css";

export default function EnrollmentPage() {
  return (
    <ReportShell report="enrollment" title="Enrollment" chrome={false}>
      <LegacyHtmlMount bodyHtml={ENROLLMENT_BODY} scriptText={ENROLLMENT_SCRIPT} />
    </ReportShell>
  );
}
