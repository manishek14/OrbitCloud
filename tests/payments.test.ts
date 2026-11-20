// ============================================================================
// Payment gateway test suite (bun test).
//
// providers.ts calls REAL external sandbox URLs via global fetch — every test
// here MOCKS globalThis.fetch and injects fake provider responses. No network
// access happens.
//
// Covered:
//   • ZarinPal initiate (code 100 + authority → redirect URL) and failure.
//   • ZarinPal verify: 100 → ok, 101 → ok+alreadyVerified, errors.code -51 →
//     not_paid, garbage / unknown codes / network errors → ambiguous.
//   • Zibal initiate (result 100 + trackId) and failure.
//   • Zibal verify: result 100 + matching Rial amount → ok; amount mismatch →
//     amount_mismatch; result 202 → not_paid; 201 → ok+alreadyVerified.
//   • Toman→Rial conversion happens EXACTLY ONCE (captured request body
//     amount === toman × 10) in both initiate and verify.
//   • selectGateway: mellat ALWAYS rejected (also 'bank-mellat', any case);
//     mock rejected unless ABRIT_PAYMENTS_MOCK_ENABLED=true (tested through a
//     fresh module instance, since the flag is read at module load);
//     unknown ids rejected; zarinpal/zibal selectable.
//   • gatewayStatusSummary().mellat.enabled === false.
// ============================================================================

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import * as providers from "../src/lib/payments/providers";
import type { VerifyOutcome } from "../src/lib/payments/providers";

// ---------------------------------------------------------------------------
// fetch mocking
// ---------------------------------------------------------------------------

interface CapturedCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: any;
}

const originalFetch = globalThis.fetch;

/**
 * Replaces globalThis.fetch with a fake that records every call and replies
 * with the JSON produced by `respond(url)` (or throws when it returns an
 * Error). Returns the captured calls for body assertions.
 */
