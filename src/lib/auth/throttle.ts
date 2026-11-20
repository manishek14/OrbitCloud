// ============================================================================
// Login throttling helpers (audit §4.1).
//
// Failed-login counters live in the dedicated, indexed LoginAttempt table —
// NOT in the audit log (which stays a pure audit trail). Identifiers are
// stored ONLY as keyed hashes so raw emails/phone numbers never sit in
// throttle storage or audit metadata.
//
// Key resolution mirrors grant-hash: a dedicated secret, the (already
// mandatory) service token as bootstrap fallback, or the development-only
// deterministic key. Plain SHA-256 of an identifier would allow rainbow-table
// recovery of phone numbers from a database leak — the keyed HMAC does not.
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_FALLBACK_SECRET = "abrit-dev-only-throttle-hmac-key";

function throttleSecret(): string {
  const dedicated = (process.env.OTP_HMAC_SECRET ?? "").trim();
  if (dedicated) return dedicated;
  const serviceToken = (process.env.ABRIT_SERVICE_TOKEN ?? "").trim();
  if (serviceToken.length >= 16) return serviceToken;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Login throttling is not configured: set OTP_HMAC_SECRET (>= 32 random chars) to a dedicated server-side secret.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

/** Keyed hash of a canonical login identifier (kind: "email" | "mobile"). */
export function hashLoginIdentifier(kind: string, value: string): string {
  return createHmac("sha256", throttleSecret()).update(`${kind}:${value}`, "utf8").digest("hex");
}

/** Constant-time comparison helper for throttle keys (utility for tests). */
export function throttleHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
