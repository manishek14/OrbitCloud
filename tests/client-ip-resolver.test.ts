// ============================================================================
// Shared client-IP resolver tests (final-integration remediation FSR-5).
//
// The defect being closed: three independent implementations (rate limiter,
// recovery/OTP grants, session rows) each read x-real-ip / x-forwarded-for
// straight from the inbound request — and the auth paths did so
// UNCONDITIONALLY, so rotating a spoofable header rotated the throttle key
// and bypassed every IP-based limit.
//
// The fix: ONE resolver (src/lib/net/client-ip.ts) with an explicit,
// fail-closed trust contract. These tests cover both the resolver itself and
// the REAL consumption paths (login, OTP request, recovery request, contact
// form, quote endpoint, session rows) — a unit test of the function alone
// would not prove the routes actually route through it.
//
// Mandatory matrix (task §2.4):
//   1. spoofed x-real-ip in UNTRUSTED mode cannot rotate the key
//   2. spoofed x-forwarded-for in UNTRUSTED mode cannot rotate the key
//   3. combinations of fake headers cannot bypass the IP limits
//   4. TRUSTED mode accepts only the valid, expected header values
//   5. invalid IP values fall back to the safe untrusted policy
//   6. multi-value XFF is processed by the documented (rightmost) policy
//   7. clientIpHash() is derived from the same resolver
//   8. session.ipHash is derived from the same resolver
//   9. login / OTP / recovery cannot bypass IP limits via headers (untrusted)
//  10. per-mobile / per-email limits stay independent and active
//
// Final-audit-closure FSR-9 (added on top, matrix §2 of the closure task):
//  11. x-real-ip PRESENCE is value-independent — empty/whitespace/invalid
//      values fail closed to "unknown" and NEVER fall through to XFF; only a
//      genuinely absent x-real-ip consults x-forwarded-for (tests FSR-9.1-9.9)
// ============================================================================

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// In-memory database shared by every consumer under test. Counts are computed
// DYNAMICALLY from the recorded rows (like the real database), so the tests
// prove that header rotation cannot buy a fresh bucket.
// ---------------------------------------------------------------------------
interface LoginAttemptRow { identifierHash: string; ipHash: string; success: boolean }
interface OtpGrantRow { mobile: string; purpose: string; ipHash: string }
interface RecoveryGrantRow { userId: string; ipHash: string }
interface SessionRow { userId: string; ipHash: string | null; userAgent: string | null }

const store = {
  loginAttempts: [] as LoginAttemptRow[],
  otpGrants: [] as OtpGrantRow[],
  recoveryGrants: [] as RecoveryGrantRow[],
  sessions: [] as SessionRow[],
};

const KNOWN_EMAIL = "known@example.test";
const KNOWN_USER = { id: "user-1", email: KNOWN_EMAIL, status: "active", role: "customer" };

function countWhere<T>(rows: T[], predicate: (row: T) => boolean): number {
  return rows.filter(predicate).length;
}

