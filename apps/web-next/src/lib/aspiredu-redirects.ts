/**
 * Retired Academic Affairs URLs. The section is now one Students page at
 * /aspiredu; profiles stay at /aspiredu/students/[studentKey], so only the
 * bare /aspiredu/students path redirects. Temporary (307) so the old reports
 * could come back without stale browser caches.
 */
export const ASPIREDU_REDIRECTS = [
  { source: "/aspiredu/students", destination: "/aspiredu", permanent: false },
  { source: "/aspiredu/provisional", destination: "/aspiredu", permanent: false },
  { source: "/aspiredu/provisional/:path*", destination: "/aspiredu", permanent: false },
  { source: "/aspiredu/eot", destination: "/aspiredu", permanent: false },
  { source: "/aspiredu/eot/:path*", destination: "/aspiredu", permanent: false },
];
