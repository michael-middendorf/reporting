/** The one URL we send people. They sign in here and pick reports on the hub. */
export const CANONICAL_APP_HOST = "reporting.avemaria.edu";
export const CANONICAL_APP_URL = `https://${CANONICAL_APP_HOST}`;

/** Pre-custom-domain CloudFront hostname. Still a valid origin; do not email it. */
export const LEGACY_CLOUDFRONT_HOST = "dc4s8z03sfopy.cloudfront.net";

function headerHost(req: Request): string {
  return (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
}

function isLocalHost(host: string): boolean {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

/**
 * Base URL for emailed sign-in links. Localhost keeps the request host so
 * `next dev` works; everywhere else we send https://reporting.avemaria.edu
 * even if the request arrived on CloudFront.
 */
export function appBaseUrlForEmail(req: Request): string {
  const host = headerHost(req);
  if (isLocalHost(host)) {
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    return `${proto}://${host}`;
  }
  return (process.env.APP_BASE_URL || CANONICAL_APP_URL).replace(/\/$/, "");
}
