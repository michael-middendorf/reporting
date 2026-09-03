import { apiFetch } from "@/lib/api";
import type { CourseRow } from "./aspiredu-exact-reports";

export type LoadCoursesResult = {
  courses: CourseRow[];
  terms: string[];
  courseCount: number;
  studentCount: number;
  delivery: string;
  mfaRequired: boolean;
};

export async function loadAllCourses(options: {
  query?: string;
  term?: string;
  termGroup?: string;
} = {}): Promise<LoadCoursesResult> {
  const collected: CourseRow[] = [];
  let cursor: string | undefined;
  let terms: string[] = [];
  let courseCount = 0;
  let studentCount = 0;
  let delivery = "";

  for (let page = 0; page < 200; page += 1) {
    const params = new URLSearchParams();
    if (options.query?.trim()) params.set("query", options.query.trim());
    if (options.term) params.set("term", options.term);
    if (options.termGroup) params.set("termGroup", options.termGroup);
    if (cursor) params.set("cursor", cursor);
    const response = await apiFetch(`/aspiredu/api/courses?${params}`, { cache: "no-store" });
    if (response.status === 401) {
      return {
        courses: [],
        terms: [],
        courseCount: 0,
        studentCount: 0,
        delivery: "",
        mfaRequired: true,
      };
    }
    if (!response.ok) throw new Error("Unable to load course records.");
    const body = await response.json();
    delivery = body.status || "";
    collected.push(...(body.courses || []));
    terms = body.terms || terms;
    courseCount = body.courseCount ?? collected.length;
    studentCount = body.studentCount ?? studentCount;
    if (!body.cursor) break;
    cursor = body.cursor;
  }

  return {
    courses: collected,
    terms,
    courseCount,
    studentCount,
    delivery,
    mfaRequired: false,
  };
}
