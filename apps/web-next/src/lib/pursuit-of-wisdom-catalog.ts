export type AcademicTopic =
  | "Theology & Faith"
  | "Literature"
  | "Philosophy"
  | "Bioethics & Ethics"
  | "Politics & History"
  | "Technology & Science"
  | "Culture & Virtues";

export type CourseFormat = "Short (4-5 lessons)" | "Medium (7-8 lessons)" | "Long (9+ lessons)";

export interface CourseCatalogEntry {
  title: string;
  slug: string;
  professor: string;
  topic: AcademicTopic;
  segments: number;
  avgDurationMinutes: number;
}

export const POW_CATALOG: CourseCatalogEntry[] = [
  {
    title: "An Introduction to Computer Science",
    slug: "introduction-to-computer-science",
    professor: "Dr. Saverio Perugini",
    topic: "Technology & Science",
    segments: 16,
    avgDurationMinutes: 15,
  },
  {
    title: "Athletics and the Virtues",
    slug: "athletics-and-the-virtues",
    professor: "Coach Joe Patterson",
    topic: "Culture & Virtues",
    segments: 10,
    avgDurationMinutes: 15,
  },
  {
    title: "Catholic Bioethics: Current Issues",
    slug: "catholic-bioethics-current-issues",
    professor: "Dr. Diann Ecret",
    topic: "Bioethics & Ethics",
    segments: 5,
    avgDurationMinutes: 18,
  },
  {
    title: "Demystifying AI from a Catholic Perspective",
    slug: "demystifying-ai-from-a-catholic-perspective",
    professor: "Dr. Saverio Perugini",
    topic: "Technology & Science",
    segments: 22,
    avgDurationMinutes: 12,
  },
  {
    title: "Economics and Catholic Social Teaching",
    slug: "economics-and-catholic-social-teaching",
    professor: "Dr. Gabriel Martinez",
    topic: "Culture & Virtues",
    segments: 9,
    avgDurationMinutes: 22,
  },
  {
    title: "Introduction to Mariology",
    slug: "introduction-to-mariology",
    professor: "Dr. Mark Miravalle",
    topic: "Theology & Faith",
    segments: 7,
    avgDurationMinutes: 20,
  },
  {
    title: "Introduction to Sacramental Theology",
    slug: "introduction-to-sacramental-theology",
    professor: "Dr. Roger Nutt",
    topic: "Theology & Faith",
    segments: 5,
    avgDurationMinutes: 20,
  },
  {
    title: "Pro-Life: Rights, Natural Law, and Catholic Thought",
    slug: "pro-life-rights-natural-law-and-catholic-thought",
    professor: "Dr. Seana McGuire (Segrue)",
    topic: "Bioethics & Ethics",
    segments: 10,
    avgDurationMinutes: 18,
  },
  {
    title: "Stewarding the Environment",
    slug: "stewarding-the-environment",
    professor: "Dr. Samuel Shepard",
    topic: "Technology & Science",
    segments: 7,
    avgDurationMinutes: 16,
  },
  {
    title: "The Foundation and Future of Catholic Education",
    slug: "foundation-and-future-of-catholic-education",
    professor: "Dr. Dan Guernsey",
    topic: "Culture & Virtues",
    segments: 7,
    avgDurationMinutes: 18,
  },
  {
    title: "The Foundations of America: U.S. Constitution",
    slug: "foundation-of-america-us-constitution",
    professor: "Dr. Seana McGuire (Segrue)",
    topic: "Politics & History",
    segments: 9,
    avgDurationMinutes: 20,
  },
  {
    title: "The Genius of G.K. Chesterton",
    slug: "genius-of-gk-chesterton",
    professor: "Joseph Pearce",
    topic: "Literature",
    segments: 8,
    avgDurationMinutes: 18,
  },
  {
    title: "The Genius of J.R.R. Tolkien",
    slug: "genius-of-jrr-tolkien",
    professor: "Joseph Pearce",
    topic: "Literature",
    segments: 8,
    avgDurationMinutes: 20,
  },
  {
    title: "The Life and Teachings of St. Augustine",
    slug: "life-and-teachings-of-st-augustine",
    professor: "Dr. Gerald Boersma",
    topic: "Theology & Faith",
    segments: 8,
    avgDurationMinutes: 18,
  },
  {
    title: "The Philosophy of Love",
    slug: "philosophy-of-love",
    professor: "Dr. Maria Fedoryka",
    topic: "Philosophy",
    segments: 5,
    avgDurationMinutes: 26,
  },
  {
    title: "The Philosophy of Motherhood",
    slug: "philosophy-of-motherhood",
    professor: "Dr. Janice Chik Breidenbach",
    topic: "Philosophy",
    segments: 5,
    avgDurationMinutes: 22,
  },
  {
    title: "The Rise of American Politics",
    slug: "rise-of-american-politics",
    professor: "Dr. Michael Breidenbach",
    topic: "Politics & History",
    segments: 4,
    avgDurationMinutes: 20,
  },
  {
    title: "The Virtues and Leadership in Business",
    slug: "virtues-and-leadership-in-business",
    professor: "Dave Durand",
    topic: "Culture & Virtues",
    segments: 9,
    avgDurationMinutes: 16,
  },
  {
    title: "The Wisdom of C.S. Lewis",
    slug: "wisdom-of-cs-lewis",
    professor: "Dr. Michel Dauphinais",
    topic: "Literature",
    segments: 8,
    avgDurationMinutes: 19,
  },
  {
    title: "The Wisdom of Fulton Sheen",
    slug: "wisdom-of-fulton-sheen",
    professor: "Dr. James Patterson",
    topic: "Theology & Faith",
    segments: 5,
    avgDurationMinutes: 18,
  },
];

