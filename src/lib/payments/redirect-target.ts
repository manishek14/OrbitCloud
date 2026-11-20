// ============================================================================
// Safe RELATIVE redirect targets (final-integration remediation FSR-7).
//
// The internal dev/test payment gateway callback (POST /api/payments/callback)
// must never build its redirect destination from request headers: Host,
// X-Forwarded-Host and X-Forwarded-Proto are plain client-settable values, so
// an absolute Location derived from them is an open-redirect / origin-spoofing
// vector. The route therefore answers with a 303 whose Location is a RELATIVE
// reference (RFC 9110 §9.3.7) — the browser resolves it against the origin it
// is already on. This module validates that the server-side target is
// actually a safe relative reference before it is emitted.
//
// Same approach as the real-gateway callback
// (src/app/api/payments/callback/[gateway]/route.ts), extracted so the guard
// itself is directly testable.
// ============================================================================

/** A safe fallback destination when a target cannot be trusted. */
export const SAFE_REDIRECT_FALLBACK = "/";

/**
 * Returns `target` only when it is a safe RELATIVE reference:
 *   • starts with exactly one "/" (never "//" — a network-path reference the
 *     browser would resolve against the scheme and an attacker's host),
 *   • never starts with "/\" (a backslash the browser's URL parser would
 *     treat as a slash, turning it into "//"),
 *   • contains no backslash anywhere (same parser normalization),
 *   • contains no control characters (header injection),
 *   • is not an absolute URL (a leading scheme) or a protocol-relative one.
 *
 * Anything else collapses to "/" — the caller never redirects off-origin.
 */
export function safeRelativeRedirectLocation(target: string): string {
  const value = target.trim();
  if (!/^\/(?!\/|\\)/.test(value)) return SAFE_REDIRECT_FALLBACK;
  if (value.includes("\\") || /[\r\n\t]/.test(value)) return SAFE_REDIRECT_FALLBACK;
  return value;
}
