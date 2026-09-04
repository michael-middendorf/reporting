"use client";

import { CourseReport } from "../CourseReport";
import { buildFallProvisionalWorkbook } from "@/lib/aspiredu-exact-reports";

export default function FallProvisionalPage() {
  return (
    <CourseReport
      heading="Fall Athletic Provisional"
      termGroup="fall"
      excelDownloads={[
        {
          label: "Download Excel (full template)",
          filename: "Fall Athletic Provisional report.xlsx",
          build: buildFallProvisionalWorkbook,
        },
      ]}
    />
  );
}
