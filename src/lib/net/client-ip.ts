// ============================================================================
// SHARED client-IP resolver (final-integration remediation FSR-5).
//
// Single source of truth for deriving the client IP from a Request. Before
// this module existed, three independent implementations read x-real-ip /
// x-forwarded-for directly:
//   • src/lib/rate-limit/memory.ts   (contact/quote rate limiting)
//   • src/lib/auth/recovery.ts       (clientIpHash → OTP + recovery grants)
//   • src/lib/auth/session.ts        (session.ipHash)
// Each one trusted the FIRST x-forwarded-for member unconditionally — a plain
// client-settable value. Every consumer now resolves through THIS module; no
// route or service may read those headers on its own.
//
// TRUST CONTRACT (explicit, fail-closed):
//
//   UNTRUSTED (default — ABRIT_TRUST_PROXY_HEADERS unset / not "true"):
//     No forwarding header is trusted. The resolver returns the constant
//     "unknown" so every caller shares one stable key. Rate limiting stays
//     ACTIVE (one shared bucket) — trusting nothing never disables limits,
//     it only removes the per-client split a spoofable header would give.
//
//   TRUSTED (ABRIT_TRUST_PROXY_HEADERS=true — operator declares an
//   edge reverse proxy that OVERWRITES, never appends, these headers):
//     1. x-real-ip — the authoritative edge header. Accepted only as a bare
//        valid IPv4/IPv6 literal. If the header is PRESENT but invalid, the
//        resolver fails closed to "unknown" (a broken edge contract must not
//        degrade into "trust whatever else the client sent").
//     2. x-forwarded-for — fallback when the edge sets no x-real-ip. Only the
//        RIGHTMOST member that is a bare valid IP literal is used: with
//        appending proxies every earlier member is client-controlled, and the
//        simple "first member" rule was exactly the spoofing bypass this
//        module removes. If no member validates, the value is untrusted.
//     3. Anything else → "unknown" (back on the safe untrusted policy).
//
// The raw resolved IP is never logged here (callers persist only the keyed
// hash from clientIpHash).
// ============================================================================

import { createHash } from "node:crypto";
import { isIP } from "node:net";

/** The stable value used whenever no trustworthy client IP exists. Public and
 *  documented: untrusted deployments share exactly one rate-limit bucket. */
export const UNKNOWN_CLIENT_IP = "unknown";

/** Strictly parses the trust flag: only the literal "true" (any case,
 *  surrounding whitespace) enables proxy-header trust. */
export function isProxyHeaderTrustEnabled(): boolean {
  return (process.env.ABRIT_TRUST_PROXY_HEADERS ?? "").trim().toLowerCase() === "true";
}

/** A bare IPv4 or IPv6 literal — no ports, no brackets, no hostnames. */
export function isValidIpLiteral(value: string): boolean {
  return value.length > 0 && isIP(value) !== 0;
}

/**
 * RIGHTMOST valid x-forwarded-for member (trusted mode only).
 *
 * `x-forwarded-for: client, proxy-a, proxy-b` — every member except the last
 * was written by a party the client could influence; the rightmost member is
 * the one our own trusted edge appended (or replaced), so it identifies the
 * edge's immediate peer. If no member is a bare valid IP, the whole header is
 * discarded (return null).
 */
function rightmostValidForwardedFor(value: string): string | null {
  const members = value.split(",").map((member) => member.trim()).filter((member) => member.length > 0);
  for (let i = members.length - 1; i >= 0; i--) {
    if (isValidIpLiteral(members[i]!)) return members[i]!;
  }
  return null;
}

/**
 * Resolves the client IP for a request under the trust contract above.
 * Returns a validated IP literal or the constant "unknown" — never a raw
 * header value.
 */
export function resolveClientIp(request: Request): string {
  if (!isProxyHeaderTrustEnabled()) return UNKNOWN_CLIENT_IP;

  const realIp = (request.headers.get("x-real-ip") ?? "").trim();
  if (realIp.length > 0) {
    // Present but invalid → fail closed. Do NOT fall through to other
    // client-influenceable headers when the authoritative one is broken.
    return isValidIpLiteral(realIp) ? realIp : UNKNOWN_CLIENT_IP;
  }

  const forwarded = (request.headers.get("x-forwarded-for") ?? "").trim();
  if (forwarded.length > 0) {
    const resolved = rightmostValidForwardedFor(forwarded);
    if (resolved) return resolved;
  }

  return UNKNOWN_CLIENT_IP;
}

/**
 * Rate-limit key derived from the resolved client IP. Same value as
 * resolveClientIp (kept as its own export for the existing consumers).
 */
export function clientIpKey(request: Request): string {
  return resolveClientIp(request);
}

/**
 * Stable, non-reversible pseudonymization of the client IP for durable
 * storage (throttle counters, grant rows, session rows). The hash format
 * `sha256("ip:" + value)` is unchanged from the previous per-module
 * implementations so existing rows keep matching. The raw IP is never logged.
 */
export function clientIpHash(request: Request): string {
  return createHash("sha256").update(`ip:${resolveClientIp(request)}`, "utf8").digest("hex");
}
