"use client";

import { CourseReport } from "../../provisional/CourseReport";
import { buildSpringEotWorkbook } from "@/lib/aspiredu-exact-reports";

export default function SpringEotPage() {
  return (
    <CourseReport
      heading="Spring EOT Grade Report"
      termGroup="spring"
      showGradeDistribution
      excelDownloads={[
        {
          label: "Download Excel (full template)",
          filename: "Spring EOT Grade report.xlsx",
          build: buildSpringEotWorkbook,
        },
      ]}
    />
  );
}