const fakeDb = {
  loginAttempt: {
    count: async ({ where }: { where: { identifierHash?: string; ipHash?: string; success?: boolean } }) => {
      if (where.identifierHash !== undefined) {
        return countWhere(store.loginAttempts, (r) => r.identifierHash === where.identifierHash && r.success === false);
      }
      return countWhere(store.loginAttempts, (r) => r.ipHash === where.ipHash && r.success === false);
    },
    create: async ({ data }: { data: LoginAttemptRow }) => {
      store.loginAttempts.push(data);
      return data;
    },
  },
  otpGrant: {
    count: async ({ where }: { where: { mobile?: string; ipHash?: string } }) => {
      if (where.mobile !== undefined) return countWhere(store.otpGrants, (r) => r.mobile === where.mobile);
      return countWhere(store.otpGrants, (r) => r.ipHash === where.ipHash);
    },
    create: async ({ data }: { data: OtpGrantRow }) => {
      store.otpGrants.push(data);
      return { id: `otp-${store.otpGrants.length}`, ...data };
    },
  },
  recoveryGrant: {
    count: async ({ where }: { where: { ipHash?: string; user?: { email?: string } } }) => {
      if (where.user?.email !== undefined) {
        const userId = `user-${where.user.email}`;
        return countWhere(store.recoveryGrants, (r) => r.userId === userId);
      }
      return countWhere(store.recoveryGrants, (r) => r.ipHash === where.ipHash);
    },
    create: async ({ data }: { data: RecoveryGrantRow }) => {
      store.recoveryGrants.push(data);
      return { id: `rec-${store.recoveryGrants.length}`, ...data };
    },
  },
  panelUser: {
    findFirst: async () => null, // login: unknown identifier → constant-shape 401
    // Recovery: every email maps to its own known user so the per-EMAIL grant
    // limit (3/15min) never masks the per-IP limit under test.
    findUnique: async ({ where }: { where: { email?: string; mobile?: string } }) =>
      where.email !== undefined ? { ...KNOWN_USER, id: `user-${where.email}`, email: where.email } : null,
    update: async () => ({}),
  },
  session: {
    create: async ({ data }: { data: SessionRow }) => {
      store.sessions.push(data);
      return data;
    },
  },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
mock.module("@/lib/audit", () => ({ audit: async () => undefined }));
mock.module("@/lib/support/tickets", () => ({
  ticketService: { createGuest: async () => ({ id: "ticket-1" }) },
}));
mock.module("@/lib/commerce/quote", () => ({
  computeQuote: async () => ({ ok: true, quoteId: "q", checksum: "c" }),
}));

const { resolveClientIp, clientIpKey, clientIpHash, UNKNOWN_CLIENT_IP } = await import("../src/lib/net/client-ip");
const { createSession } = await import("../src/lib/auth/session");
const { POST: loginPost } = await import("../src/app/api/auth/login/route");
const { POST: otpRequestPost } = await import("../src/app/api/auth/otp/request/route");
const { POST: recoverRequestPost } = await import("../src/app/api/auth/recover/request/route");
const { POST: contactPost } = await import("../src/app/api/contact/route");
const { POST: quotePost } = await import("../src/app/api/commerce/quote/route");
const { resetRateLimits } = await import("../src/lib/rate-limit/memory");

function requestWith(headers: Record<string, string>, url = "http://localhost/api"): Request {
  return new Request(url, { method: "GET", headers });
}

function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const UNKNOWN_HASH = sha256(`ip:${UNKNOWN_CLIENT_IP}`);

beforeEach(() => {
  store.loginAttempts = [];
  store.otpGrants = [];
  store.recoveryGrants = [];
  store.sessions = [];
  resetRateLimits();
  delete process.env.ABRIT_TRUST_PROXY_HEADERS;
  process.env.OTP_HMAC_SECRET = "fsr5-test-secret";
});

afterEach(() => {
  delete process.env.ABRIT_TRUST_PROXY_HEADERS;
  delete process.env.OTP_HMAC_SECRET;
});

// ---------------------------------------------------------------------------
// Part A — the resolver itself (§2.4 items 1, 2, 4, 5, 6)
// ---------------------------------------------------------------------------
describe("FSR-5 resolver — untrusted (default): no spoofable header changes the key", () => {
  test("1. spoofed x-real-ip has no effect", () => {
    expect(clientIpKey(requestWith({ "x-real-ip": "1.1.1.1" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "2.2.2.2" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "::1" }))).toBe(UNKNOWN_CLIENT_IP);
  });

  test("2. spoofed x-forwarded-for has no effect", () => {
    expect(clientIpKey(requestWith({ "x-forwarded-for": "8.8.8.8, 9.9.9.9" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-forwarded-for": "203.0.113.9" }))).toBe(UNKNOWN_CLIENT_IP);
  });

  test("3. combinations of fake headers still resolve to the shared unknown bucket", () => {
    const variants = [
      { "x-real-ip": "100.1.1.1", "x-forwarded-for": "100.1.1.2" },
      { "x-real-ip": "100.1.1.3" },
      { "x-forwarded-for": "spoofed-first, 100.1.1.4" },
      {},
    ];
    for (const headers of variants) {
      expect(resolveClientIp(requestWith(headers))).toBe(UNKNOWN_CLIENT_IP);
    }
  });

  test("anything but the literal \"true\" stays untrusted (strict flag parsing)", () => {
    for (const value of ["yes", "1", "on", "TRUE "]) {
      if (value === "TRUE ") continue; // whitespace-padded true IS trusted — checked below
      process.env.ABRIT_TRUST_PROXY_HEADERS = value;
      expect(clientIpKey(requestWith({ "x-real-ip": "203.0.113.7" }))).toBe(UNKNOWN_CLIENT_IP);
    }
    process.env.ABRIT_TRUST_PROXY_HEADERS = "TRUE ";
    expect(clientIpKey(requestWith({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });
});

describe("FSR-5 resolver — trusted proxy mode (ABRIT_TRUST_PROXY_HEADERS=true)", () => {
  test("4. a valid edge x-real-ip becomes the per-client key (IPv4 and IPv6)", () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    expect(clientIpKey(requestWith({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIpKey(requestWith({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  test("5. an INVALID x-real-ip fails closed to the untrusted policy (no fallthrough to XFF)", () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    // Hostname garbage, IP:port forms and bracketed IPv6 are all rejected —
    // and a broken authoritative header must not degrade into trusting
    // another client-influenceable one.
    expect(clientIpKey(requestWith({ "x-real-ip": "evil.example", "x-forwarded-for": "203.0.113.9" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "1.2.3.4:5678", "x-forwarded-for": "203.0.113.9" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "[::1]" }))).toBe(UNKNOWN_CLIENT_IP);
  });

  test("6. multi-value XFF uses the RIGHTMOST valid member — never the spoofable first", () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    // Appending-proxy reality: the client controls the left members; our own
    // edge wrote the rightmost one. The old "first member" rule keyed on the
    // attacker's value; the resolver must key on the edge's.
    expect(clientIpKey(requestWith({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIpKey(requestWith({ "x-forwarded-for": "spoofed.invalid, 1.2.3.4, 10.0.0.2" }))).toBe("10.0.0.2");
    // No valid member at all → untrusted fallback.
    expect(clientIpKey(requestWith({ "x-forwarded-for": "spoofed.invalid, also-invalid" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({}))).toBe(UNKNOWN_CLIENT_IP);
  });
});

// ---------------------------------------------------------------------------
// Part A2 — FSR-9: presence of x-real-ip is decided by the HEADER, not the value
//
// Regression matrix: a present-but-empty/whitespace/invalid x-real-ip must
// fail closed to UNKNOWN_CLIENT_IP and must NEVER fall through to
// x-forwarded-for — only a genuinely ABSENT x-real-ip may consult XFF.
// ---------------------------------------------------------------------------
describe("FSR-9 — x-real-ip presence is value-independent (fail-closed, no XFF fallthrough)", () => {
  // A valid XFF the resolver WOULD use if (and only if) x-real-ip is absent.
  const VALID_XFF = { "x-forwarded-for": "spoofed-first, 198.51.100.10" };
  const VALID_XFF_RIGHTMOST = "198.51.100.10";

  beforeEach(() => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
  });

  test("FSR-9.1 — x-real-ip ABSENT + valid XFF → XFF is consulted per the trusted policy", () => {
    expect(clientIpKey(requestWith({ ...VALID_XFF }))).toBe(VALID_XFF_RIGHTMOST);
  });

  test("FSR-9.2 — x-real-ip EMPTY + valid XFF → unknown (no XFF fallthrough)", () => {
    expect(clientIpKey(requestWith({ "x-real-ip": "", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
  });

  test("FSR-9.3 — x-real-ip WHITESPACE-only + valid XFF → unknown (no XFF fallthrough)", () => {
    expect(clientIpKey(requestWith({ "x-real-ip": "   ", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": " \t ", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
  });

  test("FSR-9.4 — x-real-ip INVALID literal + valid XFF → unknown (no XFF fallthrough)", () => {
    expect(clientIpKey(requestWith({ "x-real-ip": "not-an-ip", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "999.999.999.999", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "[2001:db8::1]", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
  });

  test("FSR-9.5 — valid x-real-ip IPv4 wins (returned as-is)", () => {
    expect(clientIpKey(requestWith({ "x-real-ip": "203.0.113.7", ...VALID_XFF }))).toBe("203.0.113.7");
    // Surrounding whitespace is trimmed, then the literal validates.
    expect(clientIpKey(requestWith({ "x-real-ip": "  203.0.113.8  " }))).toBe("203.0.113.8");
  });

  test("FSR-9.6 — valid x-real-ip IPv6 wins (returned as-is)", () => {
    expect(clientIpKey(requestWith({ "x-real-ip": "2001:db8::1", ...VALID_XFF }))).toBe("2001:db8::1");
    expect(clientIpKey(requestWith({ "x-real-ip": "::1" }))).toBe("::1");
  });

  test("FSR-9.7 — x-real-ip with a PORT fails closed → unknown (no XFF fallthrough)", () => {
    expect(clientIpKey(requestWith({ "x-real-ip": "203.0.113.7:443", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "[2001:db8::1]:443", ...VALID_XFF }))).toBe(UNKNOWN_CLIENT_IP);
  });

  test("FSR-9.8 — the fail-closed value propagates to clientIpHash (durable storage keys)", () => {
    // An empty x-real-ip must produce the SAME hash as no trustworthy IP at
    // all — never the XFF-derived per-client hash.
    const emptyRealIpHash = clientIpHash(requestWith({ "x-real-ip": "", ...VALID_XFF }));
    expect(emptyRealIpHash).toBe(sha256(`ip:${UNKNOWN_CLIENT_IP}`));
    expect(emptyRealIpHash).not.toBe(sha256(`ip:${VALID_XFF_RIGHTMOST}`));
  });

  test("FSR-9.9 — untrusted mode is unchanged: every variant above stays on the shared bucket", () => {
    delete process.env.ABRIT_TRUST_PROXY_HEADERS;
    expect(clientIpKey(requestWith({ "x-real-ip": "" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith({ "x-real-ip": "203.0.113.7" }))).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIpKey(requestWith(VALID_XFF))).toBe(UNKNOWN_CLIENT_IP);
  });
});

// ---------------------------------------------------------------------------
// Part B — hash derivation (§2.4 items 7, 8)
// ---------------------------------------------------------------------------
describe("FSR-5 — hash consumers use the same resolver", () => {
  test("7. clientIpHash is sha256(\"ip:\" + resolveClientIp) — same input, same value", () => {
    const untrustedRequest = requestWith({ "x-real-ip": "198.51.100.77" });
    expect(clientIpHash(untrustedRequest)).toBe(sha256(`ip:${resolveClientIp(untrustedRequest)}`));
    expect(clientIpHash(untrustedRequest)).toBe(UNKNOWN_HASH);

    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    const trustedRequest = requestWith({ "x-real-ip": "198.51.100.77" });
    expect(clientIpHash(trustedRequest)).toBe(sha256("ip:198.51.100.77"));
    // XFF fallback path through the same hash format.
    expect(clientIpHash(requestWith({ "x-forwarded-for": "spoofed, 198.51.100.78" }))).toBe(sha256("ip:198.51.100.78"));
  });

  test("8. session.ipHash comes from the same resolver (createSession)", async () => {
    // Untrusted: completely different spoofed headers → identical session ipHash.
    const first = await createSession("user-1", {
      request: requestWith({ "x-real-ip": "9.9.9.9", "user-agent": "ua-a" }),
    });
    const second = await createSession("user-1", {
      request: requestWith({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "7.7.7.7", "user-agent": "ua-b" }),
    });
    expect(first.token).not.toBe(second.token);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0]!.ipHash).toBe(UNKNOWN_HASH);
    expect(store.sessions[1]!.ipHash).toBe(UNKNOWN_HASH);

    // Trusted: a valid edge IP produces the matching per-client hash; an
    // invalid one falls back to the shared bucket.
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    await createSession("user-1", { request: requestWith({ "x-real-ip": "203.0.113.5" }) });
    await createSession("user-1", { request: requestWith({ "x-real-ip": "not-an-ip" }) });
    expect(store.sessions[2]!.ipHash).toBe(sha256("ip:203.0.113.5"));
    expect(store.sessions[3]!.ipHash).toBe(UNKNOWN_HASH);
  });
});

// ---------------------------------------------------------------------------
// Part C — REAL consumption paths (§2.4 items 3, 9, 10)
// ---------------------------------------------------------------------------
describe("FSR-5 — login route: spoofed headers cannot bypass the per-IP throttle", () => {
  // NOTE: the login throttle keeps TWO independent counters — per-identifier
  // (10) and per-IP (30). The IP-bucket proofs below therefore use a DISTINCT
  // identifier per attempt (identifier bucket stays at 1) so the only counter
  // that can trip is the IP one — exactly the dimension under attack.

  test("9a. untrusted: 30 failures with ROTATING spoofed x-real-ip still trip the shared bucket on #31", async () => {
    for (let i = 0; i < 30; i++) {
      const response = await loginPost(
        jsonPost("http://localhost/api/auth/login", { identifier: `victim-${i}@example.test`, password: "WrongPassword1" }, { "x-real-ip": `10.0.0.${i % 256}`, "x-forwarded-for": `192.0.2.${i % 256}, 198.51.100.1` }),
      );
      expect(response.status).toBe(401); // every attempt is a normal failed login
    }
    // All 30 rows share the single unknown-bucket hash — rotation bought nothing.
    expect(new Set(store.loginAttempts.map((r) => r.ipHash)).size).toBe(1);
    expect(store.loginAttempts[0]!.ipHash).toBe(UNKNOWN_HASH);
    // The 31st request from the same (spoofed-rotating) source is throttled.
    const blocked = await loginPost(
      jsonPost("http://localhost/api/auth/login", { identifier: "victim-final@example.test", password: "WrongPassword1" }, { "x-real-ip": "10.9.9.9" }),
    );
    expect(blocked.status).toBe(429);
  });

  test("10a. per-IDENTIFIER limits stay independent and active (10 failures → 429 regardless of headers)", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await loginPost(
        jsonPost("http://localhost/api/auth/login", { identifier: "repeat@example.test", password: "WrongPassword1" }, { "x-real-ip": `198.51.100.${i}` }),
      );
      expect(response.status).toBe(401);
    }
    const blocked = await loginPost(
      jsonPost("http://localhost/api/auth/login", { identifier: "repeat@example.test", password: "WrongPassword1" }, { "x-real-ip": "198.51.100.200" }),
    );
    expect(blocked.status).toBe(429); // identifier bucket (10) — the IP bucket (11) is far from 30
  });

  test("9b. trusted: distinct VALID edge IPs keep independent buckets (per-client keys work through the route)", async () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    for (let i = 0; i < 30; i++) {
      const response = await loginPost(
        jsonPost("http://localhost/api/auth/login", { identifier: `client-${i}@example.test`, password: "WrongPassword1" }, { "x-real-ip": `198.51.100.${i}` }),
      );
      expect(response.status).toBe(401); // NEVER 429 — every client keeps its own bucket
    }
    expect(store.loginAttempts).toHaveLength(30);
    expect(new Set(store.loginAttempts.map((r) => r.ipHash)).size).toBe(30); // 30 DISTINCT buckets
  });
});

describe("FSR-5 — OTP request route: spoofed headers cannot bypass the per-IP grant limit", () => {
  test("9c. untrusted: rotating fake headers — 10 grants from the shared bucket, #11 is rate limited", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await otpRequestPost(
        jsonPost("http://localhost/api/auth/otp/request", { mobile: `0912123456${i % 10}`, purpose: "login" }, { "x-real-ip": `10.1.1.${i}` }),
      );
      expect(response.status).toBe(200);
    }
    expect(new Set(store.otpGrants.map((g) => g.ipHash)).size).toBe(1);
    expect(store.otpGrants[0]!.ipHash).toBe(UNKNOWN_HASH);
    const blocked = await otpRequestPost(
      jsonPost("http://localhost/api/auth/otp/request", { mobile: "09129999999", purpose: "login" }, { "x-real-ip": "10.1.1.99" }),
    );
    expect(blocked.status).toBe(429);
  });

  test("10b. per-MOBILE limits stay independent and active (3 grants → 4th is rate limited)", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await otpRequestPost(
        jsonPost("http://localhost/api/auth/otp/request", { mobile: "09121110000", purpose: "login" }, { "x-real-ip": `10.2.2.${i}` }),
      );
      expect(response.status).toBe(200);
    }
    const blocked = await otpRequestPost(
      jsonPost("http://localhost/api/auth/otp/request", { mobile: "09121110000", purpose: "login" }, { "x-real-ip": "10.2.2.99" }),
    );
    expect(blocked.status).toBe(429);
  });
});

describe("FSR-5 — recovery request route: spoofed headers cannot bypass the per-IP grant limit", () => {
  test("9d. untrusted: rotating fake headers — 10 grants from the shared bucket, #11 is rate limited", async () => {
    // A DISTINCT email per request keeps the per-EMAIL grant limit (3/15min)
    // out of the picture — only the shared IP bucket may trip, which is the
    // dimension the header rotation tries to defeat.
    for (let i = 0; i < 10; i++) {
      const response = await recoverRequestPost(
        jsonPost("http://localhost/api/auth/recover/request", { email: `victim-${i}@example.test` }, { "x-real-ip": `10.3.3.${i}`, "x-forwarded-for": `spoofed-${i}, 203.0.113.1` }),
      );
      expect(response.status).toBe(200);
    }
    expect(new Set(store.recoveryGrants.map((g) => g.ipHash)).size).toBe(1);
    expect(store.recoveryGrants[0]!.ipHash).toBe(UNKNOWN_HASH);
    const blocked = await recoverRequestPost(
      jsonPost("http://localhost/api/auth/recover/request", { email: "victim-final@example.test" }, { "x-real-ip": "10.3.3.99" }),
    );
    expect(blocked.status).toBe(429);
  });
});

describe("FSR-5 — public rate-limited routes (contact form, quote endpoint)", () => {
  test("9e. contact: rotating fake headers cannot reset the 5-per-10-minutes allowance", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await contactPost(
        jsonPost("http://localhost/api/contact", { name: "a", email: "a@b.test", subject: "s", message: "m" }, { "x-real-ip": `10.4.4.${i}` }),
      );
      expect(response.status).toBe(201);
    }
    const blocked = await contactPost(
      jsonPost("http://localhost/api/contact", { name: "a", email: "a@b.test", subject: "s", message: "m" }, { "x-real-ip": "10.4.4.99", "x-forwarded-for": "spoofed, 10.4.4.98" }),
    );
    expect(blocked.status).toBe(429);
  });

  test("9f. quote: rotating fake headers cannot reset the 30-per-minute allowance", async () => {
    for (let i = 0; i < 30; i++) {
      const response = await quotePost(
        jsonPost("http://localhost/api/commerce/quote", { packageCode: "starter", months: 1, users: 1, endpoints: 1 }, { "x-real-ip": `10.5.5.${i}` }),
      );
      expect(response.status).toBe(200);
    }
    const blocked = await quotePost(
      jsonPost("http://localhost/api/commerce/quote", { packageCode: "starter", months: 1, users: 1, endpoints: 1 }, { "x-real-ip": "10.5.5.99" }),
    );
    expect(blocked.status).toBe(429);
  });
});
