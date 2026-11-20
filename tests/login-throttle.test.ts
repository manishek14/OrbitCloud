// ============================================================================
// Login throttle tests (audit §4.1): per-identifier and per-IP counters are
// evaluated INDEPENDENTLY from a DEDICATED table — unrelated failures are
// never OR-combined, and raw identifiers never land in audit metadata.
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mock } from "bun:test";

let identifierFailures = 0;
let ipFailures = 0;
let attemptRecords: Array<{ identifierHash: string; ipHash: string; success: boolean }> = [];
let auditRows: Array<{ actorLabel: string; action: string; metaJson: string | null }> = [];

const fakeDb = {
  loginAttempt: {
    count: async ({ where }: { where: { identifierHash?: string; ipHash?: string } }) =>
      where.identifierHash ? identifierFailures : ipFailures,
    create: async ({ data }: { data: { identifierHash: string; ipHash: string; success: boolean } }) => {
      attemptRecords.push(data);
      return data;
    },
  },
  panelUser: {
    findFirst: async () => null, // unknown identifier → constant-shape 401
    update: async () => ({}),
  },
  session: { create: async () => ({}) },
};

// Mock BOTH modules the route depends on. Mocking @/lib/audit DIRECTLY (not
// just @/lib/db) makes this file immune to cross-file mock leakage: another
// test file in the same bun worker may have installed its own global
// @/lib/audit mock (e.g. payment-callback-service's no-op) before this file
// runs — capturing audit calls here is also the more precise contract: the
// route must never pass raw identifiers to the audit trail.
mock.module("@/lib/db", () => ({ db: fakeDb }));
mock.module("@/lib/audit", () => ({
  audit: async (input: { actorLabel?: string; action: string; meta?: Record<string, unknown> }) => {
    auditRows.push({
      actorLabel: input.actorLabel ?? "",
      action: input.action,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
    });
  },
}));
const { POST } = await import("../src/app/api/auth/login/route");

beforeEach(() => {
  identifierFailures = 0;
  ipFailures = 0;
  attemptRecords = [];
  auditRows = [];
  process.env.OTP_HMAC_SECRET = "test-secret-a";
});

afterEach(() => {
  delete process.env.OTP_HMAC_SECRET;
});

function loginRequest(identifier: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "5.6.7.8" },
    body: JSON.stringify({ identifier, password: "WrongPassword1" }),
  });
}

describe("login throttling (audit §4.1)", () => {
  test("failed attempts below BOTH thresholds answer 401 (not throttled)", async () => {
    identifierFailures = 5;
    ipFailures = 5;
    const response = await POST(loginRequest("user@example.test"));
    expect(response.status).toBe(401);
    // The failure was recorded in the DEDICATED table.
    expect(attemptRecords).toHaveLength(1);
    expect(attemptRecords[0].success).toBe(false);
  });

  test("the per-IDENTIFIER threshold alone triggers the 429", async () => {
    identifierFailures = 10;
    ipFailures = 0;
    const response = await POST(loginRequest("user@example.test"));
    expect(response.status).toBe(429);
    // Throttled requests do not burn another attempt record.
    expect(attemptRecords).toHaveLength(0);
  });

  test("the per-IP threshold alone triggers the 429 (independent evaluation)", async () => {
    identifierFailures = 0;
    ipFailures = 30;
    const response = await POST(loginRequest("user@example.test"));
    expect(response.status).toBe(429);
  });

  test("unrelated failures are never combined: 9 identifier + 29 IP → still 401", async () => {
    // The old OR-based audit-log query would have counted 38 combined
    // failures and throttled prematurely. Independent counters must not.
    identifierFailures = 9;
    ipFailures = 29;
    const response = await POST(loginRequest("user@example.test"));
    expect(response.status).toBe(401);
  });

  test("raw identifiers never appear in throttle records or audit labels", async () => {
    identifierFailures = 0;
    ipFailures = 0;
    const first = await POST(loginRequest("user@example.test"));
    const second = await POST(loginRequest("09121234567"));
    // Both requests must take the constant-shape 401 path (guard against a
    // silent 400/500 that would trivially pass the PII assertions below).
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(attemptRecords).toHaveLength(2);
    expect(auditRows).toHaveLength(2);
    const raw = JSON.stringify(attemptRecords) + JSON.stringify(auditRows);
    expect(raw).not.toContain("user@example.test");
    expect(raw).not.toContain("09121234567");
    // Audit labels use short keyed-hash prefixes instead.
    expect(auditRows[0].actorLabel).toMatch(/^id:[a-f0-9]{12}$/);
  });
});