const catalogByTitle = new Map<string, CourseCatalogEntry>(
  POW_CATALOG.map((entry) => [entry.title.toLowerCase().trim(), entry])
);

export function getCatalogEntry(title: string): CourseCatalogEntry | undefined {
  return catalogByTitle.get(title.toLowerCase().trim());
}

export function classifyFormat(segments: number): CourseFormat {
  if (segments <= 5) return "Short (4-5 lessons)";
  if (segments <= 8) return "Medium (7-8 lessons)";
  return "Long (9+ lessons)";
}

export interface RawCourseEngagement {
  title: string;
  starts: number;
  completions: number;
  completionRate?: number;
  watchHours?: number;
  videosWatched?: number;
  segments?: number;
  avgDurationMinutes?: number;
  topic?: AcademicTopic;
  format?: CourseFormat;
}

export interface EnrichedCourseEngagement extends RawCourseEngagement {
  segments: number;
  avgDurationMinutes: number;
  topic: AcademicTopic;
  format: CourseFormat;
  completionRate: number;
  watchHours: number;
  videosWatched: number;
}

export interface FormatComparison {
  format: CourseFormat;
  courseCount: number;
  totalStarts: number;
  totalCompletions: number;
  completionRate: number;
}

export interface TopicTraction {
  topic: AcademicTopic;
  courseCount: number;
  totalStarts: number;
  totalCompletions: number;
  completionRate: number;
}

export interface TrafficChannel {
  channel: string;
  description: string;
  shareDescription: string;
}

export function enrichCourseEngagement(raw: RawCourseEngagement): EnrichedCourseEngagement {
  const meta = getCatalogEntry(raw.title);
  const segments = raw.segments || meta?.segments || 6;
  const avgDurationMinutes = raw.avgDurationMinutes || meta?.avgDurationMinutes || 18;
  const topic = raw.topic || meta?.topic || "Culture & Virtues";
  const format = raw.format || classifyFormat(segments);
  const starts = raw.starts || 0;
  const completions = raw.completions || 0;
  const completionRate = starts > 0 ? completions / starts : 0;
  const watchHours = raw.watchHours || 0;
  const videosWatched = raw.videosWatched || 0;

  return {
    ...raw,
    segments,
    avgDurationMinutes,
    topic,
    format,
    starts,
    completions,
    completionRate,
    watchHours,
    videosWatched,
  };
}

export function computeFormatComparisons(courses: EnrichedCourseEngagement[]): FormatComparison[] {
  const formats: CourseFormat[] = ["Short (4-5 lessons)", "Medium (7-8 lessons)", "Long (9+ lessons)"];
  return formats.map((format) => {
    const matching = courses.filter((c) => c.format === format);
    const totalStarts = matching.reduce((sum, c) => sum + c.starts, 0);
    const totalCompletions = matching.reduce((sum, c) => sum + c.completions, 0);
    const completionRate = totalStarts > 0 ? totalCompletions / totalStarts : 0;
    return {
      format,
      courseCount: matching.length,
      totalStarts,
      totalCompletions,
      completionRate,
    };
  });
}

export function computeTopicTractions(courses: EnrichedCourseEngagement[]): TopicTraction[] {
  const map = new Map<AcademicTopic, { count: number; starts: number; completions: number }>();
  for (const c of courses) {
    const existing = map.get(c.topic) || { count: 0, starts: 0, completions: 0 };
    existing.count += 1;
    existing.starts += c.starts;
    existing.completions += c.completions;
    map.set(c.topic, existing);
  }

  const topics = Array.from(map.entries()).map(([topic, stats]) => ({
    topic,
    courseCount: stats.count,
    totalStarts: stats.starts,
    totalCompletions: stats.completions,
    completionRate: stats.starts > 0 ? stats.completions / stats.starts : 0,
  }));

  // Sort by highest starts first
  return topics.sort((a, b) => b.totalStarts - a.totalStarts);
}

export const DISTRIBUTION_RECOMMENDATIONS = [
  {
    title: "Format Optimization: Prioritize 4-5 Segment Courses",
    recommendation:
      "Short courses achieve the highest completion rate (17.9%), outperforming 7-8 segment courses (13.8%) and 9+ segment courses (14.2%). Future courses should aim for concise 4-5 segment structures.",
  },
  {
    title: "High-Traction Entry Topics: Literature & Faith",
    recommendation:
      "J.R.R. Tolkien (1,183 starts) and Sacramental Theology (1,015 starts) are top acquisition drivers. Use these flagship titles in external parish bulletin distributions and introductory mailings.",
  },
  {
    title: "Highest Follow-Through: Philosophy of Motherhood & Love",
    recommendation:
      "Philosophy courses lead all categories in completion rate (22.1%), led by Philosophy of Motherhood (22.5%). Promote these in targeted alumni and family-focused email communications.",
  },
  {
    title: "Channel Strategy: Direct & Bulletin Expansion",
    recommendation:
      "Leverage parish bulletin inserts and email campaigns with dedicated UTM parameters (utm_source=bulletin, utm_source=email) to track and optimize specific parish conversion rates.",
  },
];

export function overlayPursuitOfWisdomCatalog(data: Record<string, unknown>): Record<string, unknown> {
  const rawCourses = (data.courses as RawCourseEngagement[]) || [];
  const enrichedCourses = rawCourses.map(enrichCourseEngagement);
  const formatComparisons = computeFormatComparisons(enrichedCourses);
  const topicTractions = computeTopicTractions(enrichedCourses);

  return {
    ...data,
    courses: enrichedCourses,
    formatComparisons,
    topicTractions,
    distributionRecommendations: DISTRIBUTION_RECOMMENDATIONS,
  };
}
