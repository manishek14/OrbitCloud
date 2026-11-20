// ============================================================================
// Rate-limiter trust tests (final security remediation, §3).
//
// Question under review: can a client bypass the public rate limits
// (contact form, quote endpoint) by spoofing x-real-ip / x-forwarded-for?
//
// Topology evidence (verified before fixing, per the task):
//   * src/lib/rate-limit/memory.ts consumed x-real-ip / x-forwarded-for
//     straight from the inbound request — plain client-settable headers.
//   * The repo's edge gateway (Caddyfile) REPLACES both headers with
//     {remote_host} (edge sanitization), and the documented production
//     topology is an operator-controlled TLS proxy in front of portal:3000 —
//     but the docker-compose file also publishes the port directly, so
//     "the proxy will clean it" is NOT enforceable at the application layer.
//   * Fix: the portal only trusts those headers when the operator explicitly
//     declares the topology via ABRIT_TRUST_PROXY_HEADERS=true (the same flag
//     the CMS proxy uses). Otherwise every caller shares one bucket — no
//     spoofed-header rotation is possible.
//
// These tests simulate the spoofed-header attacks end to end at the limiter
// layer (exactly what the contact/quote routes call).
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { clientIpKey, consumeRateLimit, resetRateLimits } from "../src/lib/rate-limit/memory";

const CONTACT_LIMIT = 5; // matches src/app/api/contact/route.ts
const CONTACT_WINDOW_MS = 10 * 60 * 1000;

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  resetRateLimits();
  delete process.env.ABRIT_TRUST_PROXY_HEADERS;
});

afterEach(() => {
  delete process.env.ABRIT_TRUST_PROXY_HEADERS;
});

describe("§3 — default (untrusted): spoofed identity headers cannot bypass limits", () => {
  test("x-real-ip spoofing is ignored — all requests share the untrusted bucket", () => {
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "1.1.1.1" }))).toBe("unknown");
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "2.2.2.2" }))).toBe("unknown");
  });

  test("x-forwarded-for spoofing is ignored the same way", () => {
    expect(clientIpKey(requestWithHeaders({ "x-forwarded-for": "8.8.8.8, 9.9.9.9" }))).toBe("unknown");
    expect(clientIpKey(requestWithHeaders({}))).toBe("unknown");
  });

  test("rotating fake IPs does NOT reset the contact allowance (simulated attack)", () => {
    let blockedAt = -1;
    for (let i = 0; i < CONTACT_LIMIT + 3; i++) {
      // Each request claims a DIFFERENT forged source IP — the old code would
      // have keyed each one separately and never blocked the attacker.
      const key = `contact:${clientIpKey(requestWithHeaders({ "x-real-ip": `10.0.0.${i}` }))}`;
      const result = consumeRateLimit(key, CONTACT_LIMIT, CONTACT_WINDOW_MS);
      if (!result.allowed && blockedAt === -1) blockedAt = i + 1;
    }
    expect(blockedAt).toBe(CONTACT_LIMIT + 1); // blocked exactly after the limit
  });

  test("mixing x-real-ip / x-forwarded-for / no header still hits one bucket", () => {
    const variants = [
      { "x-real-ip": "100.1.1.1" },
      { "x-forwarded-for": "100.1.1.2" },
      { "x-real-ip": "100.1.1.3", "x-forwarded-for": "100.1.1.4" },
      {},
    ];
    let blocked = 0;
    for (const headers of variants) {
      const key = `contact:${clientIpKey(requestWithHeaders(headers))}`;
      if (!consumeRateLimit(key, CONTACT_LIMIT, CONTACT_WINDOW_MS).allowed) blocked++;
    }
    // All four land in the same bucket — none of them is blocked yet (4 < 5),
    // proving they share the key rather than each getting a fresh one.
    expect(blocked).toBe(0);
    // The 5th hit (limit reached) is still allowed; the 6th is blocked —
    // all from the ONE shared bucket ("unknown" — the FSR-5 shared-resolver
    // constant, same value the auth ipHash fallback has always used).
    const key = `contact:${clientIpKey(requestWithHeaders({ "x-real-ip": "z" }))}`;
    expect(consumeRateLimit(key, CONTACT_LIMIT, CONTACT_WINDOW_MS).allowed).toBe(true); // 5th
    expect(consumeRateLimit(key, CONTACT_LIMIT, CONTACT_WINDOW_MS).allowed).toBe(false); // 6th
  });
});

describe("§3 — trusted-proxy mode (ABRIT_TRUST_PROXY_HEADERS=true): per-client keys work", () => {
  test("x-real-ip from the trusted edge becomes the per-client key", () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
  });

  test("x-forwarded-for is the fallback when the edge sets no x-real-ip (FSR-5: RIGHTMOST valid member)", () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    // FSR-5 policy change, asserted here on purpose: the FIRST XFF member is
    // client-controlled under appending proxies (it was exactly the spoofing
    // bypass this suite was written against), so the shared resolver now
    // takes the RIGHTMOST valid member — the one our own trusted edge wrote.
    expect(clientIpKey(requestWithHeaders({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIpKey(requestWithHeaders({ "x-forwarded-for": "203.0.113.9, garbage, 10.0.0.2" }))).toBe("10.0.0.2");
    expect(clientIpKey(requestWithHeaders({}))).toBe("unknown");
    // No valid member at all → back on the safe untrusted policy.
    expect(clientIpKey(requestWithHeaders({ "x-forwarded-for": "spoofed.invalid" }))).toBe("unknown");
  });

  test("distinct clients keep independent allowances; one abusive client is still capped", () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    // Client A burns its whole allowance…
    for (let i = 0; i < CONTACT_LIMIT; i++) {
      const key = `contact:${clientIpKey(requestWithHeaders({ "x-real-ip": "198.51.100.10" }))}`;
      expect(consumeRateLimit(key, CONTACT_LIMIT, CONTACT_WINDOW_MS).allowed).toBe(true);
    }
    // …and is blocked on the next request from the SAME IP…
    const blockedKey = `contact:${clientIpKey(requestWithHeaders({ "x-real-ip": "198.51.100.10" }))}`;
    expect(consumeRateLimit(blockedKey, CONTACT_LIMIT, CONTACT_WINDOW_MS).allowed).toBe(false);
    // …while a different client is unaffected.
    const otherKey = `contact:${clientIpKey(requestWithHeaders({ "x-real-ip": "198.51.100.11" }))}`;
    expect(consumeRateLimit(otherKey, CONTACT_LIMIT, CONTACT_WINDOW_MS).allowed).toBe(true);
  });

  test("flag parsing is strict: anything but (whitespace-padded, any-case) \"true\" is untrusted", () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "yes";
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "203.0.113.7" }))).toBe("unknown");
    process.env.ABRIT_TRUST_PROXY_HEADERS = "1";
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "203.0.113.7" }))).toBe("unknown");
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true ";
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    process.env.ABRIT_TRUST_PROXY_HEADERS = "TRUE";
    expect(clientIpKey(requestWithHeaders({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });
});
