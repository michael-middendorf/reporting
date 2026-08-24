"use client";

import { CourseReport } from "../../provisional/CourseReport";

export default function SpringEotPage() {
  return (
    <CourseReport
      heading="Spring EOT Grade Report"
      termGroup="spring"
      showGradeDistribution
    />
  );
}
