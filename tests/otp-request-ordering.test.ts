// ============================================================================
// OTP request ordering tests (audit §4.2):
//   1. validate request
//   2. validate delivery configuration   ← BEFORE any grant exists
//   3. rate limits
//   4. create grant
//   5. deliver
//   6. record result
//   7. invalidate the grant on definitive delivery failure
//
// A server misconfiguration must never consume a user's rate-limit allowance
// or leave a usable-but-undelivered grant behind.
//
// NOTE: the SMS.ir module is NOT module-mocked here (module mocks leak across
// files in a single `bun test` process and would break the real-provider
// contract test in smsir-contract.test.mjs). Configuration is driven through
// the environment and provider responses through a global fetch stub.
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mock } from "bun:test";

let grantCreates = 0;
let grantInvalidations = 0;
let countCalls = 0;
let providerRespondsOk = false;

const fakeDb = {
  otpGrant: {
    count: async () => {
      countCalls++;
      return 0;
    },
    create: async () => {
      grantCreates++;
      return { id: `grant-${grantCreates}` };
    },
    updateMany: async ({ data }: { data: { consumedAt?: Date } }) => {
      if (data.consumedAt) grantInvalidations++;
      return { count: 1 };
    },
  },
  panelUser: { findUnique: async () => ({ id: "u1", mobile: "09121234567" }) },
  smsOutbox: { upsert: async () => ({}) },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
const { otpService } = await import("../src/lib/auth/otp");
const { HttpError } = await import("../src/lib/api/http");

const WATCHED = [
  "NODE_ENV",
  "OTP_DELIVERY_MODE",
  "OTP_PROVIDER",
  "OTP_HMAC_SECRET",
  "ABRIT_SERVICE_TOKEN",
  "SMSIR_API_KEY",
  "SMSIR_TEMPLATE_ID",
  "SMSIR_OTP_TEMPLATE_ID",
] as const;
let saved: Record<string, string | undefined> = {};
let originalFetch: typeof fetch;

beforeEach(() => {
  saved = {};
  for (const key of WATCHED) saved[key] = process.env[key];
  process.env.NODE_ENV = "production";
  process.env.OTP_DELIVERY_MODE = "sms";
  process.env.OTP_HMAC_SECRET = "test-secret-a";
  delete process.env.ABRIT_SERVICE_TOKEN;
  // SMS.ir "not configured" by default; tests flip these to configure it.
  delete process.env.SMSIR_API_KEY;
  delete process.env.SMSIR_TEMPLATE_ID;
  delete process.env.SMSIR_OTP_TEMPLATE_ID;
  grantCreates = 0;
  grantInvalidations = 0;
  countCalls = 0;
  providerRespondsOk = false;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const key of WATCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  globalThis.fetch = originalFetch;
});

function configureProvider(): void {
  process.env.SMSIR_API_KEY = "test-provider-key";
  process.env.SMSIR_TEMPLATE_ID = "314002";
  globalThis.fetch = (async () =>
    providerRespondsOk
      ? new Response(JSON.stringify({ status: 1, message: "موفق", data: { messageId: 42, cost: 1 } }), { status: 200 })
      : new Response(JSON.stringify({ status: 14, message: "provider error" }), { status: 200 })) as typeof fetch;
}

function request(): Request {
  return new Request("http://localhost/api/auth/otp/request", {
    method: "POST",
    headers: { "x-real-ip": "1.2.3.4" },
  });
}

describe("OTP request ordering (audit §4.2)", () => {
  test("missing SMS configuration fails BEFORE any grant is created (no rate-limit consumption)", async () => {
    let caught: unknown;
    try {
      await otpService.requestGrant(request(), "09121234567", "login");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(503);
    expect((caught as HttpError).code).toBe("SMS_NOT_CONFIGURED");
    // The critical assertions: nothing was created, nothing was consumed.
    expect(grantCreates).toBe(0);
    expect(grantInvalidations).toBe(0);
  });

  test("delivery failure creates then INVALIDATES the grant (never leaves a usable undelivered code)", async () => {
    configureProvider(); // configured, but the provider answers with an error
    let caught: unknown;
    try {
      await otpService.requestGrant(request(), "09121234567", "login");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(502);
    expect(grantCreates).toBe(1); // rate-limit allowance consumed…
    expect(grantInvalidations).toBe(1); // …but the grant is invalidated
  });

  test("successful delivery keeps the grant active and reports the configured code length", async () => {
    configureProvider();
    providerRespondsOk = true;
    const result = await otpService.requestGrant(request(), "09121234567", "login");
    expect(result.delivery).toBe("sms");
    expect(result.providerAccepted).toBe(true);
    expect(result.code).toBeUndefined(); // never leaked in sms mode
    expect(result.codeLength).toBe(6);
    expect(grantCreates).toBe(1);
    expect(grantInvalidations).toBe(0);
  });

  test("rate limits are evaluated AFTER the configuration check", async () => {
    // Provider NOT configured: the config error must fire before the
    // rate-limit count queries run.
    try {
      await otpService.requestGrant(request(), "09121234567", "login");
    } catch {
      // expected
    }
    expect(countCalls).toBe(0);
  });
});
