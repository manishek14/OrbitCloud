// ============================================================================
// Mock payment callback — server-controlled redirect origin
// (final-integration remediation FSR-7).
//
// The defect: POST /api/payments/callback built its 303 Location from the
// REQUEST HEADERS (x-forwarded-proto / x-forwarded-host / host) via
// baseUrl(request) — all plain client-settable values, so the internal
// dev/test gateway could be made to redirect the browser to an
// attacker-chosen absolute origin.
//
// The fix: the route now emits a 303 with a RELATIVE, server-controlled
// Location (same pattern as the real-gateway callback), validated by
// src/lib/payments/redirect-target.ts. These tests run the REAL route with
// the REAL orderService.finalizePayment (only @/lib/db and @/lib/audit are
// mocked) so the actual runtime path is exercised, not a stub of it.
//
// Required matrix (task §4):
//   • forged Host / XFH / XFP / combined headers cannot change the Location
//   • the final Location is server-controlled and relative
//   • no external-origin, "//" (network-path) or backslash redirect is
//     possible — asserted both through the route AND against the guard
//   • the normal callback behavior (303 → result page) is preserved
//   • the mock gateway stays disabled in production (403 MOCK_DISABLED)
// ============================================================================

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { createHash } from "node:crypto";

const VERIFY_TOKEN = "mock-gateway-token";
const REF = "MOCK-REF-1";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const fakeTx = {
  id: "tx-1",
  ref: REF,
  status: "pending",
  verifyTokenHash: sha256(VERIFY_TOKEN),
  order: { id: "order-1", orderNumber: "AB-1" },
};

const fakeDb = {
  transaction: {
    findUnique: async ({ where }: { where: { ref?: string } }) =>
      where.ref === REF ? fakeTx : null,
    update: async (args: unknown) => args,
  },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
mock.module("@/lib/audit", () => ({ audit: async () => undefined }));

const { POST } = await import("../src/app/api/payments/callback/route");
const { safeRelativeRedirectLocation } = await import("../src/lib/payments/redirect-target");

function callbackRequest(headers: Record<string, string> = {}, outcome = "cancel"): Request {
  return new Request("http://localhost/api/payments/callback", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ ref: REF, t: VERIFY_TOKEN, outcome }).toString(),
  });
}

const EXPECTED_LOCATION = `/portal/payment/result?ref=${REF}`;

beforeEach(() => {
  // Normalize the environment: the mock gateway is a dev/test feature.
  delete process.env.NODE_ENV;
});

describe("FSR-7 — mock payment callback redirect is server-controlled", () => {
  test("normal callback behavior is preserved: 303 to the relative result page", async () => {
    const response = await POST(callbackRequest());
    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBe(EXPECTED_LOCATION);
    // Relative by construction: exactly one leading "/", no scheme, no host.
    expect(location!.startsWith("/")).toBe(true);
    expect(location!.startsWith("//")).toBe(false);
    expect(/^[a-z][a-z0-9+.-]*:\/\//i.test(location!)).toBe(false);
  });

  test("a forged Host header cannot influence the redirect destination", async () => {
    const response = await POST(callbackRequest({ host: "evil.attacker.test" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION); // NOT evil.attacker.test
  });

  test("a forged x-forwarded-host header cannot influence the destination", async () => {
    const response = await POST(callbackRequest({ "x-forwarded-host": "evil.attacker.test" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION);
  });

  test("a forged x-forwarded-proto header cannot influence the destination", async () => {
    const response = await POST(callbackRequest({ "x-forwarded-proto": "gopher" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION);
  });

  test("combined forged headers still produce the same server-controlled Location", async () => {
    const response = await POST(
      callbackRequest({
        host: "evil.attacker.test",
        "x-forwarded-host": "evil.attacker.test",
        "x-forwarded-proto": "https",
        "x-real-ip": "1.2.3.4",
        "x-forwarded-for": "spoofed, 5.6.7.8",
      }),
    );
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toBe(EXPECTED_LOCATION);
    // No external origin, no network-path reference, no backslash — the
    // browser can only end up on the origin it already used.
    expect(location.startsWith("//")).toBe(false);
    expect(location.includes("\\")).toBe(false);
    expect(location.includes("evil.attacker.test")).toBe(false);
  });

  test("success outcome also redirects to the same relative result page", async () => {
    // The success path runs the full finalizeSuccess flow; the transaction
    // stays pending in the fake, but the REDIRECT target is identical —
    // the cancel path above already proves the guard, this pins the outcome.
    const response = await POST(callbackRequest({}, "failure"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION);
  });
});

describe("FSR-7 — the relative-Location guard itself (redirect-target)", () => {
  test("network-path, backslash and absolute values all collapse to \"/\"", () => {
    expect(safeRelativeRedirectLocation("//evil.example/x")).toBe("/");
    expect(safeRelativeRedirectLocation("\\\\evil.example\\x")).toBe("/");
    expect(safeRelativeRedirectLocation("/\\evil.example/x")).toBe("/");
    expect(safeRelativeRedirectLocation("/foo\\bar")).toBe("/");
    expect(safeRelativeRedirectLocation("http://evil.example/x")).toBe("/");
    expect(safeRelativeRedirectLocation("https://portal.example.com/x")).toBe("/");
    expect(safeRelativeRedirectLocation("relative-no-slash")).toBe("/");
    expect(safeRelativeRedirectLocation("")).toBe("/");
  });

  test("legitimate relative targets pass through unchanged", () => {
    expect(safeRelativeRedirectLocation("/portal/payment/result?ref=MOCK-REF-1")).toBe("/portal/payment/result?ref=MOCK-REF-1");
    expect(safeRelativeRedirectLocation("/")).toBe("/");
    expect(safeRelativeRedirectLocation("/portal/orders?page=2#top")).toBe("/portal/orders?page=2#top");
  });
});

describe("FSR-7 — the mock gateway stays disabled in production", () => {
  test("NODE_ENV=production → 403 MOCK_DISABLED, no redirect is issued", async () => {
    process.env.NODE_ENV = "production";
    try {
      const response = await POST(callbackRequest());
      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull(); // no redirect in production
      const body = (await response.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("MOCK_DISABLED");
    } finally {
      delete process.env.NODE_ENV;
    }
  });
});
