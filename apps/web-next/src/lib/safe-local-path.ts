/**
 * Same-origin return paths for ?next= and the Microsoft sign-in round trip.
 * Safe to import from client and server code (no Node APIs).
 */

/** Longest return path we keep. Anything longer falls back to "/". */
export const SAFE_LOCAL_PATH_MAX_LENGTH = 2048;

// C0 controls and DEL. A tab or newline inside a path can be stripped by the
// URL parser and turn "/\t/evil.com" into "//evil.com".
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Coerce an untrusted path to a same-origin path, or "/".
 * Accepts only a single leading "/". Rejects protocol-relative ("//evil.com"),
 * backslash tricks ("/\\evil.com", "/a\\b"), control characters, and
 * anything longer than SAFE_LOCAL_PATH_MAX_LENGTH.
 */
export function safeLocalPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw) return "/";
  if (raw.length > SAFE_LOCAL_PATH_MAX_LENGTH) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.includes("\\")) return "/";
  if (CONTROL_CHARS.test(raw)) return "/";
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
