"use client";

import { CourseReport } from "../CourseReport";
import {
  buildAthleticsGradeWorkbook,
  buildAthleticsProvisionalWorkbook,
} from "@/lib/aspiredu-exact-reports";

export default function AthleticsProvisionalPage() {
  return (
    <CourseReport
      heading="Athletics Provisional"
      excelDownloads={[
        {
          label: "Download Excel (full template)",
          filename: "Athletics Provisional Report.xlsx",
          build: buildAthleticsProvisionalWorkbook,
        },
        {
          label: "Download Athletics Grade Report",
          filename: "Athletics Grade Report.xlsx",
          build: buildAthleticsGradeWorkbook,
        },
      ]}
    />
  );
}
