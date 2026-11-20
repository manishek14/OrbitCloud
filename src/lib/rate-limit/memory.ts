// Best-effort in-memory sliding-window rate limiter.
//
// Purpose (full-remediation audit §3.3): public, unauthenticated POST
// endpoints (contact form, quote requests) need abuse protection. The
// deployment model is a single portal container, so a per-process window is
// an effective first line of defense; it is deliberately NOT used for
// security-critical paths — those (login, OTP, recovery) use durable,
// database-backed counters in src/lib/auth/*.

interface Window {
  hits: number[];
}

const buckets = new Map<string, Window>();
const MAX_BUCKETS = 10_000;

function prune(now: number, windowMs: number, entry: Window): void {
  const cutoff = now - windowMs;
  if (entry.hits.length === 0 || entry.hits[entry.hits.length - 1] < cutoff) {
    entry.hits.length = 0;
    return;
  }
  let firstRelevant = 0;
  while (firstRelevant < entry.hits.length && entry.hits[firstRelevant] < cutoff) firstRelevant++;
  if (firstRelevant > 0) entry.hits.splice(0, firstRelevant);
}

/**
 * Records a hit for `key` and reports whether it is inside the limit.
 * Returns `allowed: false` (without recording) once `limit` hits occur
 * inside the sliding `windowMs`.
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) buckets.clear(); // crude memory bound under key floods

  let entry = buckets.get(key);
  if (!entry) {
    entry = { hits: [] };
    buckets.set(key, entry);
  }
  prune(now, windowMs, entry);

  if (entry.hits.length >= limit) {
    const oldest = entry.hits[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  entry.hits.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test hook: clears all recorded hits. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Client-IP key for rate limiting (final-remediation §3).
 *
 * TOPOLOGY-VERIFIED TRUST MODEL (no speculative rewrite):
 *   * x-real-ip / x-forwarded-for are plain request headers — any client
 *     that can reach the portal directly can set them to arbitrary values
 *     and rotate the rate-limit key (bypass).
 *   * The repo's own edge gateway (Caddyfile) REPLACES both headers with
 *     {remote_host} at the edge, and the documented production topology is
 *     an operator-controlled TLS proxy in front of portal:3000 — both make
 *     the headers trustworthy.
 *   * Therefore the portal trusts these headers ONLY when the operator
 *     explicitly declares that topology with ABRIT_TRUST_PROXY_HEADERS=true
 *     (the same flag the CMS proxy uses). Without it, every caller shares a
 *     single "untrusted" bucket: no spoofed-header bypass is possible, and
 *     operators who front the portal with a sanitizing proxy simply set the
 *     flag to get real per-client keys.
 *
 * Note: the login/OTP/recovery throttles key on hashed identity identifiers
 * (email/mobile), NOT on these headers — they are unaffected either way.
 */
export function clientIpKey(request: Request): string {
  const trusted = (process.env.ABRIT_TRUST_PROXY_HEADERS ?? "").trim().toLowerCase() === "true";
  if (!trusted) return "untrusted";
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return "unknown";
}
