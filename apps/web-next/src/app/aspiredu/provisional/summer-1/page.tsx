"use client";

import { CourseReport } from "../CourseReport";
import { buildSummer1ProvisionalWorkbook } from "@/lib/aspiredu-exact-reports";

export default function Summer1ProvisionalPage() {
  return (
    <CourseReport
      heading="Summer 1 Athletic Provisional"
      termGroup="summer1"
      excelDownloads={[
        {
          label: "Download Excel (full template)",
          filename: "SU 1 Athletic Provisional report.xlsx",
          build: buildSummer1ProvisionalWorkbook,
        },
      ]}
    />
  );
}
