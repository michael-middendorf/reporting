/**
 * Same-origin return paths for ?next= and the Microsoft sign-in round trip.
 * Safe to import from client and server code (no Node APIs).
 */

/** Longest return path we keep. Anything longer falls back to "/". */
export const SAFE_LOCAL_PATH_MAX_LENGTH = 2048;

// C0 controls and DEL. A tab or newline inside a path can be stripped by the
// URL parser and turn "/\t/evil.com" into "//evil.com".
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// "." or ".." path segments, plain or percent-encoded. "/..//evil.com"
// normalizes to "//evil.com", so dot segments are never a valid return path.
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$)/i;

// Percent-encoded "/" or "\" in the path portion. "/..%2f/evil" and
// "/a%2f..%2f.." hide dot segments from DOT_SEGMENT, and no page route takes
// an encoded separator in its path (dynamic segments are slugs or
// [A-Za-z0-9_-] keys). The query and fragment are not checked.
const ENCODED_SEPARATOR = /%(2f|5c)/i;

const PARSE_BASE = "https://reporting.invalid";

/**
 * Coerce an untrusted path to a same-origin path, or "/".
 * Accepts only a single leading "/". Rejects protocol-relative ("//evil.com"),
 * backslash tricks ("/\\evil.com", "/a\\b"), control characters, dot
 * segments ("/..//evil.com"), percent-encoded "/" or "\" in the path
 * ("/..%2f/evil"), anything the URL parser would move off-origin
 * or normalize to "//", and anything longer than SAFE_LOCAL_PATH_MAX_LENGTH.
 */
export function safeLocalPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw) return "/";
  if (raw.length > SAFE_LOCAL_PATH_MAX_LENGTH) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.includes("\\")) return "/";
  if (CONTROL_CHARS.test(raw)) return "/";
  const pathname = raw.split(/[?#]/)[0];
  if (DOT_SEGMENT.test(pathname)) return "/";
  if (ENCODED_SEPARATOR.test(pathname)) return "/";
  try {
    const parsed = new URL(raw, PARSE_BASE);
    if (parsed.origin !== PARSE_BASE || parsed.pathname.startsWith("//")) return "/";
  } catch {
    return "/";
  }
  return raw;
}

/**
 * Path worth keeping across the Microsoft round trip, or null. Unsafe values
 * are dropped, not coerced, so a hostile ?next= never reaches the cookie.
 */
export function entraReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return safeLocalPath(raw) === raw ? raw : null;
}

/**
 * Return path worth carrying as ?next= across a sign-in step, or null.
 * Unsafe values are dropped (same rule as entraReturnPath). The default "/"
 * and sign-in pages themselves (/login, /auth/*) are dropped too: carrying
 * them adds nothing and could loop the user back into sign-in.
 */
export function carriedReturnPath(raw: string | null | undefined): string | null {
  const path = entraReturnPath(raw);
  if (!path) return null;
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/") return null;
  if (pathname === "/login" || pathname.startsWith("/login/")) return null;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return null;
  return path;
}

/**
 * `base` with `next=<encoded return path>` appended when carriedReturnPath
 * keeps it, else `base` unchanged. `base` is one of our own fixed paths.
 */
export function withNextParam(base: string, raw: string | null | undefined): string {
  const path = carriedReturnPath(raw);
  if (!path) return base;
  return `${base}${base.includes("?") ? "&" : "?"}next=${encodeURIComponent(path)}`;
}