function installFetchMock(respond: (url: string) => unknown): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request)?.url ?? input);
    let body: any = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url, method: init?.method, headers, body });

    const result = respond(url);
    if (result instanceof Error) throw result;
    return new Response(typeof result === "string" ? result : JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// Narrowing helpers for the discriminated VerifyOutcome union.
function assertOk(outcome: VerifyOutcome): Extract<VerifyOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected ok:true, got ${JSON.stringify(outcome)}`);
  return outcome;
}
function assertFailed(outcome: VerifyOutcome): Extract<VerifyOutcome, { ok: false }> {
  if (outcome.ok) throw new Error(`expected ok:false, got ${JSON.stringify(outcome)}`);
  return outcome;
}

// ---------------------------------------------------------------------------
// ZarinPal
// ---------------------------------------------------------------------------

describe("zarinpal adapter (sandbox, mocked fetch)", () => {
  afterEach(restoreFetch);

  test("initiate: code 100 + authority → gatewayRef and StartPay redirect URL", async () => {
    const authority = "00000040319e933b1a63d4a3c90e7d6d904b875c";
    const calls = installFetchMock(() => ({ data: { code: 100, authority } }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");

    const result = await gateway.initiate({
      amountToman: 84_375_000,
      orderNumber: "AB-1001",
      description: "سفارش آزمایشی",
      callbackUrl: "https://portal.example.com/api/payments/callback/zarinpal",
    });

    expect(result.gatewayRef).toBe(authority);
    expect(result.redirectUrl).toBe(`https://sandbox.zarinpal.com/pg/StartPay/${authority}`);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sandbox.zarinpal.com/pg/v4/payment/request.json");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body.merchant_id).toBe("6cded4c4-0f92-4e37-bbb5-1b9a2f3e6a12");
    expect(calls[0].body.callback_url).toBe("https://portal.example.com/api/payments/callback/zarinpal");
    expect(calls[0].body.description).toBe("سفارش آزمایشی");
  });

  test("initiate failure (code != 100) throws ZARINPAL_REQUEST_FAILED", async () => {
    installFetchMock(() => ({ data: { code: -12, message: "merchant invalid" }, errors: {} }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");
    await expect(
      gateway.initiate({
        amountToman: 1_000_000,
        orderNumber: "AB-1002",
        description: "d",
        callbackUrl: "https://cb.example.com",
      }),
    ).rejects.toThrow(/ZARINPAL_REQUEST_FAILED/);
  });

  test("verify: code 100 → ok (paid now)", async () => {
    // ZarinPal's verify response includes the paid amount in Rial — the
    // cross-check against the stored Toman amount is mandatory.
    const calls = installFetchMock(() => ({ data: { code: 100, ref_id: 12345, amount: 843_750_000 } }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");

    const outcome = assertOk(
      await gateway.verify({ amountToman: 84_375_000, gatewayRef: "auth-1" }),
    );
    expect(outcome.alreadyVerified).toBe(false);
    expect(outcome.amountToman).toBe(84_375_000);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sandbox.zarinpal.com/pg/v4/payment/verify.json");
    expect(calls[0].body.authority).toBe("auth-1");
    expect(calls[0].body.merchant_id).toBe("6cded4c4-0f92-4e37-bbb5-1b9a2f3e6a12");
  });

  test("verify: code 101 → ok + alreadyVerified (idempotent duplicate)", async () => {
    installFetchMock(() => ({ data: { code: 101, ref_id: 12345, amount: 195_000_000 } }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");
    const outcome = assertOk(
      await gateway.verify({ amountToman: 19_500_000, gatewayRef: "auth-2" }),
    );
    expect(outcome.alreadyVerified).toBe(true);
  });

  test("verify: errors.code -51 → definitive not_paid", async () => {
    // Live-verified shape for an unpaid/invalid session:
    // {"data":{},"errors":{"code":-51}}
    installFetchMock(() => ({ data: {}, errors: { code: -51 } }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");
    const outcome = assertFailed(
      await gateway.verify({ amountToman: 19_500_000, gatewayRef: "auth-3" }),
    );
    expect(outcome.reason).toBe("not_paid");
  });

  test("verify: garbage/unknown responses → ambiguous (kept pending)", async () => {
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");

    // Completely unexpected shape.
    installFetchMock(() => ({ unexpected: "shape" }));
    expect(
      assertFailed(await gateway.verify({ amountToman: 1_000, gatewayRef: "g1" })).reason,
    ).toBe("ambiguous");

    // Unknown non-success, non-definitive code.
    installFetchMock(() => ({ data: { code: -9 }, errors: {} }));
    expect(
      assertFailed(await gateway.verify({ amountToman: 1_000, gatewayRef: "g2" })).reason,
    ).toBe("ambiguous");

    // Network failure stays ambiguous too (reconciliation case).
    installFetchMock(() => new Error("ECONNREFUSED"));
    expect(
      assertFailed(await gateway.verify({ amountToman: 1_000, gatewayRef: "g3" })).reason,
    ).toBe("ambiguous");
  });

  // Full-remediation audit §3.4: a "success" response WITHOUT a verifiable
  // integer amount used to skip the cross-check entirely and finalize the
  // payment. The amount is now mandatory on success outcomes.
  test("verify: success code but MISSING amount → amount_mismatch (never finalized)", async () => {
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");

    installFetchMock(() => ({ data: { code: 100, ref_id: 777 } }));
    expect(
      assertFailed(await gateway.verify({ amountToman: 1_000_000, gatewayRef: "no-amount" })).reason,
    ).toBe("amount_mismatch");

    // Non-numeric / zero amounts are equally unverifiable.
    installFetchMock(() => ({ data: { code: 100, ref_id: 778, amount: "not-a-number" } }));
    expect(
      assertFailed(await gateway.verify({ amountToman: 1_000_000, gatewayRef: "bad-amount" })).reason,
    ).toBe("amount_mismatch");

    installFetchMock(() => ({ data: { code: 100, ref_id: 779, amount: 0 } }));
    expect(
      assertFailed(await gateway.verify({ amountToman: 1_000_000, gatewayRef: "zero-amount" })).reason,
    ).toBe("amount_mismatch");
  });

  test("verify: success code with a DIFFERENT amount → amount_mismatch", async () => {
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");
    installFetchMock(() => ({ data: { code: 100, ref_id: 780, amount: 1 } }));
    expect(
      assertFailed(await gateway.verify({ amountToman: 1_000_000, gatewayRef: "wrong-amount" })).reason,
    ).toBe("amount_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Zibal
// ---------------------------------------------------------------------------

describe("zibal adapter (sandbox, mocked fetch)", () => {
  afterEach(restoreFetch);

  test("initiate: result 100 + trackId → gatewayRef and /start redirect", async () => {
    const calls = installFetchMock(() => ({ result: 100, trackId: 987654 }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");

    const result = await gateway.initiate({
      amountToman: 84_375_000,
      orderNumber: "AB-2001",
      description: "سفارش زیبال",
      callbackUrl: "https://portal.example.com/api/payments/callback/zibal",
    });

    expect(result.gatewayRef).toBe("987654");
    expect(result.redirectUrl).toBe("https://gateway.zibal.ir/start/987654");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gateway.zibal.ir/v1/request");
    expect(calls[0].body.merchant).toBe("zibal"); // documented test merchant
    expect(calls[0].body.orderId).toBe("AB-2001");
    expect(calls[0].body.callbackUrl).toBe("https://portal.example.com/api/payments/callback/zibal");
    expect(calls[0].body.description).toBe("سفارش زیبال");
  });

  test("initiate failure (result != 100) throws ZIBAL_REQUEST_FAILED", async () => {
    installFetchMock(() => ({ result: 102, message: "merchant not found" }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");
    await expect(
      gateway.initiate({
        amountToman: 1_000_000,
        orderNumber: "AB-2002",
        description: "d",
        callbackUrl: "https://cb.example.com",
      }),
    ).rejects.toThrow(/ZIBAL_REQUEST_FAILED/);
  });

  test("verify: result 100 + matching Rial amount → ok", async () => {
    installFetchMock(() => ({ result: 100, amount: 843_750_000, message: "success" }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");
    const outcome = assertOk(
      await gateway.verify({ amountToman: 84_375_000, gatewayRef: "987654" }),
    );
    expect(outcome.alreadyVerified).toBe(false);
    expect(outcome.amountToman).toBe(84_375_000);
  });

  test("verify: result 100 but Rial amount mismatch → amount_mismatch", async () => {
    installFetchMock(() => ({ result: 100, amount: 843_750_000 + 1_000 }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");
    const outcome = assertFailed(
      await gateway.verify({ amountToman: 84_375_000, gatewayRef: "987655" }),
    );
    expect(outcome.reason).toBe("amount_mismatch");
  });

  test("verify: success without an exact amount never becomes paid", async () => {
    installFetchMock(() => ({ result: 100, message: "success" }));
    const gateway = providers.getProvider("zibal")!;
    expect(assertFailed(await gateway.verify({ amountToman: 1_000, gatewayRef: "12345" })).reason).toBe("amount_mismatch");
    installFetchMock(() => ({ result: 100, amount: 10_001 }));
    expect(assertFailed(await gateway.verify({ amountToman: 1_000, gatewayRef: "12345" })).reason).toBe("amount_mismatch");
  });

  test("verify: result 101 and merchant error are never success", async () => {
    const gateway = providers.getProvider("zibal")!;
    installFetchMock(() => ({ result: 101, amount: 10_000 }));
    expect(assertFailed(await gateway.verify({ amountToman: 1_000, gatewayRef: "12345" })).reason).toBe("ambiguous");
    installFetchMock(() => ({ result: 104, amount: 10_000 }));
    expect(assertFailed(await gateway.verify({ amountToman: 1_000, gatewayRef: "12345" })).reason).toBe("ambiguous");
  });

  test("verify: result 202 → definitive not_paid", async () => {
    installFetchMock(() => ({ result: 202, message: "failed" }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");
    const outcome = assertFailed(
      await gateway.verify({ amountToman: 19_500_000, gatewayRef: "987656" }),
    );
    expect(outcome.reason).toBe("not_paid");
  });

  test("verify: result 201 → ok + alreadyVerified", async () => {
    installFetchMock(() => ({ result: 201, amount: 195_000_000 }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");
    const outcome = assertOk(
      await gateway.verify({ amountToman: 19_500_000, gatewayRef: "987657" }),
    );
    expect(outcome.alreadyVerified).toBe(true);
  });

  test("verify sends {merchant, trackId} only — no amount is sent upstream", async () => {
    const calls = installFetchMock(() => ({ result: 100, amount: 195_000_000 }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");
    await gateway.verify({ amountToman: 19_500_000, gatewayRef: "987658" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gateway.zibal.ir/v1/verify");
    expect(calls[0].body).toEqual({ merchant: "zibal", trackId: 987658 });
  });
});

// ---------------------------------------------------------------------------
// Toman → Rial conversion (exactly once)
// ---------------------------------------------------------------------------

describe("Toman→Rial conversion happens exactly once", () => {
  afterEach(restoreFetch);

  test("zarinpal initiate sends amount = toman × 10 (not ×100, not ×10 twice)", async () => {
    const toman = 84_375_000;
    const calls = installFetchMock(() => ({ data: { code: 100, authority: "a1" } }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");
    await gateway.initiate({
      amountToman: toman,
      orderNumber: "AB-3001",
      description: "d",
      callbackUrl: "https://cb.example.com",
    });
    expect(calls[0].body.amount).toBe(toman * 10); // 843,750,000 Rial
  });

  test("zarinpal verify sends amount = toman × 10", async () => {
    const toman = 19_500_000;
    const calls = installFetchMock(() => ({ data: { code: 100, ref_id: 1 } }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");
    await gateway.verify({ amountToman: toman, gatewayRef: "a2" });
    expect(calls[0].body.amount).toBe(toman * 10); // 195,000,000 Rial
  });

  test("zibal initiate sends amount = toman × 10", async () => {
    const toman = 12_950_000;
    const calls = installFetchMock(() => ({ result: 100, trackId: 555 }));
    const gateway = providers.getProvider("zibal");
    if (!gateway) throw new Error("zibal provider missing");
    await gateway.initiate({
      amountToman: toman,
      orderNumber: "AB-3002",
      description: "d",
      callbackUrl: "https://cb.example.com",
    });
    expect(calls[0].body.amount).toBe(toman * 10); // 129,500,000 Rial
  });

  test("odd Toman amounts are converted without double conversion", async () => {
    const toman = 1001; // odd valid amount — must arrive as 10010 Rial
    const calls = installFetchMock(() => ({ data: { code: 100, authority: "a3" } }));
    const gateway = providers.getProvider("zarinpal");
    if (!gateway) throw new Error("zarinpal provider missing");
    await gateway.initiate({
      amountToman: toman,
      orderNumber: "AB-3003",
      description: "d",
      callbackUrl: "https://cb.example.com",
    });
    expect(calls[0].body.amount).toBe(10_010);
  });

  test("invalid amounts are rejected before contacting either gateway", async () => {
    const calls = installFetchMock(() => ({}));
    for (const id of ["zarinpal", "zibal"]) {
      const gateway = providers.getProvider(id)!;
      for (const amountToman of [0, -1, 999, 1.5, Number.MAX_SAFE_INTEGER]) {
        await expect(gateway.initiate({ amountToman, orderNumber: "AB-1", description: "test", callbackUrl: "https://portal.example.ir" })).rejects.toThrow("INVALID_PAYMENT_AMOUNT");
      }
    }
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Gateway selection & Mellat rejection
// ---------------------------------------------------------------------------

describe("selectGateway (server-side enforcement)", () => {
  test("mellat is ALWAYS rejected", () => {
    for (const id of ["mellat", "Mellat", "MELLAT", " mellat ", "bank-mellat", "Bank-Mellat"]) {
      const result = providers.selectGateway(id);
      expect("provider" in result).toBe(false);
      expect("error" in result).toBe(true);
    }
  });

  test("mellat rejection message is the configured status text", () => {
    const result = providers.selectGateway("mellat");
    if (!("error" in result)) throw new Error("expected an error result");
    expect(result.error).toBe(providers.MELLAT_STATUS_FA);
    expect(result.error).toContain("ملت");
  });

  test("unknown / empty gateway ids are rejected", () => {
    for (const id of ["unknown-gw", "saman", "pasargad", "", undefined, null]) {
      const result = providers.selectGateway(id as string | undefined | null);
      expect("provider" in result).toBe(false);
    }
  });

  test("mock is rejected by default (ABRIT_PAYMENTS_MOCK_ENABLED unset at load)", () => {
    const result = providers.selectGateway("mock");
    expect("provider" in result).toBe(false);
    expect("error" in result).toBe(true);
  });

  test("zarinpal and zibal are selectable sandbox providers", () => {
    const zarinpal = providers.selectGateway("zarinpal");
    expect("provider" in zarinpal).toBe(true);
    if ("provider" in zarinpal) expect(zarinpal.provider.id).toBe("zarinpal");

    const zibal = providers.selectGateway("zibal");
    expect("provider" in zibal).toBe(true);
    if ("provider" in zibal) expect(zibal.provider.id).toBe("zibal");
  });

  test("gatewayStatusSummary: mellat disabled, zarinpal & zibal enabled, mock off", () => {
    const summary = providers.gatewayStatusSummary();
    expect(summary.mellat.enabled).toBe(false);
    expect(summary.zarinpal.enabled).toBe(true);
    expect(summary.zibal.enabled).toBe(true);
    expect(summary.mock.enabled).toBe(false);
  });

  test("selectableGateways() excludes mellat and mock by default", () => {
    const list = providers.selectableGateways();
    const ids = list.map((g) => g.gateway).sort();
    expect(ids).toEqual(["zarinpal", "zibal"]);
  });
});

// ---------------------------------------------------------------------------
// Mock gateway opt-in (ABRIT_PAYMENTS_MOCK_ENABLED=true)
//
// The flag is read at module-load time, so the enabled behaviour is tested
// through a FRESH module instance (dynamic import with a cache-busting query
// — bun treats distinct query strings as distinct modules).
// ---------------------------------------------------------------------------

describe("mock gateway opt-in via ABRIT_PAYMENTS_MOCK_ENABLED=true", () => {
  test("production rejects mock even if the opt-in flag is set", async () => {
    const previousFlag = process.env.ABRIT_PAYMENTS_MOCK_ENABLED;
    const previousMode = process.env.NODE_ENV;
    process.env.ABRIT_PAYMENTS_MOCK_ENABLED = "true";
    process.env.NODE_ENV = "production";
    try {
      const fresh = await import("../src/lib/payments/providers.ts?fresh=mock-production");
      expect("provider" in fresh.selectGateway("mock")).toBe(false);
      expect(fresh.gatewayStatusSummary().mock.enabled).toBe(false);
    } finally {
      if (previousFlag === undefined) delete process.env.ABRIT_PAYMENTS_MOCK_ENABLED;
      else process.env.ABRIT_PAYMENTS_MOCK_ENABLED = previousFlag;
      if (previousMode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousMode;
    }
  });

  test("with the flag set, mock becomes selectable (fresh module instance)", async () => {
    const hadValue = "ABRIT_PAYMENTS_MOCK_ENABLED" in process.env;
    const previous = process.env.ABRIT_PAYMENTS_MOCK_ENABLED;
    process.env.ABRIT_PAYMENTS_MOCK_ENABLED = "true";
    try {
      const freshPath = "../src/lib/payments/providers.ts?fresh=mock-enabled";
      const fresh = (await import(freshPath)) as typeof providers;

      const selected = fresh.selectGateway("mock");
      expect("provider" in selected).toBe(true);
      if ("provider" in selected) expect(selected.provider.id).toBe("mock");

      expect(fresh.gatewayStatusSummary().mock.enabled).toBe(true);
      expect(fresh.selectableGateways().map((g) => g.gateway)).toContain("mock");

      // Mellat stays rejected even in the mock-enabled instance.
      expect("provider" in fresh.selectGateway("mellat")).toBe(false);
    } finally {
      if (hadValue) process.env.ABRIT_PAYMENTS_MOCK_ENABLED = previous as string | undefined;
      else delete process.env.ABRIT_PAYMENTS_MOCK_ENABLED;
    }
  });

  test("the default (statically imported) instance still rejects mock afterwards", () => {
    const result = providers.selectGateway("mock");
    expect("provider" in result).toBe(false);
  });
});
