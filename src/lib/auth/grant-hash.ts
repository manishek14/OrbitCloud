// ============================================================================
// Keyed grant hashing (audit §3.5) — HMAC-SHA256 for LOW-ENTROPY codes.
//
// Problem being fixed: OTP and password-recovery codes are 4–8 digit values.
// Storing them under a PLAIN SHA-256 hash means a database leak allows an
// attacker to brute-force the entire code space (10^6 for 6 digits) offline
// in seconds and recover usable codes.
//
// Design:
//   • Grants are stored as HMAC-SHA256(secret, purpose + ":" + code).
//   • The secret is a dedicated server-side value (OTP_HMAC_SECRET) that never
//     enters the database or source control — a DB leak alone is useless.
//   • Verification is TIMING-SAFE (crypto.timingSafeEqual).
//   • Rotation: OTP_HMAC_SECRET_PREVIOUS is accepted during a rotation window
//     so an operator can roll the secret without burning in-flight grants.
//   • Legacy SHA-256 grants (issued before this change) still verify — all
//     grants are short-lived (≤ 10 minutes), so the compatibility path fades
//     out naturally within one TTL.
//   • Production REQUIRES an explicit secret. Development falls back to a
//     deterministic development key and logs a one-time warning (in display
//     mode the code is returned in the API response anyway, so the dev key
//     protects nothing that is not already visible).
//
// High-entropy session tokens (random 32 bytes) keep their plain SHA-256
// storage — that is a lookup hash, not a secret-derived code, and is NOT
// brute-forceable. Do not conflate the two designs.
// ============================================================================

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEV_FALLBACK_SECRET = "orbit-dev-only-grant-hmac-key";
let devWarningIssued = false;

function readSecret(envName: string): string | null {
  const value = (process.env[envName] ?? "").trim();
  return value.length > 0 ? value : null;
}

/**
 * The HMAC key for grant codes. Resolution order (engineering review follow-up:
 * the dedicated secret is MANDATORY in production — no implicit fallback):
 *   1. OTP_HMAC_SECRET (dedicated secret — required when NODE_ENV=production)
 *   2. development-only deterministic key (never in production)
 *
 * Production refuses to start grant-issuing flows without OTP_HMAC_SECRET,
 * even when ABRIT_SERVICE_TOKEN is configured: reusing the service contract
 * token as the HMAC key silently couples two independent security domains.
 */
function currentSecret(): string {
  const dedicated = readSecret("OTP_HMAC_SECRET");
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "OTP grant hashing is not configured: set OTP_HMAC_SECRET (>= 32 random chars, e.g. `openssl rand -hex 32`). " +
        "Production requires the dedicated secret (the ABRIT_SERVICE_TOKEN fallback was removed by engineering review).",
    );
  }
  if (!devWarningIssued) {
    devWarningIssued = true;
    console.warn(
      "[grant-hash] OTP_HMAC_SECRET is not set — using the DEVELOPMENT fallback key. " +
        "Set OTP_HMAC_SECRET before running in production.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** Hashes a grant code for storage. Binds the code to its purpose so a code
 *  issued for "login" can never be replayed against "register". */
export function hashGrantCode(code: string, purpose: string): string {
  return hmacHex(currentSecret(), `${purpose}:${code}`);
}

/**
 * Timing-safe verification of a submitted code against a stored grant hash.
 * Accepts, in order:
 *   1. HMAC under the current secret
 *   2. HMAC under the previous secret (rotation window)
 *   3. legacy plain SHA-256 (grants issued before this change; all grants
 *      are short-lived so this path is self-retiring)
 */
export function verifyGrantCode(storedHash: string, code: string, purpose: string): boolean {
  const submitted = hmacHex(currentSecret(), `${purpose}:${code}`);
  if (safeEqualHex(storedHash, submitted)) return true;

  const previous = readSecret("OTP_HMAC_SECRET_PREVIOUS");
  if (previous) {
    const submittedPrevious = hmacHex(previous, `${purpose}:${code}`);
    if (safeEqualHex(storedHash, submittedPrevious)) return true;
  }

  // Legacy compatibility: plain SHA-256 of the bare code (pre-HMAC grants).
  const legacy = createHash("sha256").update(code, "utf8").digest("hex");
  return safeEqualHex(storedHash, legacy);
}

/** True when a dedicated OTP_HMAC_SECRET (or service-token fallback) is set. */
export function isGrantSecretConfigured(): boolean {
  try {
    currentSecret();
    return true;
  } catch {
    return false;
  }
}
